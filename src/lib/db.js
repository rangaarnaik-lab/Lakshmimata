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
export async function fetchStocksFromDB({ indexFilter = 'all', watchlistSyms = null, historyDate = null } = {}) {
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

  // Transform DB rows to app format
  return (data || []).map(row => ({
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
    volSignal:   row.vol_signal,
    rsLineNewHigh: row.rs_line_new_high || false,
    rsLineTrend:   row.rs_line_trend || 'flat',
    rsLineValue:   row.rs_line_value,
    isS2NewEntry:  row.is_s2_new_entry || false,
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
    },
    ht: {
      isHT:      row.is_ht || false,
      pctOfATH:  row.ht_pct || 0,
    },
    nearEMA9: {
      isNearEMA9:  row.near_ema9 || false,
      ema9:        row.ema9,
      pctFromEMA9: row.pct_from_ema9,
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
  }))
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
export async function fetchStockFullHistory(sym) {
  const cleanSym = (sym || '').trim()
  // Confirmed via direct Supabase inspection: rows exist with real data
  // for symbols that .eq('sym', sym) was reporting as "not found" (e.g.
  // GRSE) — a case-sensitivity or stray-whitespace mismatch between how
  // the symbol is stored vs queried. .ilike() (case-insensitive, and we
  // trim first) is robust to both without needing to know which it was.
  let { data, error } = await supabase
    .from('stock_full_history')
    .select('*')
    .ilike('sym', cleanSym)
    .maybeSingle()
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
