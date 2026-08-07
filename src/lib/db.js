// ── DB Reader — reads pre-computed signals from Supabase ─────────────
// Called by App.jsx instead of running live scans in browser

import { supabase } from './supabase'

/**
 * Fetch all stocks from Supabase DB (pre-computed by live server)
 * Returns processed stock array ready for the UI.
 *
 * Pass historyDate (format 'YYYY-MM-DD') to replay any past trading day
 * from the stock_history archive instead of today's live `stocks` table.
 */
export async function fetchTopGainers(limit=15) {
  const { data, error } = await supabase
    .from('stocks')
    .select('sym,chg_pct,last_price,sector')
    .order('chg_pct', { ascending: false })
    .limit(limit)
  if (error) { console.error('fetchTopGainers error:', error.message); return [] }
  return data || []
}

/**
 * Fetch recent squeeze/VCP/HY/HT fires for the Alerts History page.
 * Same table the browser-notification poller reads from, just without
 * the 90-second "since" window — this pulls a longer scrollback so past
 * alerts (including ones fired while the tab was closed, which browser
 * notifications never catch) are visible.
 */
export async function fetchRecentAlerts(limit=100) {
  const { data, error } = await supabase
    .from('squeeze_alerts')
    .select('*')
    .order('fired_at', { ascending: false })
    .limit(limit)
  if (error) { console.error('fetchRecentAlerts error:', error.message); return [] }
  return data || []
}

/**
 * Fetch sector rotation data — each sector's avg RS + rank over the last
 * `days` trading days, plus derived momentum (avg_rs change over the
 * window) and rank change (positive = moved up, since rank 1 is best).
 * Powers both the quadrant (RRG-style) chart and the ranked list view.
 *
 * Pulls a generous flat row limit rather than querying per-distinct-date
 * (PostgREST has no simple "last N distinct dates" query) and does the
 * date-window trim + grouping client-side — sector_history is small
 * (~20 sectors × a handful of days), so this is cheap.
 */
