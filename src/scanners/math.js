// ── Core math ─────────────────────────────────────────────────────────
export function ema(arr, n) {
  if (arr.length < n) return null
  const k = 2 / (n + 1)
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n
  for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k)
  return +e.toFixed(2)
}

export function emaArr(arr, n) {
  if (arr.length < n) return arr.map(() => null)
  const k = 2 / (n + 1), result = arr.map(() => null)
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n
  result[n - 1] = +e.toFixed(2)
  for (let i = n; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); result[i] = +e.toFixed(2) }
  return result
}

export function sma(arr, n) {
  if (arr.length < n) return null
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n
}

// ── RS Rating ─────────────────────────────────────────────────────────
export function calcRSRaw(prices, endIdx) {
  const end = endIdx ?? prices.length - 1
  if (end < 60) return null
  const last = prices[end]
  const p63  = prices[Math.max(0, end - 63)]
  const p126 = prices[Math.max(0, end - 126)]
  const p189 = prices[Math.max(0, end - 189)]
  const p252 = prices[Math.max(0, end - 252)]
  return (
    0.4 * ((last - p63)  / p63)  +
    0.2 * ((p63  - p126) / p126) +
    0.2 * ((p126 - p189) / p189) +
    0.2 * ((p189 - p252) / p252)
  )
}

export function percentileRank(arr, val) {
  const below = arr.filter(v => v < val).length
  return Math.min(99, Math.max(1, Math.round((below / arr.length) * 99) + 1))
}

// Build 15-day RS history for all stocks
export function buildRSHistory(allStocks, days = 15) {
  const n = allStocks[0].prices.length
  const history = {}
  allStocks.forEach(s => { history[s.sym] = [] })
  for (let d = days - 1; d >= 0; d--) {
    const endIdx = n - 1 - d
    const rawMap = {}
    allStocks.forEach(s => {
      const raw = calcRSRaw(s.prices, endIdx)
      if (raw !== null) rawMap[s.sym] = raw
    })
    const rawVals = Object.values(rawMap)
    allStocks.forEach(s => {
      history[s.sym].push(
        rawMap[s.sym] !== undefined ? percentileRank(rawVals, rawMap[s.sym]) : null
      )
    })
  }
  return history
}

// RS slope / trend
export function rsSlope(hist) {
  const valid = hist.filter(v => v !== null)
  if (valid.length < 4) return { trend: 'flat', slope: 0 }
  const n = valid.length, xMean = (n - 1) / 2, yMean = valid.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  valid.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2 })
  const slope = den ? num / den : 0
  return {
    trend: slope > 1.5 ? 'improving' : slope < -1.5 ? 'declining' : 'flat',
    slope: +slope.toFixed(2)
  }
}

// ── Pocket Pivot ──────────────────────────────────────────────────────
// Returns isPP for today + last 10 days history
export function detectPP(prices, volumes) {
  const n = prices.length
  if (n < 12) return { isPP: false, ppHistory: [], volRatio: 0, ma10: null, ma50: null, ppCount10d: 0 }

  // Detect PP for a given day index
  function isPPAt(idx) {
    if (idx < 11) return false
    const today     = prices[idx]
    const yesterday = prices[idx - 1]
    if (today <= yesterday) return false
    const ma10 = sma(prices.slice(0, idx + 1), 10)
    const ma50 = sma(prices.slice(0, idx + 1), Math.min(50, idx + 1))
    if (!ma10 || !ma50) return false
    const aboveMa10 = today > ma10
    const nearMa10  = today < ma10 * 1.08
    const aboveMa50 = today > ma50
    // Down-vol check
    const prior10P = prices.slice(idx - 10, idx)
    const prior10V = volumes.slice(idx - 10, idx)
    let maxDownVol = 0
    for (let i = 1; i < prior10P.length; i++)
      if (prior10P[i] < prior10P[i - 1]) maxDownVol = Math.max(maxDownVol, prior10V[i])
    if (maxDownVol === 0) maxDownVol = prior10V.reduce((a, b) => a + b, 0) / prior10V.length
    return volumes[idx] > maxDownVol && aboveMa10 && nearMa10 && aboveMa50
  }

  // Last 10 days PP history
  const ppHistory = []
  for (let d = 9; d >= 0; d--) {
    ppHistory.push(isPPAt(n - 1 - d))
  }
  const ppCount10d = ppHistory.filter(Boolean).length

  // Today's detail
  const isPP = isPPAt(n - 1)
  const ma10  = sma(prices, 10)
  const ma50  = sma(prices, 50)
  const prior10P = prices.slice(n - 11, n - 1)
  const prior10V = volumes.slice(n - 11, n - 1)
  let maxDownVol = 0
  for (let i = 1; i < prior10P.length; i++)
    if (prior10P[i] < prior10P[i - 1]) maxDownVol = Math.max(maxDownVol, prior10V[i])
  if (maxDownVol === 0) maxDownVol = prior10V.reduce((a, b) => a + b, 0) / prior10V.length

  return {
    isPP, ppHistory, ppCount10d,
    volRatio: maxDownVol > 0 ? +(volumes[n - 1] / maxDownVol).toFixed(2) : 0,
    ma10: ma10 ? +ma10.toFixed(2) : null,
    ma50: ma50 ? +ma50.toFixed(2) : null,
  }
}

