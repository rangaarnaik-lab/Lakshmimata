// ── Chart Pattern Analysis ──────────────────────────────────────────
// Computed client-side on-demand (only for stocks whose chart is actually
// opened) using the OHLCV data already fetched via fetchStockFullHistory.
// Mirrors the swing-pivot approach the backend's detect_vcp already uses
// for the scanner's VCP signal, extended here for full chart annotation.

/**
 * Pocket Pivot — per-day flags across the full series (the scanner's own
 * detectPP only returns the last 10 days; this covers any chart range).
 * Same rule: up day, above/near MA10, above MA50, volume beats the
 * worst down-day volume of the prior 10 days.
 */
export function detectPPDays(prices, volumes) {
  const n = prices.length
  const flags = new Array(n).fill(false)
  const ma10Series = calcSMASeries(prices, 10)
  const ma50Series = calcSMASeries(prices, 50)
  for (let idx = 11; idx < n; idx++) {
    const today = prices[idx], yesterday = prices[idx - 1]
    if (today <= yesterday) continue
    const ma10 = ma10Series[idx], ma50 = ma50Series[idx]
    if (ma10 == null || ma50 == null) continue
    if (!(today > ma10 && today < ma10 * 1.08 && today > ma50)) continue
    const priorP = prices.slice(idx - 10, idx)
    const priorV = volumes.slice(idx - 10, idx)
    let maxDownVol = 0
    for (let i = 1; i < priorP.length; i++) {
      if (priorP[i] < priorP[i - 1]) maxDownVol = Math.max(maxDownVol, priorV[i])
    }
    if (maxDownVol === 0) maxDownVol = priorV.reduce((a, b) => a + b, 0) / priorV.length
    flags[idx] = volumes[idx] > maxDownVol
  }
  return flags
}

/** HY — volume at/near the trailing-252-day (52-week) max, per day. */
export function detectHYDays(volumes) {
  const n = volumes.length
  const flags = new Array(n).fill(false)
  for (let idx = 0; idx < n; idx++) {
    const window = volumes.slice(Math.max(0, idx - 251), idx + 1)
    const maxVol = Math.max(...window)
    flags[idx] = maxVol > 0 && volumes[idx] >= maxVol * 0.95
  }
  return flags
}

/** HT — volume at/near the all-time max seen up to that day. */
export function detectHTDays(volumes) {
  const n = volumes.length
  const flags = new Array(n).fill(false)
  let runningMax = 0
  for (let idx = 0; idx < n; idx++) {
    runningMax = Math.max(runningMax, volumes[idx])
    flags[idx] = runningMax > 0 && volumes[idx] >= runningMax * 0.95
  }
  return flags
}

/**
 * IBV — same rule as the backend's live signal, applied per historical
 * day: that day's volume vs the prior 10 days' max, and where that day's
 * own close fell within its own high/low range.
 */
export function detectIBVDays(highs, lows, closes, volumes) {
  const n = closes.length
  const flags = new Array(n).fill(false)
  for (let idx = 10; idx < n; idx++) {
    const maxRecent = Math.max(...volumes.slice(idx - 10, idx))
    if (maxRecent <= 0 || volumes[idx] < 2 * maxRecent) continue
    const range = highs[idx] - lows[idx]
    if (range <= 0) continue
    flags[idx] = (closes[idx] - lows[idx]) / range * 100 > 50
  }
  return flags
}

/** Simple moving average series — null until enough data points exist. */
export function calcSMASeries(values, period) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/**
 * Swing high/low pivot detection — a bar is a swing high if its high is
 * the max within a +/- `lookback` window, swing low similarly for lows.
 */
export function findSwingPoints(highs, lows, lookback = 5) {
  const pivots = []
  const n = highs.length
  for (let i = lookback; i < n - lookback; i++) {
    const windowH = highs.slice(i - lookback, i + lookback + 1)
    const windowL = lows.slice(i - lookback, i + lookback + 1)
    if (highs[i] === Math.max(...windowH)) {
      pivots.push({ idx: i, price: highs[i], type: 'H' })
    } else if (lows[i] === Math.min(...windowL)) {
      pivots.push({ idx: i, price: lows[i], type: 'L' })
    }
  }
  return pivots
}

/**
 * Support/Resistance levels from recent swing points. R1/R2 = nearest
 * two swing highs above current price, S1/S2 = nearest two swing lows
 * below it.
 */
export function computeSupportResistance(pivots, currentPrice) {
  const highs = pivots.filter(p => p.type === 'H')
  const lows  = pivots.filter(p => p.type === 'L')
  const resistances = highs.filter(p => p.price > currentPrice).sort((a, b) => a.price - b.price)
  const supports    = lows.filter(p => p.price < currentPrice).sort((a, b) => b.price - a.price)
  return {
    r1: resistances[0]?.price ?? null,
    r2: resistances[1]?.price ?? null,
    s1: supports[0]?.price ?? null,
    s2: supports[1]?.price ?? null,
  }
}

