// ── DB Reader — reads pre-computed signals from Supabase ─────────────
// Called by App.jsx instead of running live scans in browser

import { supabase } from './supabase'
import { fetchUpstoxQuotes } from './upstoxQuotes'
import { resolveIndustry, resolveSector, getCompanyName } from '../data/industries'
import { enrichHistoryLeaderFlags } from './historyLeaders'

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
  // Pull extra history so the client can warm up JdK RS-Ratio /
  // RS-Momentum (needs ~14 SMA + ~10 ROC bars) before the visible trail.
  const lookback = Math.max(days + 45, 70)
  const { data, error } = await supabase
    .from('sector_history')
    .select('snapshot_date,sector,avg_rs,rank,count')
    .order('snapshot_date', { ascending: false })
    .limit(lookback * 40)
  if (error) { console.error('fetchSectorRotation error:', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-lookback)
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
      windowDays: days,
      trailDays:  sorted.length,
      // Full daily RS trail (avg_rs) — client converts to JdK RS-Ratio /
      // RS-Momentum for the StockCharts-style RRG axes.
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
  const lookback = Math.max(days + 45, 70)
  const { data, error } = await supabase
    .from('index_history')
    .select('snapshot_date,name,rs_tv,rank_d')
    .order('snapshot_date', { ascending: false })
    .limit(lookback * 40)
  if (error) { console.error('fetchIndexRotation error (index_history table may not exist yet):', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-lookback)
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
      windowDays: days,
      trailDays:  sorted.length,
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
  const lookback = Math.max(days + 45, 70)
  const { data, error } = await supabase
    .from('stock_history')
    .select('snapshot_date,sym,rs_tv,rs,sector')
    .in('sym', syms)
    .order('snapshot_date', { ascending: false })
    .limit(lookback * Math.max(syms.length, 1) * 2)
  if (error) { console.error('fetchWatchlistRotation error:', error.message); return [] }
  if (!data || data.length === 0) return []

  const recentDates = [...new Set(data.map(r => r.snapshot_date))].sort().slice(-lookback)
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
      windowDays: days,
      trailDays:  sorted.length,
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
  const transformed = (data || []).map(transformStockRow)
  if (historyDate) {
    await enrichHistoryLeaderFlags(transformed, data || [], historyDate)
  }
  return transformed
}

// Transform one raw DB row (snake_case, matching the Postgres/R2 snapshot
// shape) into the camelCase shape the rest of the app expects.
function transformStockRow(row) {
  const industry = resolveIndustry(row.sym, row.industry, row.sector)
  const sector = resolveSector(row.sym, row.sector, industry) || row.sector || 'Other'
  return {
    sym:        row.sym,
    name:       row.name || getCompanyName(row.sym) || null,
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
    sector,
    industry:    industry || null,
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
    pb:             row.pb,
    roce:           row.roce,
    industryPe:     row.industry_pe,
    divYield:       row.div_yield,
    cfo:            row.cfo,            // ₹ Cr operating cash flow
    fcf:            row.fcf,            // ₹ Cr free cash flow
    cfoPat:         row.cfo_pat,        // CFO / PAT ratio
    nim:            row.nim,            // bank NIM %
    gnpa:           row.gnpa,           // Gross NPA %
    nnpa:           row.nnpa,           // Net NPA %
    car:            row.car,            // Capital adequacy / CRAR %
    casa:           row.casa,           // CASA %
    fundamentalScore: row.fundamental_score,  // 0-100, quality-only (not a price target)
    fundamentalLabel: row.fundamental_label,  // 'Excellent' | 'Good' | 'Fair' | 'Poor'
    isPead:           row.is_pead || false,
    daysSinceResults: row.days_since_results,
    lastResultsDate:  row.last_results_date,
    isCanslim:        row.is_canslim || false,
    canslimScore:     row.canslim_score,
    canslimFlags:     row.canslim_flags,
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
    isBullSnort: row.is_bull_snort || false,
    bullSnortVolRatio: row.bull_snort_vol_ratio || 0,
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
    nearEMA5: (() => {
      const ema5 = row.ema5
      const last = row.last_price
      const rs = row.rs ?? 0
      let pct = row.pct_from_ema5
      let isNear = row.near_ema5
      if (isNear == null && ema5 && last && rs >= 90) {
        pct = +((last - ema5) / ema5 * 100).toFixed(2)
        isNear = Math.abs(pct) <= 3
      }
      return {
        isNearEMA5: !!isNear,
        ema5,
        pctFromEMA5: pct ?? null,
      }
    })(),
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
      // Squeeze Pro (John Carter): compression tier, streak and momentum
      // direction. Until the backend scan has populated these, fall back to
      // the classic fields — the old in_squeeze test IS the mid tier (BB
      // inside the 1.5-ATR Keltner), so the tier degrades honestly.
      level:     row.sqz_level || (row.in_squeeze ? 'mid' : 'none'),
      sqzDays:   row.sqz_days ?? row.squeeze_days ?? 0,
      highDays:  row.sqz_high_days ?? 0,
      mom:       row.sqz_mom ?? null,
      momSlope:  row.sqz_mom_slope ?? null,
      bias:      row.sqz_bias || null,
      firedDir:  row.sqz_fired_dir || null,
      hasPro:    row.sqz_level != null,
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

/** Persistent industry rank movement and group metrics from the live scanner. */
export async function fetchIndustriesFromDB() {
  const { data, error } = await supabase
    .from('industries')
    .select('*')
    .order('rank', { ascending: true })
  if (error) {
    // Migration may not be deployed yet; the Market page can still calculate
    // today's rows from stocks, only weekly rank movement will be unavailable.
    console.warn('Could not fetch industries:', error.message)
    return []
  }
  return (data || []).map(row => ({
    name: row.industry,
    parentSector: row.parent_sector,
    rank: row.rank,
    rankChange: row.rank_change,
    avgRS: row.avg_rs,
    count: row.count,
    ppCount: row.pp_count,
    improving: row.improving,
    advancesD: row.advances_d,
    advancesW: row.advances_w,
    advancesM: row.advances_m,
    lastUpdated: row.last_updated,
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

/** Daily FII/FPI & DII cash-market net flows (₹ Cr) — NSE provisional, post close. */
export async function fetchFiiDiiDailyHistory(days = 90) {
  const { data, error } = await supabase
    .from('fii_dii_daily')
    .select('trade_date,fii_buy,fii_sell,fii_net,dii_buy,dii_sell,dii_net,fetched_at')
    .order('trade_date', { ascending: false })
    .limit(days)
  if (error) {
    console.error('fetchFiiDiiDailyHistory error:', error.message)
    return []
  }
  return (data || []).reverse()
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

export const MAX_USER_LAYOUTS = 3

/** Fetch saved UI layouts for a user (max 3 slots). */
export async function fetchUserLayouts(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('user_layouts')
    .select('id,user_id,slot,name,columns,col_order,chart_sections,chart_wide,chart_panel_pct,updated_at')
    .eq('user_id', userId)
    .order('slot', { ascending: true })
  if (error) {
    console.error('fetchUserLayouts error:', error.message)
    return []
  }
  return data || []
}

/** Save or overwrite one layout slot (1–3). */
export async function saveUserLayout(userId, { slot, name, columns, colOrder, chartSections, chartWide, chartPanelPct }) {
  if (!userId) return { error: 'Sign in to save layouts.' }
  const s = Number(slot)
  if (!Number.isInteger(s) || s < 1 || s > MAX_USER_LAYOUTS) {
    return { error: `Choose slot 1–${MAX_USER_LAYOUTS}.` }
  }
  const label = (name || '').trim().slice(0, 40) || `Layout ${s}`
  const wide = Number(chartWide)
  const pct = chartPanelPct != null ? Number(chartPanelPct) : null
  const payload = {
    user_id: userId,
    slot: s,
    name: label,
    columns: columns || {},
    col_order: colOrder || [],
    chart_sections: chartSections || [],
    chart_wide: [0, 1, 2].includes(wide) ? wide : 0,
    chart_panel_pct: pct != null && Number.isFinite(pct) ? pct : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_layouts')
    .upsert(payload, { onConflict: 'user_id,slot' })
    .select('id,user_id,slot,name,columns,col_order,chart_sections,chart_wide,chart_panel_pct,updated_at')
    .single()
  if (error) {
    console.error('saveUserLayout error:', error.message)
    return { error: error.message || 'Could not save layout' }
  }
  return { data }
}

export async function deleteUserLayout(userId, slot) {
  if (!userId) return { error: 'Sign in to delete layouts.' }
  const s = Number(slot)
  if (!Number.isInteger(s) || s < 1 || s > MAX_USER_LAYOUTS) {
    return { error: 'Invalid layout slot.' }
  }
  const { error } = await supabase
    .from('user_layouts')
    .delete()
    .eq('user_id', userId)
    .eq('slot', s)
  if (error) return { error: error.message }
  return { success: true }
}

/** Load per-user alert enable/disable prefs (null if none saved yet). */
export async function fetchUserAlertPrefs(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_alert_prefs')
    .select('prefs,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('fetchUserAlertPrefs error:', error.message)
    return null
  }
  return data?.prefs && typeof data.prefs === 'object' ? data.prefs : null
}

/** Upsert per-user alert prefs. */
export async function saveUserAlertPrefs(userId, prefs) {
  if (!userId) return { error: 'Sign in to save alert preferences.' }
  const payload = {
    user_id: userId,
    prefs: prefs || {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_alert_prefs')
    .upsert(payload, { onConflict: 'user_id' })
    .select('prefs,updated_at')
    .single()
  if (error) {
    console.error('saveUserAlertPrefs error:', error.message)
    return { error: error.message || 'Could not save alert preferences' }
  }
  return { data }
}

export async function fetchAppSetting(key) {
  if (!key) return ''
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) {
    console.error('fetchAppSetting error:', error.message)
    return ''
  }
  return (data?.value || '').trim()
}

export async function fetchUserTelegram(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_telegram')
    .select('chat_id,telegram_username,enabled,link_code,link_code_expires_at,linked_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('fetchUserTelegram error:', error.message)
    return null
  }
  return data || null
}

function randomTelegramLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  return [...buf].map(b => chars[b % chars.length]).join('')
}

/** Create a short-lived /start code so the scanner can bind this user to a Telegram chat. */
export async function startTelegramLink(userId) {
  if (!userId) return { error: 'Sign in to connect Telegram.' }
  const code = randomTelegramLinkCode()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const payload = {
    user_id: userId,
    enabled: true,
    link_code: code,
    link_code_expires_at: expires,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_telegram')
    .upsert(payload, { onConflict: 'user_id' })
    .select('chat_id,telegram_username,enabled,link_code,link_code_expires_at,linked_at')
    .single()
  if (error) {
    console.error('startTelegramLink error:', error.message)
    return { error: error.message || 'Could not start Telegram link. Run add_user_telegram.sql in Supabase.' }
  }
  return { data, code }
}

export async function setTelegramAlertsEnabled(userId, enabled) {
  if (!userId) return { error: 'Sign in first.' }
  const { error } = await supabase
    .from('user_telegram')
    .update({ enabled: !!enabled, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { error: error.message }
  return { success: true }
}

/** Load per-user Our Chart indicator params.
 *  Returns { prefs, error }. prefs is null when none saved yet or on error. */
export async function fetchUserChartIndicatorPrefs(userId) {
  if (!userId) return { prefs: null, error: null }
  const { data, error } = await supabase
    .from('user_chart_indicator_prefs')
    .select('prefs,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('fetchUserChartIndicatorPrefs error:', error.message)
    return { prefs: null, error: error.message || 'Could not load chart indicator settings' }
  }
  const prefs = data?.prefs && typeof data.prefs === 'object' ? data.prefs : null
  return { prefs, error: null }
}

/** Upsert per-user Our Chart indicator params (enabled flags + Inputs/Style/Visibility). */
export async function saveUserChartIndicatorPrefs(userId, prefs) {
  if (!userId) return { error: 'Sign in to save chart indicator settings.' }
  const payload = {
    user_id: userId,
    prefs: prefs || {},
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_chart_indicator_prefs')
    .upsert(payload, { onConflict: 'user_id' })
    .select('prefs,updated_at')
    .single()
  if (error) {
    console.error('saveUserChartIndicatorPrefs error:', error.message)
    return { error: error.message || 'Could not save chart indicator settings' }
  }
  return { data }
}

export const MAX_FAMILY_PORTFOLIOS = 5

/** Load family portfolios blob for a user (null if none saved yet). */
export async function fetchUserPortfolios(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_portfolios')
    .select('portfolios,active_id,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('fetchUserPortfolios error:', error.message)
    return null
  }
  if (!data) return null
  const portfolios = Array.isArray(data.portfolios) ? data.portfolios : []
  return {
    portfolios,
    activeId: data.active_id || null,
    updatedAt: data.updated_at || null,
  }
}

/** Upsert family portfolios + active tab for a signed-in user. */
export const MAX_USER_WATCHLISTS = 20
export const MAX_WATCHLIST_SYMS = 400

function normalizeWatchlistsPayload(raw, activeId) {
  const lists = (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_USER_WATCHLISTS)
    .map((w, i) => {
      const stocks = [...new Set(
        (Array.isArray(w?.stocks) ? w.stocks : [])
          .map(s => String(s || '').trim().toUpperCase())
          .filter(Boolean)
      )].slice(0, MAX_WATCHLIST_SYMS)
      return {
        id: String(w?.id || `wl_${i}_${Date.now()}`).slice(0, 64),
        name: String(w?.name || 'Watchlist').trim().slice(0, 40) || 'Watchlist',
        stocks,
      }
    })
  let aid = activeId || null
  if (aid && !lists.some(w => w.id === aid)) aid = null
  return { watchlists: lists, activeId: aid }
}

/** Load this user's watchlists (null if none saved yet). */
export async function fetchUserWatchlists(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_watchlists')
    .select('watchlists,active_id,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('fetchUserWatchlists error:', error.message)
    return null
  }
  if (!data) return null
  return {
    ...normalizeWatchlistsPayload(data.watchlists, data.active_id),
    updatedAt: data.updated_at || null,
  }
}

/** Upsert this user's watchlists + last selected list. */
export async function saveUserWatchlists(userId, { watchlists, activeId } = {}) {
  if (!userId) return { error: 'Sign in to save watchlists.' }
  const { watchlists: lists, activeId: aid } = normalizeWatchlistsPayload(watchlists, activeId)
  const payload = {
    user_id: userId,
    watchlists: lists,
    active_id: aid,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_watchlists')
    .upsert(payload, { onConflict: 'user_id' })
    .select('watchlists,active_id,updated_at')
    .single()
  if (error) {
    console.error('saveUserWatchlists error:', error.message)
    return { error: error.message || 'Could not save watchlists' }
  }
  return { data }
}

export async function saveUserPortfolios(userId, { portfolios, activeId } = {}) {
  if (!userId) return { error: 'Sign in to save portfolios.' }
  const list = (Array.isArray(portfolios) ? portfolios : [])
    .slice(0, MAX_FAMILY_PORTFOLIOS)
    .map((p, i) => ({
      id: p?.id || `p_${i}`,
      name: String(p?.name || 'Portfolio').trim().slice(0, 40) || 'Portfolio',
      holdings: Array.isArray(p?.holdings) ? p.holdings : [],
    }))
  if (!list.length) return { error: 'At least one portfolio is required.' }
  let aid = activeId || list[0].id
  if (!list.some(p => p.id === aid)) aid = list[0].id
  const payload = {
    user_id: userId,
    portfolios: list,
    active_id: aid,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('user_portfolios')
    .upsert(payload, { onConflict: 'user_id' })
    .select('portfolios,active_id,updated_at')
    .single()
  if (error) {
    console.error('saveUserPortfolios error:', error.message)
    return { error: error.message || 'Could not save portfolios' }
  }
  return { data }
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
 * 1-minute OHLCV bars from stock_intraday_1m (written by live_scan).
 * Used by Our Chart for 1/3/5/15/30/60 intervals (client rolls up from 1m,
 * or DB rolls via get_stock_intraday_bars when available).
 *
 * Prefers Postgres RPC (1 round-trip). Falls back to parallel REST pages.
 * In-memory cache ~90s per symbol.
 */
const _intradayCache = new Map() // key -> { at, payload }
const INTRADAY_CACHE_TTL_MS = 90_000

function _intradayCacheKey(sym, days, limit, intervalMin = 1) {
  return `${String(sym || '').trim().toUpperCase()}|${days}|${limit}|${intervalMin}`
}

function _rowsToIntradayPayload(cleanSym, rows) {
  return {
    sym: cleanSym,
    dates:   rows.map(r => r.ts),
    prices:  rows.map(r => Number(r.close)),
    opens:   rows.map(r => Number(r.open)),
    highs:   rows.map(r => Number(r.high)),
    lows:    rows.map(r => Number(r.low)),
    volumes: rows.map(r => Number(r.volume) || 0),
    daysCount: rows.length,
    updatedAt: rows[rows.length - 1]?.ts || null,
    interval: '1m',
  }
}

export function clearIntradayHistoryCache(sym = null) {
  if (!sym) {
    _intradayCache.clear()
    return
  }
  const u = String(sym).trim().toUpperCase()
  for (const k of [..._intradayCache.keys()]) {
    if (k.startsWith(`${u}|`)) _intradayCache.delete(k)
  }
}

async function _fetchIntradayViaRpc(cleanSym, daysN, limitN, intervalMin) {
  const { data, error } = await supabase.rpc('get_stock_intraday_bars', {
    p_sym: cleanSym,
    p_days: daysN,
    p_limit: limitN,
    p_interval_m: intervalMin,
  })
  if (error) throw error
  const rows = Array.isArray(data) ? data : []
  return rows
}

async function _fetchIntradayViaRest(cleanSym, daysN, limitN) {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysN)
  const sinceIso = since.toISOString()
  const pageSize = 1000
  const maxPages = Math.ceil(limitN / pageSize)

  const fetchPage = async (pageIdx) => {
    const from = pageIdx * pageSize
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('stock_intraday_1m')
      .select('ts,open,high,low,close,volume')
      .eq('sym', cleanSym.toUpperCase())
      .gte('ts', sinceIso)
      .order('ts', { ascending: false })
      .range(from, to)
    if (error) throw new Error(error.message || String(error))
    return data || []
  }

  const first = await fetchPage(0)
  if (!first.length) return []
  let pages = [first]
  if (first.length >= pageSize && maxPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: maxPages - 1 }, (_, i) => fetchPage(i + 1))
    )
    pages = [first, ...rest]
  }
  const rows = []
  for (const page of pages) {
    if (!page.length) break
    rows.push(...page)
    if (page.length < pageSize) break
  }
  rows.reverse()
  if (rows.length > limitN) rows.splice(0, rows.length - limitN)
  return rows
}

export async function fetchStockIntradayHistory(sym, {
  days = 10,
  limit = 4500,
  bypassCache = false,
  intervalMin = 1,
} = {}) {
  const cleanSym = (sym || '').trim()
  if (!cleanSym) return { error: 'No symbol' }

  const daysN = Math.max(1, Math.min(30, Number(days) || 10))
  const limitN = Math.max(500, Math.min(12000, Number(limit) || 4500))
  const iv = Math.max(1, Number(intervalMin) || 1)
  const cacheKey = _intradayCacheKey(cleanSym, daysN, limitN, iv)
  if (!bypassCache) {
    const hit = _intradayCache.get(cacheKey)
    if (hit && (Date.now() - hit.at) < INTRADAY_CACHE_TTL_MS && hit.payload && !hit.payload.error) {
      return hit.payload
    }
  }

  let rows = []
  try {
    // Prefer single-call RPC (run 014_get_stock_intraday_bars.sql once).
    rows = await _fetchIntradayViaRpc(cleanSym, daysN, limitN, iv === 1 ? 1 : 1)
    // Always fetch raw 1m via RPC; client still rolls 3/5/15 (keeps one cache
    // for all intervals). Pass iv>1 later if we want DB-side rollup.
  } catch (rpcErr) {
    try {
      rows = await _fetchIntradayViaRest(cleanSym, daysN, limitN)
    } catch (e) {
      console.error(`fetchStockIntradayHistory(${sym}) error:`, e.message || e)
      return { error: e.message || String(e) }
    }
    if (rpcErr) {
      // Soft log once — missing RPC is expected until migration is applied
      if (!fetchStockIntradayHistory._rpcWarned) {
        fetchStockIntradayHistory._rpcWarned = true
        console.info('get_stock_intraday_bars RPC unavailable — using REST pages. Run 014_get_stock_intraday_bars.sql for faster charts.')
      }
    }
  }

  if (!rows.length) {
    return {
      error: `No 1-minute history yet for ${sym} — available after market scans fill stock_intraday_1m.`,
    }
  }

  const payload = _rowsToIntradayPayload(cleanSym, rows)
  _intradayCache.set(cacheKey, { at: Date.now(), payload })
  if (_intradayCache.size > 40) {
    const oldest = [..._intradayCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) _intradayCache.delete(oldest[0])
  }
  return payload
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
    advancesD:     row.advances_d,
    advancesW:     row.advances_w,
    advancesM:     row.advances_m,
    topStocks:     typeof row.top_stocks === 'string' ? JSON.parse(row.top_stocks||'[]') : (row.top_stocks||[]),
    botStocks:     typeof row.bot_stocks === 'string' ? JSON.parse(row.bot_stocks||'[]') : (row.bot_stocks||[]),
    lastUpdated:   row.last_updated,
  }))
}

/**
 * Live quote for Our Chart's forming daily candle.
 * Uses the signed-in user's Upstox token only — not the shared stocks table.
 */
export async function fetchLiveStockPrice(sym, upstoxToken) {
  const clean = (sym || '').trim()
  const token = String(upstoxToken || '').trim()
  if (!clean || !token) return null
  const map = await fetchUpstoxQuotes(token, [clean])
  const q = map.get(clean.toUpperCase())
  if (!q) return null
  return {
    price: q.last,
    volume: q.volume,
    open: q.open,
    high: q.high,
    low: q.low,
    prevClose: q.prevClose,
  }
}

/** Local YYYY-MM-DD (avoid UTC day-shift from toISOString in IST). */
function localISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIndexPrices(raw) {
  let prices = raw
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices) } catch { return null }
  }
  // Double-encoded JSON string (jsonb column stored via json.dumps)
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices) } catch { return null }
  }
  if (!Array.isArray(prices) || prices.length === 0) return null
  const nums = prices.map(Number).filter(v => Number.isFinite(v))
  return nums.length ? nums : null
}

function indexNameCandidates(name) {
  const n = String(name || '').trim()
  if (!n) return []
  const out = [n]
  if (/^Nifty\s+/i.test(n)) out.push(n.replace(/^Nifty\s+/i, ''))
  else out.push(`Nifty ${n}`)
  // Dedup preserve order
  return [...new Set(out)]
}

/**
 * Fetch an index's price history for "Our Chart".
 * `index_price_history` stores a bare `prices` (close) array — no real dates
 * or OHLC. We synthesize trading-day dates and build candle OHLC from
 * consecutive closes (open = prior close, high/low = max/min of the body)
 * so Candles / Bars / Heikin Ashi work the same as for stocks.
 */
export async function fetchIndexPriceHistory(name) {
  const candidates = indexNameCandidates(name)
  let row = null
  let lastError = null

  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('index_price_history')
      .select('name,prices')
      .eq('name', candidate)
      .maybeSingle()
    if (error) {
      lastError = error
      console.error(`fetchIndexPriceHistory(${candidate}) error:`, error.message || error)
      continue
    }
    if (data?.prices != null) { row = data; break }
  }

  // Fuzzy fallback — some rows use slightly different labels
  if (!row) {
    const { data: all, error } = await supabase
      .from('index_price_history')
      .select('name,prices')
      .limit(200)
    if (error) {
      lastError = error
      console.error('fetchIndexPriceHistory list error:', error.message || error)
    } else if (all?.length) {
      const q = String(name || '').toLowerCase()
      row = all.find(r => String(r.name || '').toLowerCase() === q)
        || all.find(r => {
          const rn = String(r.name || '').toLowerCase()
          return rn.includes(q) || q.includes(rn)
        })
        || null
    }
  }

  if (!row?.prices) {
    const hint = lastError?.message?.includes('permission') || lastError?.code === '42501'
      ? ' (DB permission — run ensure_index_price_history_public_read.sql in Supabase)'
      : ''
    return { error: `No price history stored yet for ${name}.${hint}` }
  }

  const prices = parseIndexPrices(row.prices)
  if (!prices) {
    return { error: `No price history stored yet for ${name}.` }
  }

  // Synthesize dates counting backward from today (no real per-point
  // dates exist in this table) — approximate trading days by skipping
  // weekends, close enough for a chart x-axis label.
  const dates = []
  let d = new Date()
  for (let i = 0; i < prices.length; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
    dates.unshift(localISODate(d))
    d.setDate(d.getDate() - 1)
  }
  // Close-only → candle OHLC: open = previous close so each bar has a
  // real up/down body instead of a flat doji on every session.
  const opens = prices.map((c, i) => (i > 0 ? prices[i - 1] : c))
  const highs = prices.map((c, i) => Math.max(opens[i], c))
  const lows  = prices.map((c, i) => Math.min(opens[i], c))
  return {
    sym: row.name || name,
    dates,
    prices,
    opens, highs, lows,
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
 * all-time total views (from the first logged row), repeat visitors in
 * the last 7 days, and a day-by-day breakdown for the last `days` days.
 *
 * PostgREST caps a single select at 1,000 rows, so this pages through
 * the table. Fine at this scale; a Postgres view/RPC would be needed in
 * the millions of rows.
 */
export async function fetchUsageStats(days = 14) {
  const empty = { uniqueUsers: null, totalViews: null, frequentUsers: null, dailyTrend: [] }
  const PAGE = 1000
  const rows = []
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await supabase
      .from('page_views')
      .select('visitor_id,viewed_date')
      .range(from, from + PAGE - 1)
    if (error) return empty
    if (data?.length) rows.push(...data)
    if (!data || data.length < PAGE) break
  }
  if (!rows.length) return { uniqueUsers: 0, totalViews: 0, frequentUsers: 0, dailyTrend: [] }

  const uniqueUsers = new Set(rows.map(r => r.visitor_id)).size
  const totalViews = rows.length

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  const weekStart = weekAgo.toISOString().split('T')[0]
  const weekVisits = {}
  for (const row of rows) {
    if (row.viewed_date >= weekStart) {
      weekVisits[row.visitor_id] = (weekVisits[row.visitor_id] || 0) + 1
    }
  }
  // "Frequent" means they came back — two or more visits in the last 7 days.
  const frequentUsers = Object.values(weekVisits).filter(n => n >= 2).length

  const byDate = {} // date -> { views, visitorIds: Set }
  for (const row of rows) {
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

  return { uniqueUsers, totalViews, frequentUsers, dailyTrend }
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
    .lte('rank', 5) // AI Best Picks track record = top 5 only
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
  // Prefer the quality-pillar columns (fund / result / S2 new). Fall back
  // to the older select if Supabase hasn't run ensure_best_picks_quality_cols.sql yet.
  const full =
    'symbol,rank,score,reasoning,last_price,stop_loss,target,chg_pct,sector,industry,market_cap,'
    + 'rs_tv,weinstein_stage,is_s2_new_entry,fundamental_score,fundamental_label,result_rating,'
    + 'vcp_fired,is_resistance_breakout,is_cup_handle_breakout,eps_yoy,sales_yoy,roe,promoter_trend,generated_at'
  const legacy =
    'symbol,rank,score,reasoning,last_price,stop_loss,target,chg_pct,sector,industry,market_cap,'
    + 'rs_tv,weinstein_stage,vcp_fired,is_resistance_breakout,is_cup_handle_breakout,eps_yoy,sales_yoy,roe,promoter_trend,generated_at'
  let { data, error } = await supabase
    .from('best_picks')
    .select(full)
    .order('rank', { ascending: true })
  if (error && /fundamental_|result_rating|is_s2_new/i.test(error.message || '')) {
    ;({ data, error } = await supabase
      .from('best_picks')
      .select(legacy)
      .order('rank', { ascending: true }))
  }
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
  // Per-symbol history must NOT use a short filed_at window. A 90-day
  // filter (previous behaviour) dropped same-quarter-last-year rows and
  // made Results / YoY / ratings look empty for stocks like GRSE even
  // when financial_results had the data. Single-symbol queries are cheap
  // — fetch enough periods, then prefer Consolidated and sort by date.
  const sym = String(symbol || '').toUpperCase().trim()
  if (!sym) return []
  const baseSelect = 'period_ended,result_type,sales,other_income,pbt,exceptional_item,pat,eps,opm_pct,filed_at,sales_qoq_pct,pat_qoq_pct,sales_yoy_pct,pat_yoy_pct,eps_yoy_pct'
  let { data, error } = await supabase
    .from('financial_results')
    .select(`${baseSelect},result_rating,result_rating_note`)
    .eq('symbol', sym)
    .limit(40)
  if (error && /result_rating/i.test(error.message || '')) {
    ;({ data, error } = await supabase
      .from('financial_results')
      .select(baseSelect)
      .eq('symbol', sym)
      .limit(40))
  }
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
      + 'emerging_themes,theme_evidence,theme_intensity,management_tone,watch_next')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .order('announced_at', { ascending: false })
    .limit(5)
  if (error) { console.error('fetchPptSummaries error:', error.message); return [] }
  return data || []
}

export async function fetchCompanyAbout(symbol) {
  // AI-generated company brief (what they do / customers / segments /
  // innovation) produced by the fundamentals worker via Gemini Google
  // Search + Screener/filings context. One row per symbol.
  const { data, error } = await supabase
    .from('company_abouts')
    .select('symbol,overall_brief,what_they_do,customers,segments,innovation,sources,'
      + 'website,image_url,source_announced_at,status,updated_at')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .maybeSingle()
  if (error) { console.error('fetchCompanyAbout error:', error.message); return null }
  return data || null
}

export async function fetchStockFundamentals(symbol) {
  // Full fundamentals snapshot for the Fundamentals tab — includes AI
  // takeaways (ai_highlights / ai_key_metrics) that may not be on the
  // live scan CDN payload yet.
  // Note: fundamental_score / fundamental_label live on `stocks` (scan),
  // not stock_fundamentals — never select them here (PGRST204).
  if (!symbol) return null
  const core = 'sym,market_cap,pe,pb,roe,roce,eps,debt_eq,promoter,peg_ratio,industry_pe,'
    + 'div_yield,cfo,fcf,cfo_pat,nim,gnpa,nnpa,car,casa,'
    + 'eps_qoq,eps_yoy,sales_qoq,sales_yoy,opm_pct,opm_trend,eps_growth_streak,'
    + 'fii_pct,fii_trend,dii_pct,dii_trend,promoter_trend,'
    + 'industry,sector,fetched_at'
  const full = core + ','
    + 'ai_highlights,ai_key_metrics,ai_highlights_at,'
    + 'emerging_themes,theme_evidence,theme_intensity,themes_source,'
    + 'themes_at,themes_announced_at,'
    + 'mgmt_verdict,mgmt_summary,mgmt_flags,mgmt_flags_at'
  const { data, error } = await supabase
    .from('stock_fundamentals')
    .select(full)
    .eq('sym', symbol)
    .maybeSingle()
  if (error) {
    // Older DBs may lack ai_* / theme / mgmt columns — retry core only
    if (/ai_highlights|ai_key_metrics|ai_highlights_at|emerging_themes|theme_|mgmt_/i.test(error.message || '')) {
      const { data: d2, error: e2 } = await supabase
        .from('stock_fundamentals')
        .select(core)
        .eq('sym', symbol)
        .maybeSingle()
      if (e2) { console.error('fetchStockFundamentals error:', e2.message); return null }
      return d2 || null
    }
    console.error('fetchStockFundamentals error:', error.message)
    return null
  }
  return data || null
}

export async function fetchStockThemes(symbol) {
  // Emerging themes for the Market Cap card — prefers rows already
  // synced onto stock_fundamentals (PPT / concall / AI web).
  if (!symbol) return null
  const row = await fetchStockFundamentals(symbol)
  if (!row) return null
  const themes = row.emerging_themes
  const evidence = row.theme_evidence
  const hasThemes = Array.isArray(themes) ? themes.length > 0
    : (typeof themes === 'string' && themes.trim().length > 0)
  const hasEvidence = Array.isArray(evidence) ? evidence.length > 0
    : (typeof evidence === 'string' && evidence.trim().length > 0)
  if (!hasThemes && !hasEvidence) return null
  return {
    themes: row.emerging_themes,
    intensity: row.theme_intensity,
    evidence: row.theme_evidence,
    source: row.themes_source || 'ai_web',
    at: row.themes_announced_at || row.themes_at,
  }
}

function getVisitorId() {
  try {
    let id = localStorage.getItem('lm_visitor_id')
    if (!id) {
      id = (crypto?.randomUUID?.() || `v_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      localStorage.setItem('lm_visitor_id', id)
    }
    return id
  } catch {
    return null
  }
}

/** Aggregate thumbs counts for a symbol/content-type (optional section). */
export async function fetchContentFeedbackCounts(symbol, contentType, sectionKey = null) {
  const sym = (symbol || '').trim().toUpperCase()
  const ctype = (contentType || '').trim().toLowerCase()
  if (!sym || !ctype) return {}
  const { data, error } = await supabase.rpc('get_content_feedback_counts', {
    p_symbol: sym,
    p_content_type: ctype,
    p_section_key: sectionKey || null,
  })
  if (error) {
    console.error('fetchContentFeedbackCounts error:', error.message)
    return {}
  }
  const out = {}
  for (const row of data || []) {
    out[row.section_key] = {
      up: Number(row.up_count) || 0,
      down: Number(row.down_count) || 0,
    }
  }
  return out
}

/** Upsert thumbs vote for this visitor (one vote per section). */
export async function submitContentFeedback({
  symbol,
  contentType,
  sectionKey,
  sectionLabel,
  vote,
  comment,
} = {}) {
  const sym = (symbol || '').trim().toUpperCase()
  const ctype = (contentType || '').trim().toLowerCase().slice(0, 40)
  const skey = (sectionKey || '').trim().slice(0, 60)
  const v = vote === 'down' ? 'down' : vote === 'up' ? 'up' : null
  const note = (comment || '').trim()
  const visitorId = getVisitorId()
  if (!sym || !ctype || !skey || !v || !visitorId) {
    return { error: 'Missing feedback fields.' }
  }
  if (v === 'down' && note && (note.length < 5 || note.length > 1000)) {
    return { error: 'Please describe the issue (5–1000 characters).' }
  }
  if (v === 'down' && !note) {
    return { error: 'Please describe the issue (5–1000 characters).' }
  }
  const { data: { user } } = await supabase.auth.getUser()
  const payload = {
    symbol: sym,
    content_type: ctype,
    section_key: skey,
    section_label: (sectionLabel || '').trim().slice(0, 120) || null,
    vote: v,
    comment: v === 'down' ? note : null,
    visitor_id: visitorId,
    user_id: user?.id || null,
  }
  const { error } = await supabase
    .from('content_feedback')
    .upsert(payload, { onConflict: 'symbol,content_type,section_key,visitor_id' })
  if (error) {
    console.error('submitContentFeedback error:', error.message)
    return { error: error.message || 'Could not save feedback' }
  }
  return { feedback: { vote: v } }
}

/** Clear this visitor's vote on a section (unselect). */
export async function clearContentFeedback({ symbol, contentType, sectionKey } = {}) {
  const sym = (symbol || '').trim().toUpperCase()
  const ctype = (contentType || '').trim().toLowerCase().slice(0, 40)
  const skey = (sectionKey || '').trim().slice(0, 60)
  const visitorId = getVisitorId()
  if (!sym || !ctype || !skey || !visitorId) {
    return { error: 'Missing feedback fields.' }
  }
  const { error } = await supabase
    .from('content_feedback')
    .delete()
    .eq('symbol', sym)
    .eq('content_type', ctype)
    .eq('section_key', skey)
    .eq('visitor_id', visitorId)
  if (error) {
    console.error('clearContentFeedback error:', error.message)
    return { error: error.message || 'Could not clear feedback' }
  }
  return { ok: true }
}

/** Public testimonials for the landing page (is_public = true). */
export async function fetchPublicUserFeedback(limit = 12) {
  const { data, error } = await supabase
    .from('user_feedback')
    .select('id,display_name,message,rating,created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('fetchPublicUserFeedback error:', error.message)
    return []
  }
  return data || []
}

/** Aggregate star-rating stats for public feedback (home page header). */
export async function fetchUserFeedbackRatingStats() {
  const empty = {
    average: 0,
    total: 0,
    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  }
  const { data, error } = await supabase.rpc('get_user_feedback_rating_stats')
  if (error) {
    // RPC missing before migration — fall back to client-side from public rows.
    const { data: rows } = await supabase
      .from('user_feedback')
      .select('rating')
      .eq('is_public', true)
      .not('rating', 'is', null)
    if (!rows?.length) return empty
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    let sum = 0
    for (const row of rows) {
      const r = Number(row.rating)
      if (r >= 1 && r <= 5) {
        dist[r] += 1
        sum += r
      }
    }
    const total = Object.values(dist).reduce((a, b) => a + b, 0)
    return {
      average: total ? Math.round((sum / total) * 10) / 10 : 0,
      total,
      distribution: dist,
    }
  }
  const dist = data?.distribution || {}
  return {
    average: Number(data?.average) || 0,
    total: Number(data?.total) || 0,
    distribution: {
      5: Number(dist['5']) || 0,
      4: Number(dist['4']) || 0,
      3: Number(dist['3']) || 0,
      2: Number(dist['2']) || 0,
      1: Number(dist['1']) || 0,
    },
  }
}

/** Signed-in user's past feedback submissions. */
export async function fetchMyUserFeedback(limit = 20) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('user_feedback')
    .select('id,message,rating,is_public,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('fetchMyUserFeedback error:', error.message)
    return []
  }
  return data || []
}

/** Submit app feedback (requires sign-in). */
export async function submitUserFeedback({ message, rating, isPublic = true, displayName } = {}) {
  const text = (message || '').trim()
  if (text.length < 5 || text.length > 1000) {
    return { error: 'Please write at least 5 characters (max 1000).' }
  }
  const r = Number(rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return { error: 'Please select a star rating (1–5).' }
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please sign in to submit feedback.' }
  const name = (displayName || '').trim().slice(0, 40) || 'Trader'
  const { data, error } = await supabase
    .from('user_feedback')
    .insert({
      user_id: user.id,
      display_name: name,
      message: text,
      rating: r,
      is_public: !!isPublic,
    })
    .select('id,display_name,message,rating,is_public,created_at')
    .single()
  if (error) {
    console.error('submitUserFeedback error:', error.message)
    return { error: error.message || 'Could not save feedback' }
  }
  return { feedback: data }
}

export async function compressChartImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    return { error: 'Attach a chart screenshot (PNG or JPG).' }
  }
  if (file.size > 8 * 1024 * 1024) {
    return { error: 'Image is too large (max 8 MB). Crop to the chart and try again.' }
  }
  try {
    const bmp = await createImageBitmap(file)
    const maxW = 1280
    const scale = Math.min(1, maxW / Math.max(1, bmp.width))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
    if (!blob) return { error: 'Could not compress the chart image.' }
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    const b64 = btoa(binary)
    if (b64.length > 700000) {
      return { error: 'Chart image is still too large. Crop closer to the candles and retry.' }
    }
    return { mime: 'image/jpeg', b64, previewUrl: URL.createObjectURL(blob) }
  } catch (e) {
    return { error: e.message || 'Could not read that image.' }
  }
}

export async function submitStockAiAsk(symbol, question, askMode = 'filings', chartImage = null) {
  // Queue a free-form diligence question; fundamentals worker answers via Gemini.
  // askMode: 'filings' | 'web' | 'chart' (Gemini Vision + local context)
  // chartImage: optional { mime, b64 } compressed screenshot for vision.
  let q = (question || '').trim()
  const hasChart = !!(chartImage?.b64 && chartImage.b64.length >= 800)
  if (hasChart && q.length < 8) q = 'Read this chart and explain what it shows.'
  const sym = (symbol || '').trim().toUpperCase()
  const mode = askMode === 'web' ? 'web' : askMode === 'chart' ? 'chart' : 'filings'
  if (!sym || q.length < 8 || q.length > 400) {
    return { error: 'Ask a clear question (8–400 characters), or attach a chart image.' }
  }
  const { data: { user } } = await supabase.auth.getUser()
  const payload = {
    symbol: sym,
    question: q,
    status: 'pending',
    ask_mode: mode,
    visitor_id: getVisitorId(),
    user_id: user?.id || null,
  }
  if (hasChart) {
    payload.chart_image = chartImage.b64
    payload.chart_image_mime = chartImage.mime || 'image/jpeg'
  }
  let { data, error } = await supabase
    .from('stock_ai_asks')
    .insert(payload)
    .select('id,symbol,question,status,ask_mode,created_at')
    .single()
  // Older DBs may lack ask_mode / chart_image — retry without them
  if (error && /ask_mode|chart_image/i.test(error.message || '')) {
    if (/chart_image/i.test(error.message || '') && hasChart) {
      return { error: 'Chart images need a one-time SQL update (add_ask_ai_chart_image.sql). Ask without the picture until that runs.' }
    }
    delete payload.ask_mode
    delete payload.chart_image
    delete payload.chart_image_mime
    ;({ data, error } = await supabase
      .from('stock_ai_asks')
      .insert(payload)
      .select('id,symbol,question,status,created_at')
      .single())
    if (data) data.ask_mode = mode
  }
  if (error) {
    console.error('submitStockAiAsk error:', error.message)
    return { error: error.message || 'Could not submit question' }
  }
  return { ask: data }
}

export async function fetchStockAiAsk(id) {
  if (!id) return null
  const { data, error } = await supabase
    .from('stock_ai_asks')
    .select('id,symbol,question,status,ask_mode,answer,verdict,flags,sources,error,created_at,answered_at')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (/ask_mode/i.test(error.message || '')) {
      const { data: d2, error: e2 } = await supabase
        .from('stock_ai_asks')
        .select('id,symbol,question,status,answer,verdict,flags,sources,error,created_at,answered_at')
        .eq('id', id)
        .maybeSingle()
      if (e2) { console.error('fetchStockAiAsk error:', e2.message); return null }
      return d2 || null
    }
    console.error('fetchStockAiAsk error:', error.message)
    return null
  }
  return data || null
}

export async function fetchRecentStockAiAsks(symbol, limit = 5) {
  if (!symbol) return []
  const { data, error } = await supabase
    .from('stock_ai_asks')
    .select('id,symbol,question,status,ask_mode,answer,verdict,flags,sources,error,created_at,answered_at')
    .eq('symbol', symbol)
    .eq('status', 'done')
    .order('answered_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (/stock_ai_asks|ask_mode/i.test(error.message || '')) {
      const { data: d2, error: e2 } = await supabase
        .from('stock_ai_asks')
        .select('id,symbol,question,status,answer,verdict,flags,sources,error,created_at,answered_at')
        .eq('symbol', symbol)
        .eq('status', 'done')
        .order('answered_at', { ascending: false })
        .limit(limit)
      if (e2) return []
      return d2 || []
    }
    console.error('fetchRecentStockAiAsks error:', error.message)
    return []
  }
  return data || []
}

export async function fetchMgmtFlags(symbol) {
  const row = await fetchStockFundamentals(symbol)
  if (!row) return null
  const flags = row.mgmt_flags
  const list = Array.isArray(flags) ? flags : []
  if (!list.length && !row.mgmt_summary) return null
  return {
    verdict: row.mgmt_verdict,
    summary: row.mgmt_summary,
    flags: list,
    at: row.mgmt_flags_at,
  }
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
      + 'emerging_themes,theme_evidence,theme_intensity,management_tone,watch_next')
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
  // and from stock_fundamentals AI/synced themes into
  // { themeId: [{symbol, source, announced_at, intensity, evidence}] }.
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const select = 'symbol,announced_at,emerging_themes,theme_evidence,theme_intensity,attachment_url'
  const [tx, ppt, fund] = await Promise.all([
    supabase.from('transcript_summaries').select(select)
      .eq('status', 'done').not('emerging_themes', 'is', null)
      .gte('announced_at', since).order('announced_at', { ascending: false }).limit(500),
    supabase.from('ppt_summaries').select(select)
      .eq('status', 'done').not('emerging_themes', 'is', null)
      .gte('announced_at', since).order('announced_at', { ascending: false }).limit(500),
    supabase.from('stock_fundamentals')
      .select('sym,emerging_themes,theme_evidence,theme_intensity,themes_source,themes_at,themes_announced_at')
      .not('emerging_themes', 'is', null)
      .order('themes_at', { ascending: false }).limit(800),
  ])
  if (tx.error) console.error('fetchEmergingThemeRadar transcript:', tx.error.message)
  if (ppt.error) console.error('fetchEmergingThemeRadar ppt:', ppt.error.message)
  if (fund.error && !/emerging_themes|themes_at/i.test(fund.error.message || '')) {
    console.error('fetchEmergingThemeRadar fund:', fund.error.message)
  }

  const byTheme = {}
  const pushRow = (row, source, symbolKey = 'symbol') => {
    const symbol = row[symbolKey] || row.symbol || row.sym
    if (!symbol) return
    let themes = row.emerging_themes
    if (typeof themes === 'string') {
      try { themes = JSON.parse(themes) } catch { themes = [] }
    }
    if (!Array.isArray(themes) || themes.length === 0) return
    let evidence = row.theme_evidence
    if (typeof evidence === 'string') {
      try { evidence = JSON.parse(evidence) } catch { evidence = evidence ? [evidence] : [] }
    }
    const announced = row.announced_at || row.themes_announced_at || row.themes_at
    for (const theme of themes) {
      if (!byTheme[theme]) byTheme[theme] = []
      // One row per symbol per theme (keep newest / filing-first)
      if (byTheme[theme].some(x => x.symbol === symbol)) continue
      byTheme[theme].push({
        symbol,
        source,
        announced_at: announced,
        intensity: row.theme_intensity || 'medium',
        evidence: Array.isArray(evidence) ? evidence.slice(0, 2) : [],
        attachment_url: row.attachment_url,
      })
    }
  }
  // Filings first so radar prefers PPT/concall over AI web when both exist
  ;(tx.data || []).forEach(r => pushRow(r, 'concall'))
  ;(ppt.data || []).forEach(r => pushRow(r, 'ppt'))
  ;(fund.data || []).forEach(r => pushRow(r, r.themes_source || 'ai_web', 'sym'))
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
 * Recent NSE corporate filings for one symbol — powers About → Corporate News.
 * Skips newspaper-publication reprints so the list stays actionable.
 */
export async function fetchSymbolCorporateNews(symbol, limit = 12) {
  if (!symbol) return []
  const { data, error } = await supabase
    .from('corporate_announcements')
    .select('symbol,category,subject,attachment_url,announced_at,ai_rating,ai_summary')
    .eq('symbol', String(symbol).toUpperCase())
    .not('subject', 'ilike', '%newspaper publication%')
    .not('category', 'ilike', '%newspaper publication%')
    .not('subject', 'ilike', '%newspaper advertisement%')
    .not('category', 'ilike', '%newspaper advertisement%')
    .order('announced_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('fetchSymbolCorporateNews error:', error.message)
    return []
  }
  return data || []
}

/**
 * Recent structured quarterly results (Sales/PAT/EPS as filed to NSE),
 * keyed by symbol — the Results tab overlays these numbers on matching
 * announcements. Last 45 days covers a full results season window.
 */
export async function fetchRecentFinancialResults() {
  // Bulk map for News → Results cards. Load recent filed rows + any
  // null-filed_at rows (some scrape paths omit filed_at) so tickers
  // don't vanish from the map.
  const since = new Date(Date.now() - 120 * 864e5).toISOString()
  const select = 'symbol,period_ended,result_type,sales,other_income,pbt,pat,eps,opm_pct,filed_at'
  const [recent, nullFiled] = await Promise.all([
    supabase.from('financial_results').select(select)
      .gt('filed_at', since).order('filed_at', { ascending: false }).limit(3000),
    supabase.from('financial_results').select(select)
      .is('filed_at', null).limit(500),
  ])
  if (recent.error) console.error('fetchRecentFinancialResults error:', recent.error.message)
  if (nullFiled.error) console.error('fetchRecentFinancialResults null filed_at:', nullFiled.error.message)
  const bySymbol = {}
  const toDate = (s) => {
    const d = new Date(s)
    return isNaN(d.getTime()) ? new Date(0) : d
  }
  for (const r of [...(recent.data || []), ...(nullFiled.data || [])]) {
    const sym = (r.symbol || '').toUpperCase()
    if (!sym) continue
    const row = { ...r, symbol: sym }
    const prev = bySymbol[sym]
    if (!prev || toDate(row.period_ended) > toDate(prev.period_ended)) bySymbol[sym] = row
  }
  return bySymbol
}

/**
 * Bulk financial_results history keyed by symbol (up to 8 periods each),
 * for computing Excellent/Good/Neutral/Weak result ratings in filters.
 * Pages through the table — ~1–2k rows today, cheap enough for client use.
 */
export async function fetchFinancialResultsGroupedForRatings() {
  const selectWithRating = 'symbol,period_ended,result_type,sales,other_income,pbt,exceptional_item,pat,eps,opm_pct,sales_qoq_pct,pat_qoq_pct,result_rating,result_rating_note'
  const selectBase = 'symbol,period_ended,result_type,sales,other_income,pbt,exceptional_item,pat,eps,opm_pct,sales_qoq_pct,pat_qoq_pct'
  let select = selectWithRating
  const toDate = (s) => {
    const d = new Date(s)
    return isNaN(d.getTime()) ? new Date(0) : d
  }
  const all = []
  let from = 0
  const page = 1000
  while (from < 8000) {
    const { data, error } = await supabase
      .from('financial_results')
      .select(select)
      .range(from, from + page - 1)
    if (error) {
      if (select === selectWithRating && /result_rating/i.test(error.message || '')) {
        select = selectBase
        from = 0
        all.length = 0
        continue
      }
      console.error('fetchFinancialResultsGroupedForRatings error:', error.message)
      break
    }
    if (!data?.length) break
    all.push(...data)
    if (data.length < page) break
    from += page
  }
  const bySym = {}
  for (const r of all) {
    const sym = (r.symbol || '').toUpperCase()
    if (!sym) continue
    if (!bySym[sym]) bySym[sym] = []
    bySym[sym].push({ ...r, symbol: sym })
  }
  const grouped = {}
  for (const [sym, rows] of Object.entries(bySym)) {
    const byPeriod = {}
    for (const row of rows) {
      const existing = byPeriod[row.period_ended]
      const isConsolidated = (row.result_type || '').toLowerCase().includes('consolidated')
      if (!existing || (isConsolidated && !(existing.result_type || '').toLowerCase().includes('consolidated'))) {
        byPeriod[row.period_ended] = row
      }
    }
    grouped[sym] = Object.values(byPeriod)
      .sort((a, b) => toDate(b.period_ended) - toDate(a.period_ended))
      .slice(0, 8)
  }
  return grouped
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

/**
 * Filings that still need an AI summary (Results PDF / PPT / Concall transcript).
 *
 * Logic (per attachment):
 *   - no summary row              → queued (still needs work)
 *   - status pending / failed     → still needs work
 *   - status done / skipped       → already processed; not missed
 *
 * Match key is (symbol, attachment_url) — same as the worker upsert.
 *
 * Filters intentionally match the Railway worker (shared.py):
 *   Concall = subject/category contains "transcript" (not audio recordings /
 *             call invites). PPT = "presentation". Audio-only NSE links are
 *             not Gemini-readable and must not inflate the Waiting queue.
 */
export async function fetchMissedAiFilings({ days = 45, limitPerType = 80 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const DONE_STATUSES = new Set(['done', 'skipped'])
  const types = [
    {
      key: 'results',
      label: 'Results',
      table: 'concall_summaries',
      detailTab: 'resultsSummary',
      keywords: ['financial result', 'quarterly result', 'results for the quarter', 'unaudited results', 'audited results'],
      exclude: ['newspaper publication', 'newspaper advertisement', 'transcript', 'press release', 'investor presentation', 'clarification', 'audio recording', 'audio'],
    },
    {
      key: 'ppt',
      label: 'PPT',
      table: 'ppt_summaries',
      detailTab: 'ppt',
      // Same signal as worker _PPT_ANN_KEYWORDS / _is_ppt_announcement
      keywords: ['investor presentation', 'analyst presentation', 'corporate presentation', 'earnings presentation', 'presentation'],
      exclude: ['transcript', 'audio recording', 'audio', 'schedule of', 'intimation of'],
    },
    {
      key: 'concall',
      label: 'Concall',
      table: 'transcript_summaries',
      detailTab: 'concall',
      // Same signal as worker _TRANSCRIPT_ANN_KEYWORDS — "conference call" alone
      // matches audio recordings / invites that have no extractable text.
      keywords: ['transcript'],
      exclude: ['presentation', 'audio recording', 'audio', 'schedule of', 'intimation of'],
    },
  ]

  const filingKey = (symbol, url) => `${symbol || ''}\0${url || ''}`

  const fetchCandidates = async (type) => {
    const orFilter = type.keywords
      .flatMap(k => [`category.ilike.%${k}%`, `subject.ilike.%${k}%`])
      .join(',')
    let q = supabase
      .from('corporate_announcements')
      .select('symbol,category,subject,attachment_url,announced_at,sector')
      .not('attachment_url', 'is', null)
      .neq('attachment_url', '')
      .gte('announced_at', since)
      .or(orFilter)
      .order('announced_at', { ascending: false })
      .limit(Math.min(300, limitPerType * 3))
    for (const k of type.exclude || []) {
      q = q.not('category', 'ilike', `%${k}%`).not('subject', 'ilike', `%${k}%`)
    }
    const { data, error } = await q
    if (error) {
      console.error(`fetchMissedAiFilings announcements(${type.key}):`, error.message)
      return []
    }
    return data || []
  }

  const fetchProcessed = async (table) => {
    const { data, error } = await supabase
      .from(table)
      .select('symbol,attachment_url,status,announced_at')
      .gte('announced_at', since)
      .order('announced_at', { ascending: false })
      .limit(2000)
    if (error) {
      console.error(`fetchMissedAiFilings ${table}:`, error.message)
      return new Map()
    }
    const map = new Map()
    for (const row of data || []) {
      if (!row.attachment_url || !row.symbol) continue
      map.set(filingKey(row.symbol, row.attachment_url), row)
    }
    return map
  }

  const out = { days, results: [], ppt: [], concall: [], counts: { results: 0, ppt: 0, concall: 0, total: 0 } }

  await Promise.all(types.map(async (type) => {
    const [cands, processed] = await Promise.all([
      fetchCandidates(type),
      fetchProcessed(type.table),
    ])
    const missed = []
    const seen = new Set()
    for (const ann of cands) {
      const url = ann.attachment_url
      const key = filingKey(ann.symbol, url)
      if (!url || !ann.symbol || seen.has(key)) continue
      seen.add(key)
      const row = processed.get(key)
      const status = (row?.status || '').toLowerCase() || null
      // Worker already finished this attachment (content or deliberate skip)
      if (status && DONE_STATUSES.has(status)) continue
      missed.push({
        symbol: ann.symbol,
        subject: ann.subject,
        category: ann.category,
        announced_at: ann.announced_at,
        attachment_url: url,
        sector: ann.sector || null,
        kind: type.key,
        label: type.label,
        detailTab: type.detailTab,
        status: status || 'queued',
      })
      if (missed.length >= limitPerType) break
    }
    out[type.key] = missed
    out.counts[type.key] = missed.length
  }))

  out.counts.total = out.counts.results + out.counts.ppt + out.counts.concall
  return out
}

