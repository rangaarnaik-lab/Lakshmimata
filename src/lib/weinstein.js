/** Weinstein stage number (1–4) from scanner stock shape. */
export function weinsteinStageNumber(s) {
  const rs = s.rs || 0
  const trend = s.rsTrend?.trend || 'flat'
  const pctFromHigh = s.pctFromHigh || 0
  const hist = s.hist || []
  const recentRS = hist.filter(Boolean).slice(-5)
  const avgRecentRS = recentRS.length ? recentRS.reduce((a, b) => a + b, 0) / recentRS.length : rs

  if (rs >= 70 && (trend === 'improving' || trend === 'flat') && pctFromHigh >= -30) {
    if (pctFromHigh >= -5) return 3
    return 2
  }
  if (rs >= 70 && trend === 'declining') return 3
  if (rs < 40 && (trend === 'declining' || avgRecentRS < 40)) return 4
  if (rs < 50 && trend === 'flat') return 1
  if (rs >= 50 && rs < 70) return 2
  return 1
}
