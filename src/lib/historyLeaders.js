import { supabase } from './supabase'
import { weinsteinStageNumber } from './weinstein'

const PAGE_SIZE = 1000

async function fetchHistoryPage(snapshotDate, from, select) {
  const { data, error } = await supabase
    .from('stock_history')
    .select(select)
    .eq('snapshot_date', snapshotDate)
    .range(from, from + PAGE_SIZE - 1)
  if (error) throw error
  return data || []
}

async function fetchAllHistoryRows(snapshotDate, select) {
  let rows = []
  let from = 0
  while (true) {
    const page = await fetchHistoryPage(snapshotDate, from, select)
    rows = rows.concat(page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

async function fetchPreviousHistoryDate(historyDate) {
  const { data, error } = await supabase
    .from('stock_history')
    .select('snapshot_date')
    .lt('snapshot_date', historyDate)
    .order('snapshot_date', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  return data[0].snapshot_date
}

function rowToLeaderShape(row) {
  const high52 = row.high_52w
  const last = row.last_price || 0
  return {
    rs: row.rs || 0,
    rsTv: row.rs_tv,
    rsTrend: { trend: row.rs_trend || 'flat', slope: row.rs_slope || 0 },
    hist: row.rs_hist || [],
    pctFromHigh: high52 ? ((last - high52) / high52) * 100 : 0,
    rsLineValue: row.rs_line_value,
  }
}

function approxRsLineNewHigh(stock, prevShape) {
  if (stock.rsLineNewHigh) return true
  const rs = stock.rsTv ?? stock.rs ?? 0
  const prevRs = prevShape.rsTv ?? prevShape.rs ?? 0
  if (rs < 70 || rs <= prevRs) return false

  if (stock.rsLineValue != null && prevShape.rsLineValue != null) {
    return stock.rsLineValue > prevShape.rsLineValue
  }

  const hist = stock.hist || []
  const maxHist = hist.length ? Math.max(...hist.filter(Boolean)) : rs
  return rs >= maxHist
}

function approxS2NewEntry(stock, prevShape) {
  if (stock.isS2NewEntry) return true
  const today = weinsteinStageNumber(stock)
  const prev = weinsteinStageNumber(prevShape)
  return today === 2 && prev !== 2
}

async function breadthExpectsLeaders(historyDate) {
  const { data } = await supabase
    .from('market_breadth')
    .select('rs_line_new_high, s2_new_entry')
    .eq('scan_date', historyDate)
    .maybeSingle()
  if (!data) return null
  return (data.rs_line_new_high || 0) > 0 || (data.s2_new_entry || 0) > 0
}

/**
 * stock_history archives often omit rs_line_new_high / is_s2_new_entry.
 * Reconstruct leader flags by comparing the selected day to the prior
 * trading day's snapshot (same logic the live scan stores on `stocks`).
 */
export async function enrichHistoryLeaderFlags(stocks, rawRows, historyDate) {
  if (!historyDate || !stocks?.length) return stocks

  const hasCols = rawRows.length > 0 && (
    'rs_line_new_high' in rawRows[0] || 'is_s2_new_entry' in rawRows[0]
  )
  const anyFlagged = stocks.some(s => s.rsLineNewHigh || s.isS2NewEntry)
  if (hasCols && anyFlagged) return stocks

  if (hasCols && !anyFlagged) {
    const breadthHint = await breadthExpectsLeaders(historyDate)
    if (breadthHint === false) return stocks
  }

  const prevDate = await fetchPreviousHistoryDate(historyDate)
  if (!prevDate) return stocks

  const select = 'sym,rs,rs_tv,rs_trend,rs_slope,rs_hist,high_52w,last_price,rs_line_value'
  const prevRows = await fetchAllHistoryRows(prevDate, select)
  const prevBySym = Object.fromEntries(prevRows.map(r => [r.sym, rowToLeaderShape(r)]))

  for (const s of stocks) {
    const prev = prevBySym[s.sym]
    if (!prev) continue
    if (!s.rsLineNewHigh) s.rsLineNewHigh = approxRsLineNewHigh(s, prev)
    if (!s.isS2NewEntry) s.isS2NewEntry = approxS2NewEntry(s, prev)
  }

  return stocks
}