export async function fetchSectorRotation(days=10) {
  const { data, error } = await supabase
    .from('sector_history')
    .select('snapshot_date,sector,avg_rs,rank,count')
    .order('snapshot_date', { ascending: false })
    .limit(days * 40)
  if (error) { console.error('fetchSectorRotation error:', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-days)
  const dateSet = new Set(recentDates)

  const bySector = {}
  for (const row of data) {
    if (!dateSet.has(row.snapshot_date)) continue
    if (!bySector[row.sector]) bySector[row.sector] = []
    bySector[row.sector].push(row)
  }

  return Object.entries(bySector).map(([sector, rows]) => {
    const sorted = [...rows].sort((a,b) => a.snapshot_date.localeCompare(b.snapshot_date))
    const first = sorted[0]
    const last  = sorted[sorted.length - 1]
    const mid   = sorted[Math.floor((sorted.length - 1) / 2)]
    return {
      id:         sector,
      label:      sector,
      meta:       `${last.count} stocks`,
      count:      last.count,
      level:      last.avg_rs,
      rank:       last.rank,
      windowDays: sorted.length,
      // Full daily trail (not just first/mid/last) so the quadrant chart
      // draws a real curved path through every available day, matching
      // how RRG charts actually look — a handful of sample points reads
      // as a jagged triangle instead of a trajectory.
      trail:      sorted.map(r => ({ level: r.avg_rs, date: r.snapshot_date })),
      momentum:   sorted.length > 1 ? +(last.avg_rs - first.avg_rs).toFixed(1) : 0,
      rankChange: sorted.length > 1 ? (first.rank - last.rank) : 0,
    }
  }).sort((a,b) => a.rank - b.rank)
}

/**
 * Fetch index rotation data from index_history (daily RS-TV/rank
 * snapshots per index — see backend commit adding this table). Same
 * shape/derivation as fetchSectorRotation, just a different source
 * table and level metric (rs_tv instead of avg_rs).
 *
 * If index_history doesn't exist yet in Supabase (needs to be created —
 * see the backend's loud error log for the exact SQL), this returns []
 * rather than throwing, same graceful-degradation as the other fetchers.
 */
export async function fetchIndexRotation(days=10) {
  const { data, error } = await supabase
    .from('index_history')
    .select('snapshot_date,name,rs_tv,rank_d')
    .order('snapshot_date', { ascending: false })
    .limit(days * 40)
  if (error) { console.error('fetchIndexRotation error (index_history table may not exist yet):', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-days)
  const dateSet = new Set(recentDates)

  const byIndex = {}
  for (const row of data) {
    if (!dateSet.has(row.snapshot_date)) continue
    if (row.rs_tv == null) continue
    if (!byIndex[row.name]) byIndex[row.name] = []
    byIndex[row.name].push(row)
  }

  return Object.entries(byIndex).map(([name, rows]) => {
    const sorted = [...rows].sort((a,b) => a.snapshot_date.localeCompare(b.snapshot_date))
    const first = sorted[0]
    const last  = sorted[sorted.length - 1]
    const mid   = sorted[Math.floor((sorted.length - 1) / 2)]
    return {
      id:         name,
      label:      name,
      meta:       'Index',
      level:      last.rs_tv,
      rank:       last.rank_d,
      windowDays: sorted.length,
      trail:      sorted.filter(r => r.rs_tv != null).map(r => ({ level: r.rs_tv, date: r.snapshot_date })),
      momentum:   sorted.length > 1 ? +(last.rs_tv - first.rs_tv).toFixed(1) : 0,
      rankChange: sorted.length > 1 && first.rank_d!=null && last.rank_d!=null ? (first.rank_d - last.rank_d) : 0,
    }
  }).sort((a,b) => (a.rank??999) - (b.rank??999))
}

/**
 * Fetch watchlist rotation data — same RRG shape as sector/index, but
 * per-stock, sourced from stock_history (already populated daily by the
 * live scan + the 30-day backfill, no new backend work needed here).
 * Rank is computed locally (1 = highest current RS-TV) since it's only
 * meaningful within this specific watchlist, not a rank Supabase stores.
 */
export async function fetchWatchlistRotation(syms=[], days=10) {
  if (!syms || syms.length === 0) return []
  const { data, error } = await supabase
    .from('stock_history')
    .select('snapshot_date,sym,rs_tv,rs,sector')
    .in('sym', syms)
    .order('snapshot_date', { ascending: false })
    .limit(days * syms.length * 2)
  if (error) { console.error('fetchWatchlistRotation error:', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-days)
  const dateSet = new Set(recentDates)

  const bySym = {}
  for (const row of data) {
    if (!dateSet.has(row.snapshot_date)) continue
    const level = row.rs_tv ?? row.rs
    if (level == null) continue
    if (!bySym[row.sym]) bySym[row.sym] = []
    bySym[row.sym].push({ ...row, level })
  }

  const items = Object.entries(bySym).map(([sym, rows]) => {
    const sorted = [...rows].sort((a,b) => a.snapshot_date.localeCompare(b.snapshot_date))
    const first = sorted[0]
    const last  = sorted[sorted.length - 1]
    const mid   = sorted[Math.floor((sorted.length - 1) / 2)]
    return {
      id:         sym,
      label:      sym,
      meta:       last.sector || '—',
      level:      last.level,
      windowDays: sorted.length,
      trail:      sorted.map(r => ({ level: r.level, date: r.snapshot_date })),
      momentum:   sorted.length > 1 ? +(last.level - first.level).toFixed(1) : 0,
    }
  })
  // Rank locally by current level, since this is a rank within the
  // watchlist only — not something stock_history stores.
  items.sort((a,b) => b.level - a.level)
  items.forEach((it,i) => {
    it.rank = i + 1
    it.rankChange = null // no prior-rank baseline within a watchlist-scoped rank; omitted rather than shown wrong
  })
  return items
}

export async function fetchStocksFromDB({ indexFilter = 'all', watchlistSyms = null, historyDate = null } = {}) {
  // R2 fast-path — re-enabled after being disabled earlier today. The
  // actual root cause of the staleness confusion wasn't the timing
  // check below (which was already reasonable) — it was that R2 could
  // successfully upload a snapshot that was fresh-TIMESTAMP but wrong-
  // CONTENT (e.g. today's separate ALL_STOCKS bug meant a real upload
  // succeeded with only 298 stocks instead of ~2400, which a pure
  // freshness check can't catch since the timestamp genuinely was
  // recent). Now that root cause is fixed, re-enabling this with an
  // ADDED content sanity check (minimum row count) alongside the
  // existing timestamp check, so a fresh-but-broken snapshot like that
  // one gets rejected too, not just a stale one.
  if (!historyDate) {
    const r2Rows = await fetchStocksFromR2()
    if (r2Rows) {
      let filtered = r2Rows
      if (watchlistSyms && watchlistSyms.length > 0) {
        const want = new Set(watchlistSyms)
        filtered = filtered.filter(s => want.has(s.sym))
      } else if (indexFilter === 'nifty50') {
        filtered = filtered.filter(s => s.inNifty50)
      } else if (indexFilter === 'midcap') {
        filtered = filtered.filter(s => s.inMidcap)
      } else if (indexFilter === 'smallcap') {
        filtered = filtered.filter(s => s.inSmallcap)
      } else if (indexFilter === 'microcap') {
        filtered = filtered.filter(s => s.inMicrocap)
      }
      return [...filtered].sort((a, b) => (b.rs || 0) - (a.rs || 0))
    }
  }

  const table = historyDate ? 'stock_history' : 'stocks'

  const buildQuery = () => {
    let q = supabase.from(table).select('*').order('rs', { ascending: false })
    if (historyDate) q = q.eq('snapshot_date', historyDate)
    if (watchlistSyms && watchlistSyms.length > 0) {
      q = q.in('sym', watchlistSyms)
    } else if (indexFilter === 'nifty50') {
      q = q.eq('in_nifty50', true)
    } else if (indexFilter === 'midcap') {
      q = q.eq('in_midcap', true)
    } else if (indexFilter === 'smallcap') {
      q = q.eq('in_smallcap', true)
    } else if (indexFilter === 'microcap') {
      q = q.eq('in_microcap', true)
    }
    return q
  }

  // Supabase/PostgREST caps each request at 1000 rows by default — page
  // through with .range() until a page comes back short, so all ~2300+
  // stocks load instead of only the first 1000.
  const PAGE_SIZE = 1000
  let data = []
  let from = 0
  while (true) {
    const { data: page, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    data = data.concat(page || [])
    if (!page || page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Transform one raw DB row (snake_case, matching the Postgres/R2
  // snapshot shape) into the camelCase shape the rest of the app expects.
  // Extracted as its own top-level function (see transformStockRow below
  // fetchStocksFromDB) — not inlined here — so the R2 fast-path can
  // produce byte-for-byte identical output to this Supabase path, instead
  // of risking two copies of this large mapping drifting apart over time.
  return (data || []).map(transformStockRow)
}

// Transform one raw DB row (snake_case, matching the Postgres/R2 snapshot
// shape) into the camelCase shape the rest of the app expects.
function transformStockRow(row) {
  return {
    sym:        row.sym,
    rs:         row.rs || 0,
    rsTv:       row.rs_tv,        // TradingView / Lakshmi Mata Pine Script RS
    rsNifty50:  row.rs_nifty50,
    rsMidcap:   row.rs_midcap,
    rsSmallcap: row.rs_smallcap,
    rsMicrocap: row.rs_microcap,
    rsSector:   row.rs_sector,
    last:       row.last_price || 0,
    chg:        row.chg_pct || 0,
    // Gap % — today's open vs prior close. Only present on the live R2
    // snapshot (open/prev_close aren't backfilled into the historical
    // Supabase tables), so this will be undefined on historical views —
    // that's expected, gap-at-open is an intraday/today-only concept.
    open:       row.open,
    prevClose:  row.prev_close,
    gapPct:     (row.open != null && row.prev_close) ? +(((row.open - row.prev_close) / row.prev_close) * 100).toFixed(2) : null,
    pctFromHigh: row.high_52w ? ((row.last_price - row.high_52w) / row.high_52w * 100) : 0,
    sector:      row.sector || 'Other',
    industry:    row.industry || null,
    chgW:        row.chg_w_pct,
    chgM:        row.chg_m_pct,
    inNifty50:   row.in_nifty50   || false,
    inMidcap:    row.in_midcap    || false,
    inSmallcap:  row.in_smallcap  || false,
    inMicrocap:  row.in_microcap  || false,
    rvol:        row.rvol,
    ibvSignal:   row.ibv_signal || false,
    isResistanceBreakout: row.is_resistance_breakout || false,
    is52whBreakout: row.is_52wh_breakout || false,
    resistanceR1:         row.resistance_r1,
    isCupHandleBreakout:  row.is_cup_handle_breakout || false,
    hasCupPattern:        row.has_cup_pattern || false,
    cupDepthPct:          row.cup_depth_pct,
    isGuppyBullishCrossover: row.is_guppy_bullish_crossover || false,
    isGuppyBearishCrossover: row.is_guppy_bearish_crossover || false,
    isGuppyCompressed:       row.is_guppy_compressed || false,
    volSignal:   row.vol_signal,
    rsLineNewHigh: row.rs_line_new_high || false,
    rsLineTrend:   row.rs_line_trend || 'flat',
    rsLineValue:   row.rs_line_value,
    isS2NewEntry:  row.is_s2_new_entry || false,
    // Classic chart patterns — swing-point (fractal pivot) heuristics
    // computed in live_server.py, not exact textbook geometry.
    isHeadShoulders:     row.is_head_shoulders || false,
    isInvHeadShoulders:  row.is_inv_head_shoulders || false,
    isDoubleTop:         row.is_double_top || false,
    isDoubleBottom:      row.is_double_bottom || false,
    triangleType:        row.triangle_type || null,   // 'ascending' | 'descending' | 'symmetrical' | null
    wedgeType:           row.wedge_type || null,       // 'rising' | 'falling' | null
    isFlagBullish:       row.is_flag_bullish || false,
    isFlagBearish:       row.is_flag_bearish || false,
    isPennant:           row.is_pennant || false,
    chartPatternFired:   row.chart_pattern_fired || false,
    marketCap:  row.market_cap,   // ₹ Cr
    pe:         row.pe,
    roe:        row.roe,          // %
    eps:        row.eps,          // ₹
    debtEq:     row.debt_eq,
    promoter:   row.promoter,     // %
    // Growth/trend fundamentals — earnings acceleration + smart-money holding trends
    epsQoq:         row.eps_qoq,           // %
    epsYoy:         row.eps_yoy,           // %
    salesQoq:       row.sales_qoq,         // %
    salesYoy:       row.sales_yoy,         // %
    opmPct:         row.opm_pct,           // %
    opmTrend:       row.opm_trend,         // percentage points vs prior quarter
    epsGrowthStreak:row.eps_growth_streak, // consecutive quarters
    fiiPct:         row.fii_pct,           // %
    fiiTrend:       row.fii_trend,         // percentage points vs prior period
    diiPct:         row.dii_pct,           // %
    diiTrend:       row.dii_trend,         // percentage points vs prior period
    promoterTrend:  row.promoter_trend,    // percentage points vs prior period
    pegRatio:       row.peg_ratio,
    fundamentalScore: row.fundamental_score,  // 0-100, quality-only (not a price target)
    fundamentalLabel: row.fundamental_label,  // 'Excellent' | 'Good' | 'Fair' | 'Poor'
    hist:       row.rs_hist || [],
    rsTrend: {
      trend: row.rs_trend || 'flat',
      slope: row.rs_slope || 0,
    },
    pp: {
      isPP:        row.is_pp || false,
      ppHistory:   row.pp_hist || [],
      ppCount10d:  row.pp_count_10d || 0,
      volRatio:    row.pp_vol_ratio || 0,
      ma10:        row.ma10,
      ma50:        row.ma50,
    },
    hy: {
      isHY:      row.is_hy || false,
      pctOfMax:  row.hy_pct || 0,
      todayVol:  row.volume || 0,
      history:   row.hy_hist || [],
    },
    ht: {
      isHT:      row.is_ht || false,
      pctOfATH:  row.ht_pct || 0,
      history:   row.ht_hist || [],
    },
    ibvHistory: row.ibv_hist || [],
    nearEMA9: {
      isNearEMA9:  row.near_ema9 || false,
      ema9:        row.ema9,
      pctFromEMA9: row.pct_from_ema9,
    },
    nearEMA21: {
      isNearEMA21:  row.near_ema21 || false,
      ema21:        row.ema21,
      pctFromEMA21: row.pct_from_ema21,
    },
    nearEMA50: {
      isNearEMA50:  row.near_ema50 || false,
      ema50:        row.ema50,
      pctFromEMA50: row.pct_from_ema50,
    },
    scanner52wl: {
      near52wLow:       row.near_52wl || false,
      pctFrom52wLow:    row.pct_from_52wl || 999,
      low52w:           row.low_52w || 0,
      high52w:          row.high_52w || 0,
      crossedAboveEMA5: row.crossed_ema5 || false,
      ppVolume:         row.pp_volume_52wl || false,
      isSignal:         row.is_52wl_signal || false,
      ema5Today:        row.ema5,
      volRatio:         row.pp_vol_ratio || 0,
    },
    weakRS: {
      isSignal:   row.is_weak_rs || false,
      chg1d:      row.weak_chg_1d || 0,
      chg5d:      row.weak_chg_5d || 0,
      volSpike:   row.weak_vol_spike || 0,
      isVolSpike: (row.weak_vol_spike || 0) >= 1.5,
    },
    squeeze: {
      inSqueeze:    row.in_squeeze || false,
      squeezeFired: row.squeeze_fired || false,
      bbWidthPct:   row.bb_width_pct,
      squeezeDays:  row.squeeze_days || 0,
    },
    vcp: {
      isVCP:        row.is_vcp || false,
      vcpStage:     row.vcp_stage || 0,
      vcpFired:     row.vcp_fired || false,
      contractions: typeof row.vcp_contractions === 'string'
        ? JSON.parse(row.vcp_contractions || '[]')
        : (row.vcp_contractions || []),
    },
    lastUpdated: row.last_updated,
    scanType:   row.scan_type,
  }
}

/**
 * Fetches today's live stock snapshot from R2 (Cloudflare CDN) instead of
 * querying Supabase directly — same data, served from cache to everyone
 * requesting it within the same ~60s window instead of every user
 * triggering their own database read. Returns null (never throws) on any
 * failure — missing env var, network error, 404, stale/malformed file —
 * so the caller can cleanly fall back to Supabase rather than needing to
 * handle a thrown exception.
 *
 * Staleness check: the snapshot is refreshed roughly every 60s during
 * market hours by the backend. If the newest lastUpdated timestamp in the
 * file is more than 5 minutes old, treat it as unreliable (backend upload
 * stuck, R2 serving a cached-too-long copy, etc.) and fall back to
 * Supabase instead of silently showing stale data.
 */
export async function fetchStocksFromR2() {
  const url = import.meta.env.VITE_R2_SNAPSHOT_URL
  if (!url) return null // R2 not configured yet — not an error, just not set up
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) return null
    // Content sanity check — confirmed necessary via a real production
    // bug: R2 can successfully upload a fresh-TIMESTAMP snapshot that's
    // still wrong-CONTENT (a backend bug once caused the scan to only
    // cover ~298 of ~2400 stocks; the upload itself succeeded with a
    // genuinely recent timestamp, so the freshness check below alone
    // wouldn't have caught it). The real universe is ~2400 stocks — if
    // a snapshot has suspiciously few, treat it as broken and fall
    // back to Supabase, same as a stale one.
    const MIN_EXPECTED_STOCKS = 1500
    if (rows.length < MIN_EXPECTED_STOCKS) return null
    const transformed = rows.map(transformStockRow)
    const newest = transformed.reduce((max, s) => {
      const t = s.lastUpdated ? new Date(s.lastUpdated).getTime() : 0
      return t > max ? t : max
    }, 0)
    const STALE_LIMIT_MS = 5 * 60 * 1000
    if (newest && (Date.now() - newest) > STALE_LIMIT_MS) return null
    return transformed
  } catch (e) {
    return null // network error, malformed JSON, etc. — fall back silently
  }
}

/**
 * Fetch sector RS data from Supabase
 */
export async function fetchSectorsFromDB(historyDate = null) {
  const table = historyDate ? 'sector_history' : 'sectors'
  let query = supabase.from(table).select('*').order('rank', { ascending: true })
  if (historyDate) query = query.eq('snapshot_date', historyDate)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(row => ({
    sector:    row.sector,
    avgRS:     row.avg_rs,
    rank:      row.rank,
    rankChange: row.rank_change,
    count:     row.count,
    ppCount:   row.pp_count,
    improving: row.improving,
    advancesD: row.advances_d,
    advancesW: row.advances_w,
    advancesM: row.advances_m,
    topStocks: typeof row.top_stocks === 'string'
      ? JSON.parse(row.top_stocks)
      : (row.top_stocks || []),
    members:   [], // loaded separately when expanded
    lastUpdated: row.last_updated || row.snapshot_date,
  }))
}

/**
 * Fetch the list of trading dates that have a complete EOD snapshot
 * archived in stock_history — used to populate the date picker.
 * Most recent first.
 */
export async function fetchAvailableHistoryDates() {
  const { data, error } = await supabase
    .from('available_history_dates')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
  if (error) {
    console.warn('Could not fetch available history dates:', error.message)
    return []
  }
  return (data || []).map(r => r.snapshot_date)
}

/**
 * Fetch full 2-year daily OHLCV history for one stock from Supabase.
 * Populated by the backend's startup Yahoo Finance fetch into the
 * `stock_full_history` table (dates, prices, volumes, highs, lows).
 * Returns null if the symbol hasn't been fetched yet.
 */
export async function fetchEmaBreadthHistory(days=35) {
  const { data, error } = await supabase
    .from('ema_breadth_history')
    .select('*')
    .order('date', { ascending: false })
    .limit(days)
  if (error) { console.error('fetchEmaBreadthHistory error:', error.message); return [] }
  return (data || []).reverse() // chronological order
}

export async function fetchMarketBreadthHistory(days=180) {
  const { data, error } = await supabase
    .from('market_breadth_history')
    .select('*')
    .order('date', { ascending: false })
    .limit(days)
  if (error) { console.error('fetchMarketBreadthHistory error:', error.message); return [] }
  return (data || []).reverse() // chronological order for charting
}

export async function fetchSavedScanners(userId) {
  const { data, error } = await supabase
    .from('saved_scanners')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchSavedScanners error:', error.message); return [] }
  return data || []
}

export async function saveScanner(userId, name, filters) {
  const { data, error } = await supabase
    .from('saved_scanners')
    .insert({ user_id: userId, name, filters })
    .select()
    .single()
  if (error) return { error: error.message }
  return { data }
}

export async function deleteScanner(scannerId) {
  const { error } = await supabase.from('saved_scanners').delete().eq('id', scannerId)
  if (error) return { error: error.message }
  return { success: true }
}

export async function fetchStockFullHistory(sym) {
  const cleanSym = (sym || '').trim()
  // Confirmed via direct Supabase inspection: rows exist with real data
  // for symbols that .eq('sym', sym) was reporting as "not found" (e.g.
  // GRSE) — a case-sensitivity or stray-whitespace mismatch between how
  // the symbol is stored vs queried. .ilike() (case-insensitive, and we
  // trim first) is robust to case but NOT to extra whitespace/hidden
  // characters inside the stored value itself, which a wildcard search
  // below can still catch.
  let { data, error } = await supabase
    .from('stock_full_history')
    .select('*')
    .ilike('sym', cleanSym)
    .maybeSingle()

  if (!error && !data) {
    // Fallback: wildcard search, then pick the candidate whose trimmed
    // value matches case-insensitively — catches stray leading/trailing
    // whitespace or non-breaking spaces in the stored sym column.
    const wc = await supabase
      .from('stock_full_history')
      .select('*')
      .ilike('sym', `%${cleanSym}%`)
      .limit(5)
    if (!wc.error && wc.data && wc.data.length) {
      const match = wc.data.find(r => (r.sym || '').trim().toUpperCase() === cleanSym.toUpperCase())
      if (match) { data = match; error = null }
      else console.warn(`fetchStockFullHistory(${sym}): wildcard search found candidates but none matched exactly:`,
        wc.data.map(r => JSON.stringify(r.sym)))
    }
  }

  if (error) {
    console.error(`fetchStockFullHistory(${sym}) error:`, error.message || error)
    return { error: error.message || String(error) }
  }
  if (!data) return { error: `No price history stored yet for ${sym} — it may not have completed its initial fetch.` }

  // jsonb columns come back already parsed via supabase-js, but handle
  // the string case too in case they were ever stored as text.
  const parseArr = v => {
    if (v == null) return []
    return typeof v === 'string' ? JSON.parse(v) : v
  }

  return {
    sym:       data.sym,
    dates:     parseArr(data.dates),
    prices:    parseArr(data.prices),
    volumes:   parseArr(data.volumes),
    highs:     parseArr(data.highs),
    lows:      parseArr(data.lows),
    opens:     parseArr(data.opens),
    daysCount: data.days_count,
    updatedAt: data.updated_at,
  }
}

/**
 * Fetch scan metadata (last update time, next scan time)
 */
export async function fetchScanMeta() {
  const { data, error } = await supabase
    .from('scan_meta')
    .select('*')
    .eq('id', 'latest')
    .single()
  if (error) return null
  return data
}

/**
 * Fetch stocks for a specific sector (for expanded sector view)
 */
export async function fetchSectorStocks(sector) {
  const { data, error } = await supabase
    .from('stocks')
    .select('sym, rs, last_price, chg_pct, is_pp, rs_trend')
    .eq('sector', sector)
    .order('rs', { ascending: false })
  if (error) return []
  return (data || []).map(row => ({
    sym:    row.sym,
    rs:     row.rs || 0,
    last:   row.last_price || 0,
    chg:    row.chg_pct || 0,
    pp:     { isPP: row.is_pp || false },
    rsTrend: { trend: row.rs_trend || 'flat' },
  }))
}

/**
 * Fetch index dashboard data — all indices with their daily/weekly/monthly
 * performance, RS-TV rating, Weinstein stage, and top/bottom constituent stocks.
 */
export async function fetchIndexDashboard() {
  const { data, error } = await supabase
    .from('index_dashboard')
    .select('*')
    .order('rs_tv', { ascending: false, nullsLast: true })
  if (error) throw error
  return (data || []).map(row => ({
    name:          row.name,
    lastPrice:     row.last_price,
    chgD:          row.chg_d,
    chgW:          row.chg_w,
    chgM:          row.chg_m,
    chgQ:          row.chg_q,
    chgY:          row.chg_y,
    rankD:         row.rank_d,
    rankW:         row.rank_w,
    rankM:         row.rank_m,
    rankWChange:   row.rank_w_change,
    totalIndices:  row.total_indices,
    rsTv:          row.rs_tv,
    stage:         row.stage,
    stageLabel:    row.stage_label,
    aboveMa10:     row.above_ma10,
    aboveMa30:     row.above_ma30,
    high52w:       row.high_52w,
    low52w:        row.low_52w,
    pctFromHigh:   row.pct_from_high,
    topStocks:     typeof row.top_stocks === 'string' ? JSON.parse(row.top_stocks||'[]') : (row.top_stocks||[]),
    botStocks:     typeof row.bot_stocks === 'string' ? JSON.parse(row.bot_stocks||'[]') : (row.bot_stocks||[]),
    lastUpdated:   row.last_updated,
  }))
}

/**
 * Lightweight single-row fetch of a stock's current live price + volume
 * from the `stocks` table (updated ~every minute during market hours by
 * the backend scan). Used to make "Our Chart"'s TODAY candle live-update
 * instead of only refreshing once at EOD — not a full intraday feed
 * (no separate O/H/L tracked server-side beyond last_price), so the
 * running high/low for today's synthetic candle is tracked client-side
 * across polls instead.
 */
export async function fetchLiveStockPrice(sym) {
  const { data, error } = await supabase
    .from('stocks')
    .select('last_price,volume')
    .ilike('sym', (sym||'').trim())
    .maybeSingle()
  if (error || !data) return null
  return { price: data.last_price, volume: data.volume }
}

/**
 * Fetch an index's price history for "Our Chart" — index_price_history
 * only stores a bare `prices` array (no dates/opens/highs/lows/volumes
 * like stock_full_history has), populated by the backend for RS-TV
 * calculations, not originally meant for charting. Synthesizes dates by
 * counting back trading days from today, and sets opens=highs=lows=
 * prices so it can still be handed to the same chart component — the
 * caller should force line-chart display (no real OHLC exists) rather
 * than candles, which would just show degenerate flat-body candles.
 */
export async function fetchIndexPriceHistory(name) {
  const { data, error } = await supabase
    .from('index_price_history')
    .select('prices')
    .eq('name', name)
    .maybeSingle()
  if (error || !data || !data.prices) {
    return { error: `No price history stored yet for ${name}.` }
  }
  const prices = typeof data.prices === 'string' ? JSON.parse(data.prices) : data.prices
  if (!Array.isArray(prices) || prices.length === 0) {
    return { error: `No price history stored yet for ${name}.` }
  }
  // Synthesize dates counting backward from today (no real per-point
  // dates exist in this table) — approximate trading days by skipping
  // weekends, close enough for a chart x-axis label.
  const dates = []
  let d = new Date()
  for (let i = 0; i < prices.length; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
    dates.unshift(d.toISOString().split('T')[0])
    d.setDate(d.getDate() - 1)
  }
  return {
    sym: name,
    dates,
    prices,
    opens: prices, highs: prices, lows: prices,
    volumes: prices.map(() => 0),
    daysCount: prices.length,
  }
}

/**
 * Logs one page view for the landing page's usage stats. visitorId is a
 * random UUID generated once per browser and persisted to localStorage
 * — not tied to any real account/login. Every visit gets its own row
 * (no dedup at insert time) so "total views" and "unique visitors" can
 * be told apart later — a visitor who reloads 3 times in a day adds 3
 * views but still counts as 1 unique visitor. Returns the visitor_id so
 * callers can await this before fetching stats, otherwise the visitor's
 * own just-logged visit can lose a race against the stats query and not
 * show up until their next visit.
 */
export async function logPageView() {
  try {
    let visitorId = localStorage.getItem('lakshmimata-visitor-id')
    if (!visitorId) {
      visitorId = crypto.randomUUID()
      localStorage.setItem('lakshmimata-visitor-id', visitorId)
    }
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('page_views').insert({ visitor_id: visitorId, viewed_date: today })
    return visitorId
  } catch (e) { return null } // never let analytics break the landing page
}

/**
 * Aggregated usage stats for the landing page: all-time unique visitors,
 * all-time total views, and a day-by-day breakdown of both for the last
 * `days` days. Aggregated client-side from raw rows — fine at this
 * scale (a handful of visitors/day), would need a proper Postgres view/
 * RPC if this ever grew into the millions of rows.
 */
export async function fetchUsageStats(days = 14) {
  const { data, error } = await supabase
    .from('page_views')
    .select('visitor_id,viewed_date')
  if (error || !data) return { uniqueUsers: null, totalViews: null, dailyTrend: [] }

  const uniqueUsers = new Set(data.map(r => r.visitor_id)).size
  const totalViews = data.length

  const byDate = {} // date -> { views, visitorIds: Set }
  for (const row of data) {
    if (!byDate[row.viewed_date]) byDate[row.viewed_date] = { views: 0, visitorIds: new Set() }
    byDate[row.viewed_date].views += 1
    byDate[row.viewed_date].visitorIds.add(row.visitor_id)
  }

  const dailyTrend = []
  const d = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(d)
    dt.setDate(dt.getDate() - i)
    const key = dt.toISOString().split('T')[0]
    const day = byDate[key]
    dailyTrend.push({ date: key, views: day?.views || 0, uniqueUsers: day?.visitorIds.size || 0 })
  }

  return { uniqueUsers, totalViews, dailyTrend }
}

/**
 * Fetches the AI Best Picks track record — one row per (symbol, date)
 * that stock was ever in the top 30, going back `days` days. price_at_pick
 * is locked in the first time a symbol is picked on a given day (never
 * overwritten by later same-day refreshes), so the caller can compare it
 * against a stock's current live price to show whether the pick actually
 * moved in the right direction afterward.
 */
export async function fetchBestPicksHistory(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('best_picks_history')
    .select('symbol,picked_date,rank,score,reasoning,price_at_pick,stop_loss,target,sector,market_cap')
    .gte('picked_date', since)
    .order('picked_date', { ascending: false })
    .order('rank', { ascending: true })
  if (error) { console.error('fetchBestPicksHistory error:', error.message); return [] }
  return data || []
}

/**
 * Fetches the AI Best Picks list — a composite technical+fundamental
 * score computed every scan cycle by the live-scan service, refreshed
 * at most hourly, with an AI-generated (or free templated, if
 * ANTHROPIC_API_KEY isn't set) one-line rationale per pick. Full-replace
 * table (today's top N only), so a plain unordered select is enough —
 * `rank` already reflects the current ordering.
 */
export async function fetchBestPicks() {
  const { data, error } = await supabase
    .from('best_picks')
    .select('symbol,rank,score,reasoning,last_price,stop_loss,target,chg_pct,sector,industry,market_cap,rs_tv,weinstein_stage,vcp_fired,is_resistance_breakout,is_cup_handle_breakout,eps_yoy,sales_yoy,roe,promoter_trend,generated_at')
    .order('rank', { ascending: true })
  if (error) {
    console.error('fetchBestPicks error:', error.message)
    // Also surface this to the app-level error banner (see App.jsx's
    // jsError state) — this function's own try/catch normally swallows
    // Supabase errors quietly into console.error, which is invisible on
    // mobile with no devtools access. Temporary diagnostic for the AI
    // Picks blank-page investigation.
    if (typeof window !== 'undefined') window.__lastSupabaseError = `fetchBestPicks: ${error.message}`
    return []
  }
  return data || []
}

/**
 * Fetches a single symbol's recent quarterly results history (Sales/PAT/
 * EPS only — no EBITDA, that field isn't captured from NSE's feed yet)
 * for a Screener-style comparison card: current quarter vs previous
 * quarter vs same quarter last year. Pulls the last 8 filed quarters so
 * the caller has enough to find a same-quarter-last-year match even if
 * a quarter was skipped/delayed, and prefers Consolidated over
 * Standalone when both exist for the same period (same dedup priority
 * used elsewhere in the app).
 */
export async function fetchFinancialResultsHistory(symbol) {
  // 90-day filed_at window - by design this view won't show a proper
  // YoY comparison (that row is typically filed ~365 days ago), a
  // deliberate tradeoff to keep this query bounded/cheap rather than
  // scanning unbounded history per symbol.
  const since = new Date(Date.now() - 90 * 864e5).toISOString()
  const { data, error } = await supabase
    .from('financial_results')
    .select('period_ended,result_type,sales,other_income,pbt,exceptional_item,pat,eps,opm_pct,filed_at,sales_qoq_pct,pat_qoq_pct,sales_yoy_pct,pat_yoy_pct,eps_yoy_pct')
    .eq('symbol', symbol)
    .gt('filed_at', since)
    .order('period_ended', { ascending: false })
    .limit(16)
  if (error) { console.error('fetchFinancialResultsHistory error:', error.message); return [] }
  // Dedupe to one row per period_ended, preferring Consolidated.
  const byPeriod = {}
  for (const row of (data || [])) {
    const existing = byPeriod[row.period_ended]
    const isConsolidated = (row.result_type || '').toLowerCase().includes('consolidated')
    if (!existing || (isConsolidated && !(existing.result_type||'').toLowerCase().includes('consolidated'))) {
      byPeriod[row.period_ended] = row
    }
  }
  // period_ended is stored as 'DD-Mon-YYYY' (e.g. '30-Jun-2024'), not
  // ISO - string comparison (localeCompare) would sort incorrectly
  // (e.g. '01-Jan-2025' would sort before '31-Dec-2024' alphabetically,
  // backwards chronologically). Parse to real Date objects to sort
  // correctly regardless of the underlying string format.
  const toDate = (s) => {
    const d = new Date(s)
    return isNaN(d.getTime()) ? new Date(0) : d
  }
  return Object.values(byPeriod).sort((a,b)=>toDate(b.period_ended)-toDate(a.period_ended)).slice(0, 8)
}

/**
 * Fetches recent corporate announcements across all tracked stocks —
 * populated by the backend's separate fundamentals+announcements worker
 * service, polling NSE's announcements feed every ~15 minutes. Paginated
 * (offset-based) since this feed accumulates continuously and showing
 * ALL history at once isn't useful or necessary.
 */
export async function fetchAnnouncementsFromR2() {
  const url = import.meta.env.VITE_R2_ANNOUNCEMENTS_SNAPSHOT_URL
  if (!url) return null // not configured yet — not an error, just not set up
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) return null
    return rows
  } catch (e) {
    return null // network error, malformed JSON, etc. — fall back silently
  }
}

export async function fetchConcallSummaries(symbol) {
  // Returns all AI-generated concall summaries for a symbol, most
  // recent first. status='done' rows have real content; 'skipped'
  // (schedule-only notice, no actual discussion) and 'failed' rows are
  // filtered out here since they have nothing worth showing.
  const { data, error } = await supabase
    .from('concall_summaries')
    .select('announced_at,attachment_url,summary,status')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .not('summary', 'is', null)
    .order('announced_at', { ascending: false })
    .limit(5)
  if (error) { console.error('fetchConcallSummaries error:', error.message); return [] }
  return data || []
}

export async function fetchPptSummaries(symbol) {
  // Returns AI-generated investor-presentation summaries for a symbol,
  // most recent first - a third distinct document type from both
  // concall_summaries (results PDF) and transcript_summaries (call
  // transcript). status='done' rows have real structured content.
  const { data, error } = await supabase
    .from('ppt_summaries')
    .select('announced_at,attachment_url,status,financial_highlights,business_segments,'
      + 'strategic_initiatives,capital_allocation,industry_outlook,operational_kpis,'
      + 'risks_flagged,regulatory_legal,guidance_direction,overall_summary,'
      + 'emerging_themes,theme_evidence,theme_intensity')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .order('announced_at', { ascending: false })
    .limit(5)
  if (error) { console.error('fetchPptSummaries error:', error.message); return [] }
  return data || []
}

export async function fetchTranscriptSummaries(symbol) {
  // Returns AI-generated earnings-call TRANSCRIPT summaries for a
  // symbol, most recent first - a different document type from
  // concall_summaries above (which summarizes the results PDF filing,
  // not the separate call transcript). status='done' rows have real
  // structured content; 'skipped' (not a genuine transcript, or no
  // usable content found) and transient-error rows are filtered out.
  const { data, error } = await supabase
    .from('transcript_summaries')
    .select('announced_at,attachment_url,status,financial_highlights,cost_margin_commentary,'
      + 'expansion_capex,outlook_guidance,guidance_direction,management_changes,'
      + 'capital_allocation,competitive_positioning,operational_kpis,risks_flagged,'
      + 'regulatory_legal,key_concerns,overall_summary,'
      + 'emerging_themes,theme_evidence,theme_intensity')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .order('announced_at', { ascending: false })
    .limit(5)
  if (error) { console.error('fetchTranscriptSummaries error:', error.message); return [] }
  return data || []
}

export const EMERGING_THEME_LABELS = {
  data_center: 'Data Center',
  AI: 'AI',
  semiconductor: 'Semiconductor',
  EMS: 'EMS',
  defence: 'Defence',
  aerospace: 'Aerospace',
  nuclear: 'Nuclear',
  renewable: 'Renewable',
  green_hydrogen: 'Green Hydrogen',
  EV: 'EV',
  battery: 'Battery',
  railways: 'Railways',
  CDMO: 'CDMO',
  specialty_chem: 'Specialty Chem',
  fintech_infra: 'Fintech Infra',
}

export async function fetchEmergingThemeRadar(days = 30) {
  // Aggregates emerging_themes from recent transcript + PPT summaries
  // into { themeId: [{symbol, source, announced_at, intensity, evidence}] }.
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const select = 'symbol,announced_at,emerging_themes,theme_evidence,theme_intensity,attachment_url'
  const [tx, ppt] = await Promise.all([
    supabase.from('transcript_summaries').select(select)
      .eq('status', 'done').not('emerging_themes', 'is', null)
      .gte('announced_at', since).order('announced_at', { ascending: false }).limit(500),
    supabase.from('ppt_summaries').select(select)
      .eq('status', 'done').not('emerging_themes', 'is', null)
      .gte('announced_at', since).order('announced_at', { ascending: false }).limit(500),
  ])
  if (tx.error) console.error('fetchEmergingThemeRadar transcript:', tx.error.message)
  if (ppt.error) console.error('fetchEmergingThemeRadar ppt:', ppt.error.message)

  const byTheme = {}
  const pushRow = (row, source) => {
    let themes = row.emerging_themes
    if (typeof themes === 'string') {
      try { themes = JSON.parse(themes) } catch { themes = [] }
    }
    if (!Array.isArray(themes) || themes.length === 0) return
    let evidence = row.theme_evidence
    if (typeof evidence === 'string') {
      try { evidence = JSON.parse(evidence) } catch { evidence = evidence ? [evidence] : [] }
    }
    for (const theme of themes) {
      if (!byTheme[theme]) byTheme[theme] = []
      // One row per symbol per theme (keep newest)
      if (byTheme[theme].some(x => x.symbol === row.symbol)) continue
      byTheme[theme].push({
        symbol: row.symbol,
        source,
        announced_at: row.announced_at,
        intensity: row.theme_intensity || 'medium',
        evidence: Array.isArray(evidence) ? evidence.slice(0, 2) : [],
        attachment_url: row.attachment_url,
      })
    }
  }
  ;(tx.data || []).forEach(r => pushRow(r, 'concall'))
  ;(ppt.data || []).forEach(r => pushRow(r, 'ppt'))
  return byTheme
}

export async function fetchAnnouncements(limit = 50, offset = 0, categoryLike = null, filters = {}, excludeCategoryLike = null) {
  // R2 fast-path — only for the single default/unfiltered case (first
  // page, no category/sector/mcap/order-size/symbol/date filters,
  // limit within what the cached snapshot covers). Same tradeoff as
  // the stocks R2 cache: covers the single most common case cheaply,
  // everything filtered/paginated still queries Supabase directly
  // below rather than trying to cache every filter combination.
  const isDefaultView = offset === 0 && !categoryLike && !excludeCategoryLike && limit <= 100 &&
    !filters.sector && !filters.industry && !filters.mcapMin && !filters.mcapMax &&
    !filters.orderSize && !(filters.syms && filters.syms.length > 0) && !filters.dateFilter
  if (isDefaultView) {
    const r2Rows = await fetchAnnouncementsFromR2()
    if (r2Rows) return r2Rows.slice(0, limit)
  }

  // filters: { sector, industry, mcapMin, mcapMax } — all optional.
  // Applied server-side (not client-side after fetch) so the offset-based
  // pagination above stays accurate against the filtered set, same as
  // the scanner's own sector/mcap filters elsewhere in the app.
  const { sector, industry, mcapMin, mcapMax, orderSize, syms, dateFilter } = filters
  let q = supabase
    .from('corporate_announcements')
    .select('symbol,category,subject,attachment_url,announced_at,sector,industry,market_cap,ai_rating,ai_summary,order_size')
    .order('announced_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (categoryLike) {
    // categoryLike can be a single keyword or an array of keywords —
    // NSE's own category text isn't consistent (e.g. concalls show up
    // as "Con Call", "Conference Call", or "Investor / Analyst Meet"
    // depending on the filer), so several tabs need an OR match rather
    // than a single ILIKE.
    const keywords = Array.isArray(categoryLike) ? categoryLike : [categoryLike]
    // Match against BOTH category and subject — NSE frequently files
    // results under category "Outcome of Board Meeting" with "financial
    // results" only in the subject text, so category-only matching makes
    // the Results/Order Book/Dividend tabs look empty even when the
    // announcements exist.
    q = q.or(keywords.flatMap(k => [`category.ilike.%${k}%`, `subject.ilike.%${k}%`]).join(','))
  }
  if (excludeCategoryLike) {
    // Noise control per tab: e.g. the Results tab excludes 'Copy of
    // Newspaper Publication' reprints, and Transcript filings. Must
    // check BOTH category and subject — same reason the include filter
    // above does — otherwise a keyword that only appears in the subject
    // (like "Transcript" in a concall-transcript filing whose category
    // is just "Analysts/Institutional Investor Meet") never actually
    // gets excluded. NOT(category ILIKE x OR subject ILIKE x) is
    // equivalent to NOT(category ILIKE x) AND NOT(subject ILIKE x) by
    // De Morgan's law, so chaining two .not() calls per keyword (they
    // combine with AND by default) gives the correct exclusion.
    for (const k of (Array.isArray(excludeCategoryLike) ? excludeCategoryLike : [excludeCategoryLike])) {
      q = q.not('category', 'ilike', `%${k}%`).not('subject', 'ilike', `%${k}%`)
    }
  }
  if (sector) q = q.eq('sector', sector)
  if (industry) q = q.eq('industry', industry)
  if (orderSize) q = q.eq('order_size', orderSize)
  if (syms && syms.length > 0) q = q.in('symbol', syms)
  if (mcapMin !== undefined && mcapMin !== '' && mcapMin != null) q = q.gte('market_cap', +mcapMin)
  if (mcapMax !== undefined && mcapMax !== '' && mcapMax != null) q = q.lte('market_cap', +mcapMax)
  if (dateFilter) {
    // announced_at is stored as a proper timezone-aware instant (fixed
    // to correctly represent IST, not misread as UTC — see backend
    // _nse_local_to_utc_iso). Passing an explicit +05:30 offset here
    // means "the IST calendar day", regardless of what timezone the
    // browser or Postgres session default to.
    const next = new Date(dateFilter + 'T00:00:00+05:30')
    next.setUTCDate(next.getUTCDate() + 1)
    q = q.gte('announced_at', `${dateFilter}T00:00:00+05:30`)
         .lt('announced_at', next.toISOString())
  }
  const { data, error } = await q
  if (error) { console.error('fetchAnnouncements error:', error.message); return [] }
  return data || []
}

/**
 * Distinct sector/industry values seen across saved announcements, for
 * populating the Announcements tab's filter dropdowns. Small, cheap
 * query (no announcement text/attachments pulled) — fine to call on tab
 * mount without its own loading state.
 */
export async function fetchAnnouncementFilterOptions() {
  const { data, error } = await supabase
    .from('corporate_announcements')
    .select('sector,industry')
    .not('sector', 'is', null)
  if (error) { console.error('fetchAnnouncementFilterOptions error:', error.message); return { sectors: [], industries: [] } }
  const sectors = [...new Set((data || []).map(r => r.sector).filter(Boolean))].sort()
  const industries = [...new Set((data || []).map(r => r.industry).filter(Boolean))].sort()
  return { sectors, industries }
}

/**
 * New announcements for a set of watchlist symbols since a given ISO
 * timestamp — polled by the in-app watchlist alert (sound + browser
 * notification). Kept intentionally tiny: only the fields the toast/
 * notification needs, capped at 20 rows per poll.
 */
export async function fetchWatchlistAnnouncementsSince(syms, sinceISO) {
  if (!syms || syms.length === 0) return []
  const { data, error } = await supabase
    .from('corporate_announcements')
    .select('symbol,category,subject,announced_at,ai_rating')
    .in('symbol', syms)
    .gt('announced_at', sinceISO)
    .order('announced_at', { ascending: false })
    .limit(20)
  if (error) { console.error('fetchWatchlistAnnouncementsSince error:', error.message); return [] }
  return data || []
}

/**
 * Recent structured quarterly results (Sales/PAT/EPS as filed to NSE),
 * keyed by symbol — the Results tab overlays these numbers on matching
 * announcements. Last 45 days covers a full results season window.
 */
export async function fetchRecentFinancialResults() {
  const since = new Date(Date.now() - 45 * 864e5).toISOString()
  const { data, error } = await supabase
    .from('financial_results')
    .select('symbol,period_ended,result_type,sales,other_income,pbt,pat,eps,opm_pct,filed_at')
    .gt('filed_at', since)
    .order('filed_at', { ascending: false })
    .limit(1000)
  if (error) { console.error('fetchRecentFinancialResults error:', error.message); return {} }
  const bySymbol = {}
  for (const r of data || []) {
    // first (most recent) row per symbol wins; prefer consolidated when
    // both arrive at the same recency
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = r
  }
  return bySymbol
}

/**
 * Symbol list for an index scope (nifty50/midcap/smallcap/microcap) —
 * lets tabs whose tables lack index-membership columns (like
 * announcements) filter by index via .in('symbol', ...). Cached per
 * session: membership only changes at rebalances.
 */
const _indexSymCache = {}
export async function fetchIndexSymbols(indexFilter) {
  if (!indexFilter || indexFilter === 'all') return null
  if (_indexSymCache[indexFilter]) return _indexSymCache[indexFilter]
  const col = { nifty50: 'in_nifty50', midcap: 'in_midcap', smallcap: 'in_smallcap', microcap: 'in_microcap' }[indexFilter]
  if (!col) return null
  const { data, error } = await supabase.from('stocks').select('sym').eq(col, true).limit(1000)
  if (error) { console.error('fetchIndexSymbols error:', error.message); return null }
  const syms = (data || []).map(r => r.sym)
  _indexSymCache[indexFilter] = syms
  return syms
}
