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
  let query = supabase
    .from(table)
    .select('*')
    .order('rs', { ascending: false })

  if (historyDate) {
    query = query.eq('snapshot_date', historyDate)
  }

  // Filter by index
  if (watchlistSyms && watchlistSyms.length > 0) {
    query = query.in('sym', watchlistSyms)
  } else if (indexFilter === 'nifty50') {
    query = query.eq('in_nifty50', true)
  } else if (indexFilter === 'midcap') {
    query = query.eq('in_midcap', true)
  } else if (indexFilter === 'smallcap') {
    query = query.eq('in_smallcap', true)
  } else if (indexFilter === 'microcap') {
    query = query.eq('in_microcap', true)
  }

  const { data, error } = await query
  if (error) throw error

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
    rvol:        row.rvol,
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
    count:     row.count,
    ppCount:   row.pp_count,
    improving: row.improving,
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