// ── Volume signals ────────────────────────────────────────────────────
export function calcHY(volumes) {
  const yr = volumes.slice(-252), maxVol = Math.max(...yr), todayVol = volumes[volumes.length - 1]
  return { isHY: todayVol >= maxVol * 0.95, todayVol, maxVol52w: maxVol, pctOfMax: +(todayVol / maxVol * 100).toFixed(1) }
}
export function calcHT(volumes) {
  const maxVol = Math.max(...volumes), todayVol = volumes[volumes.length - 1]
  return { isHT: todayVol >= maxVol * 0.95, todayVol, maxVolAllTime: maxVol, pctOfATH: +(todayVol / maxVol * 100).toFixed(1) }
}

// RS 90+ near 9-EMA
export function calcNearEMA9(prices, rs) {
  const e9 = ema(prices, 9)
  if (!e9 || rs < 90) return { isNearEMA9: false, ema9: e9, pctFromEMA9: null }
  const last = prices[prices.length - 1], pct = +((last - e9) / e9 * 100).toFixed(2)
  return { isNearEMA9: Math.abs(pct) <= 3, ema9: e9, pctFromEMA9: pct }
}

// ── 52WL crossover ────────────────────────────────────────────────────
export function detect52WLCrossover(prices, volumes) {
  const n = prices.length
  const empty = { isSignal: false, near52wLow: false, pctFrom52wLow: 999, low52w: 0, high52w: 0,
    crossedAboveEMA5: false, ppVolume: false, ema5Today: null, volRatio: 0, daysSinceLow: 0, recovery: 0 }
  if (n < 260) return empty
  const today = prices[n - 1], yesterday = prices[n - 2]
  const low52w  = Math.min(...prices.slice(-252))
  const high52w = Math.max(...prices.slice(-252))
  const pctFrom52wLow = +((today - low52w) / low52w * 100).toFixed(2)
  const near52wLow = pctFrom52wLow <= 15
  const ea = emaArr(prices, 5)
  const ema5Today = ea[n - 1], ema5Yesterday = ea[n - 2]
  const crossedAboveEMA5 = ema5Yesterday !== null && ema5Today !== null && yesterday <= ema5Yesterday && today > ema5Today
  const isUpDay = today > yesterday
  const prior10P = prices.slice(n - 11, n - 1), prior10V = volumes.slice(n - 11, n - 1)
  let maxDownVol = 0
  for (let i = 1; i < prior10P.length; i++)
    if (prior10P[i] < prior10P[i - 1]) maxDownVol = Math.max(maxDownVol, prior10V[i])
  if (maxDownVol === 0) maxDownVol = prior10V.reduce((a, b) => a + b, 0) / prior10V.length
  const todayVol = volumes[n - 1]
  const ppVolume = isUpDay && todayVol > maxDownVol
  const volRatio = maxDownVol > 0 ? +(todayVol / maxDownVol).toFixed(2) : 0
  const daysSinceLow = 252 - prices.slice(-252).reduce((mi, v, i, a) => v < a[mi] ? i : mi, 0)
  return {
    isSignal: near52wLow && crossedAboveEMA5 && ppVolume,
    near52wLow, pctFrom52wLow, low52w: +low52w.toFixed(2), high52w: +high52w.toFixed(2),
    crossedAboveEMA5, ppVolume, ema5Today, volRatio, daysSinceLow,
    recovery: +((today - low52w) / low52w * 100).toFixed(2)
  }
}

// ── Weak RS big move ──────────────────────────────────────────────────
export function detectWeakRSBigMove(prices, volumes, rs, threshold = 8) {
  const n = prices.length
  if (n < 6) return { isSignal: false, chg1d: 0, chg5d: 0, volSpike: 0 }
  const today = prices[n - 1], yesterday = prices[n - 2] || today, week = prices[n - 6] || today
  const chg1d = +((today - yesterday) / yesterday * 100).toFixed(2)
  const chg5d = +((today - week) / week * 100).toFixed(2)
  const avgVol5 = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5
  const todayVol = volumes[n - 1]
  const volSpike = +(todayVol / Math.max(1, avgVol5)).toFixed(2)
  return {
    isSignal: rs < 50 && chg1d >= threshold,
    chg1d, chg5d, volSpike, isVolSpike: volSpike >= 1.5,
    avgVol5, todayVol
  }
}

// ── Sector RS Rating ──────────────────────────────────────────────────
// Given processed stocks array with rs, group by sector and compute avg + rank
export function buildSectorRS(processedStocks, sectorMap) {
  const sectorData = {}
  for (const [sector, syms] of Object.entries(sectorMap)) {
    const members = processedStocks.filter(s => syms.includes(s.sym))
    if (members.length === 0) continue
    const avgRS = Math.round(members.reduce((a, b) => a + b.rs, 0) / members.length)
    const topStocks = [...members].sort((a, b) => b.rs - a.rs).slice(0, 5)
    const ppCount = members.filter(s => s.pp.isPP).length
    const improving = members.filter(s => s.rsTrend.trend === 'improving').length
    sectorData[sector] = { sector, avgRS, count: members.length, topStocks, ppCount, improving, members }
  }
  // Rank sectors by avgRS
  const ranked = Object.values(sectorData).sort((a, b) => b.avgRS - a.avgRS)
  ranked.forEach((s, i) => { s.rank = i + 1 })
  return ranked
}