/** Inside Bar — this bar's full high/low range sits within the previous bar's range. */
export function detectInsideBars(highs, lows) {
  const flags = new Array(highs.length).fill(false)
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] <= highs[i - 1] && lows[i] >= lows[i - 1]) flags[i] = true
  }
  return flags
}

/**
 * Accumulation/Distribution day — close in the upper/lower quartile of
 * the day's range, on volume meaningfully above the 20-day average.
 * 'acc' = likely institutional buying, 'dist' = likely institutional selling.
 */
export function detectAccDistDays(highs, lows, closes, volumes) {
  const n = closes.length
  const result = new Array(n).fill(null)
  for (let i = 20; i < n; i++) {
    const range = highs[i] - lows[i]
    if (!range || !volumes[i]) continue
    const clv = (closes[i] - lows[i]) / range // close location value, 0-1
    let sum = 0
    for (let j = i - 20; j < i; j++) sum += volumes[j] || 0
    const avgVol20 = sum / 20
    if (!avgVol20 || volumes[i] <= avgVol20 * 1.2) continue
    if (clv >= 0.75) result[i] = 'acc'
    else if (clv <= 0.25) result[i] = 'dist'
  }
  return result
}

/**
 * VCP (Volatility Contraction Pattern) — same H-L-H-L contracting
 * pullback sequence the backend's detect_vcp looks for, computed here
 * for chart annotation (which specific swing points to mark/connect).
 */
export function detectVCPContractions(pivots) {
  const sequence = []
  let lastType = null
  for (const p of pivots) {
    if (p.type !== lastType) {
      sequence.push(p)
      lastType = p.type
    }
  }
  const contractions = []
  for (let i = 0; i < sequence.length - 1; i++) {
    if (sequence[i].type === 'H' && sequence[i + 1].type === 'L') {
      const pullbackPct = (sequence[i].price - sequence[i + 1].price) / sequence[i].price * 100
      contractions.push({ high: sequence[i], low: sequence[i + 1], pullbackPct })
    }
  }
  const recent = contractions.slice(-4)
  const isContracting = recent.length >= 2 &&
    recent.every((c, i) => i === 0 || c.pullbackPct < recent[i - 1].pullbackPct * 1.05)
  return { contractions: recent, isContracting: isContracting && recent.length >= 2 }
}

/**
 * Cup & Handle — heuristic detection over a trailing window. This is
 * inherently fuzzy (even human chartists disagree on borderline cases),
 * so treat this as a rough visual aid, not a precise signal:
 * 1. Left lip = highest point in the first ~15% of the window
 * 2. Cup bottom = lowest point between the left lip and the handle zone
 * 3. Right lip = highest point after the bottom, before the handle zone
 * 4. Handle = a shallow (5-20%) pullback in the last ~20% of the window
 */
export function detectCupAndHandle(prices, highs, lows, lookback = 130) {
  const n = prices.length
  if (n < lookback) return null
  const wHighs = highs.slice(-lookback)
  const wLows  = lows.slice(-lookback)

  const leftZoneEnd = Math.floor(lookback * 0.15)
  let leftLipIdx = 0, leftLip = -Infinity
  for (let i = 0; i < leftZoneEnd; i++) {
    if (wHighs[i] > leftLip) { leftLip = wHighs[i]; leftLipIdx = i }
  }

  const handleZoneStart = Math.floor(lookback * 0.8)
  let bottomIdx = leftLipIdx, bottom = Infinity
  for (let i = leftLipIdx; i < handleZoneStart; i++) {
    if (wLows[i] < bottom) { bottom = wLows[i]; bottomIdx = i }
  }
  const depthPct = leftLip ? (leftLip - bottom) / leftLip * 100 : 0

  let rightLipIdx = bottomIdx, rightLip = -Infinity
  for (let i = bottomIdx; i < handleZoneStart; i++) {
    if (wHighs[i] > rightLip) { rightLip = wHighs[i]; rightLipIdx = i }
  }
  const rightLipRecovery = leftLip ? rightLip / leftLip : 0

  const handleHighs = wHighs.slice(handleZoneStart)
  const handleLows  = wLows.slice(handleZoneStart)
  const handleHigh = handleHighs.length ? Math.max(...handleHighs) : 0
  const handleLow  = handleLows.length ? Math.min(...handleLows) : 0
  const handleDepthPct = handleHigh ? (handleHigh - handleLow) / handleHigh * 100 : 0

  const isValidCup = depthPct >= 12 && depthPct <= 50 &&
                      rightLipRecovery >= 0.90 &&
                      (bottomIdx - leftLipIdx) >= lookback * 0.15
  if (!isValidCup) return null

  const offset = n - lookback
  return {
    leftLipIdx:  offset + leftLipIdx,
    bottomIdx:   offset + bottomIdx,
    rightLipIdx: offset + rightLipIdx,
    depthPct: Math.round(depthPct),
    hasHandle: handleDepthPct >= 5 && handleDepthPct <= 20,
    handleDepthPct: Math.round(handleDepthPct),
  }
}
