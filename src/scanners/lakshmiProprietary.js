/** Proprietary indicator core — formulas; production build obfuscates this chunk. */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = e
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k)
    out[i] = e
  }
  return out
}

function calcSMASeries(values, period) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export const LAKSHMI_VOL_COLORS = {
  // Lakshmi_Mata_Volume.pine — Volume_color
  IBV: '#2195F3',       // color.rgb(33, 149, 243)
  PPV: '#4CAF50',       // color.green
  DOWN: '#FF5252',      // color.red
  NEUTRAL: '#787B86',   // color.gray
  LOW_VOL_BG: '#EEE7EE', // color.rgb(238, 231, 238)
  BULL_SNORT_BG: '#D2AAE6', // color.rgb(210, 170, 230)
  IBV_ICON: '#FF69B4',  // Mata.pine below-candle IBV (hot pink)
  PPV_ICON: '#FFFFFF',  // dark chart: white star (Pine uses black on light TV theme)
  BULL_SNORT_ICON: '#E040FB', // Mata col_BullSnort
  VOL_MA: '#141414',    // color.rgb(20, 20, 20)
}

/** Candle barcolor — Lakshmi_Mata.pine defaults (color.blue/purple/orange/lime). */
export const LAKSHMI_BAR_COLORS = {
  IBV: '#2196F3',  // color.blue
  HT: '#9C27B0',   // color.purple
  HY: '#FF9800',   // color.orange
  PPV: '#00E676',  // color.lime
}

/** Buy/Sell labels — Lakshmi_Mata.pine plotshape color.green / color.red */
export const LAKSHMI_BUY_SELL_COLORS = {
  BUY: '#4CAF50',
  SELL: '#FF5252',
  BULL_SNORT: '#E040FB', // Mata overlay col_BullSnort
}

/** Super Cycle pane — Lakshmi_Mata_Super_Cycle_merged.pine */
export const LAKSHMI_CYCLE_COLORS = {
  POS_UP: '#00E676',
  POS_DOWN: '#388E3C',
  NEG_DOWN: '#F44336',
  NEG_UP: '#B71C1C',
  GRAY: '#787B86',
  RS: '#04DBEE',
  MOM: '#FFD600',
  RS_MA: '#90A4AE',
  SQUEEZE_ON: '#FF1744',
  SQUEEZE_RELEASE: '#00E676',
  ZERO: 'rgba(255,255,255,0.3)',
  /** Mata.pine alternate bright green for cycle+up (if comparing to overlay script) */
  POS_UP_MATA: '#15FF00',
}

/** Pine cycle histogram color (sign × direction vs prior bar). */
export function lakshmiCycleBarColor(cycle, prevCycle) {
  if (cycle == null || Number.isNaN(cycle)) return LAKSHMI_CYCLE_COLORS.GRAY
  const up = prevCycle != null && cycle > prevCycle
  const down = prevCycle != null && cycle < prevCycle
  if (cycle >= 0 && up) return LAKSHMI_CYCLE_COLORS.POS_UP
  if (cycle >= 0 && down) return LAKSHMI_CYCLE_COLORS.POS_DOWN
  if (cycle < 0 && down) return LAKSHMI_CYCLE_COLORS.NEG_DOWN
  if (cycle < 0 && up) return LAKSHMI_CYCLE_COLORS.NEG_UP
  return LAKSHMI_CYCLE_COLORS.GRAY
}

/** EMA that skips nulls (matches Pine ta.ema with na gaps — do not seed with 0). */
function emaSeriesSkipNull(values, period) {
  const out = new Array(values.length).fill(null)
  if (period < 1) return out
  const k = 2 / (period + 1)
  let e = null
  let seedCount = 0
  let seedSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null || Number.isNaN(v)) continue
    if (e == null) {
      seedSum += v
      seedCount++
      if (seedCount === period) {
        e = seedSum / period
        out[i] = e
      }
    } else {
      e = v * k + e * (1 - k)
      out[i] = e
    }
  }
  return out
}

export function calcLakshmiVolumeIndicator(dates, opens, highs, lows, closes, volumes, opts = {}) {
  const lookbackIV = opts.lookbackIV ?? 10
  const lookbackPP = opts.lookbackPP ?? 10
  const maLength = opts.maLength ?? 10
  const lookbackAvg = opts.lookbackAvg ?? 50
  const lookbackUD = opts.lookbackUD ?? 50
  const bullSnortMult = Number(opts.bullSnortMult) || 3
  const bullSnortDcr = Number(opts.bullSnortDcr) || 65
  const snortAvgLen = Math.max(1, Math.round(Number(opts.snortAvgLen) || 50))
  const ivMult = Number(opts.ivMult) || 2
  const ivDcr = Number(opts.ivDcr) || 50
  const lowVolMult = Number(opts.lowVolMult) || 0.5
  const n = closes.length
  const empty = () => ({
    volMA: new Array(n).fill(null),
    ivDay: new Array(n).fill(false),
    ppDay: new Array(n).fill(false),
    bullSnort: new Array(n).fill(false),
    isHT: new Array(n).fill(false),
    isHY: new Array(n).fill(false),
    isHQ: new Array(n).fill(false),
    isHM: new Array(n).fill(false),
    lowVol: new Array(n).fill(false),
    barColor: new Array(n).fill(null),
    comment: new Array(n).fill('NA'),
    metrics: null,
  })
  if (n < 5) return empty()

  const volMA = calcSMASeries(volumes, maLength)
  const avgVolSnort = calcSMASeries(volumes, snortAvgLen)
  const avgVolLookback = calcSMASeries(volumes, lookbackAvg)

  const ivDay = new Array(n).fill(false)
  const ppDay = new Array(n).fill(false)
  const bullSnort = new Array(n).fill(false)
  const isHT = new Array(n).fill(false)
  const isHY = new Array(n).fill(false)
  const isHQ = new Array(n).fill(false)
  const isHM = new Array(n).fill(false)
  const lowVol = new Array(n).fill(false)
  const barColor = new Array(n).fill(null)
  const comment = new Array(n).fill('NA')
  const dcrArr = new Array(n).fill(null)

  let highestVolSinceIPO = 0
  let curYear = null, highestVolThisYear = 0
  let curQuarter = null, highestVolThisQuarter = 0
  let curMonth = null, highestVolThisMonth = 0

  for (let i = 0; i < n; i++) {
    const o = opens?.[i] ?? (i > 0 ? closes[i - 1] : closes[i])
    const h = highs[i], l = lows[i], c = closes[i], v = volumes[i]
    if (c == null || v == null) continue

    const greenDay = c > o
    const upday = i > 0 && c > closes[i - 1]
    const barRange = (h ?? c) - (l ?? c)
    const dcr = barRange > 0 ? ((c - (l ?? c)) / barRange) * 100 : null
    dcrArr[i] = dcr
    const dailyClosingRange = dcr != null && dcr > ivDcr

    let maxPriorVol = 0
    for (let j = Math.max(0, i - lookbackIV); j < i; j++) {
      if (volumes[j] != null) maxPriorVol = Math.max(maxPriorVol, volumes[j])
    }
    const iv = maxPriorVol > 0 && v >= ivMult * maxPriorVol && greenDay && upday && dailyClosingRange
    ivDay[i] = iv

    let highestDownVol = 0
    for (let k = 1; k <= lookbackPP && i - k >= 0; k++) {
      const j = i - k
      const oj = opens?.[j] ?? (j > 0 ? closes[j - 1] : closes[j])
      if (closes[j] != null && oj != null && closes[j] < oj && volumes[j] != null) {
        highestDownVol = Math.max(highestDownVol, volumes[j])
      }
    }
    const pp = greenDay && v > highestDownVol && volMA[i] != null && v > volMA[i] && !iv
    ppDay[i] = pp

    const relSnort = avgVolSnort[i] > 0 ? v / avgVolSnort[i] : null
    bullSnort[i] = relSnort != null
      && relSnort >= bullSnortMult
      && i > 0 && c > closes[i - 1]
      && dcr != null
      && dcr >= bullSnortDcr

    lowVol[i] = volMA[i] != null && v < volMA[i] * lowVolMult

    highestVolSinceIPO = Math.max(highestVolSinceIPO, v)
    const hvtIpo = v === highestVolSinceIPO && highestVolSinceIPO > 0
    isHT[i] = hvtIpo

    const d = dates[i] || ''
    const y = parseInt(d.slice(0, 4), 10)
    const m = parseInt(d.slice(5, 7), 10)
    const day = parseInt(d.slice(8, 10), 10)
    const q = Number.isFinite(m) ? Math.ceil(m / 3) : null
    let hvtYear = false, hvtQuarter = false, hvtMonth = false
    if (Number.isFinite(y)) {
      if (curYear !== y) { curYear = y; highestVolThisYear = v }
      else highestVolThisYear = Math.max(highestVolThisYear, v)
      hvtYear = v === highestVolThisYear

      const qKey = y * 10 + q
      if (curQuarter !== qKey) { curQuarter = qKey; highestVolThisQuarter = v }
      else highestVolThisQuarter = Math.max(highestVolThisQuarter, v)
      hvtQuarter = v === highestVolThisQuarter

      const mKey = y * 100 + m
      if (curMonth !== mKey) { curMonth = mKey; highestVolThisMonth = v }
      else highestVolThisMonth = Math.max(highestVolThisMonth, v)
      hvtMonth = v === highestVolThisMonth
    }

    const volChangePct = i > 0 && volumes[i - 1] > 0
      ? ((v - volumes[i - 1]) / volumes[i - 1]) * 100
      : null
    const isJanFirst = m === 1 && day === 1
    const hyDay = hvtYear
      && !hvtIpo
      && (!isJanFirst || (volChangePct != null && volChangePct > 500))
      && greenDay
      && v > highestDownVol
      && volMA[i] != null
      && v > volMA[i]

    isHY[i] = hyDay
    isHQ[i] = hvtQuarter && !hvtIpo && !hvtYear
    isHM[i] = hvtMonth && !hvtIpo && !hvtYear && !hvtQuarter

    comment[i] = hvtIpo ? 'HT'
      : hyDay ? 'HY'
      : iv ? 'IBV'
      : bullSnort[i] ? 'Bull Snort'
      : pp ? 'PPV'
      : isHQ[i] ? 'HQ'
      : isHM[i] ? 'M'
      : 'NA'

    barColor[i] = iv
      ? LAKSHMI_VOL_COLORS.IBV
      : pp
        ? LAKSHMI_VOL_COLORS.PPV
        : (c < o ? LAKSHMI_VOL_COLORS.DOWN : LAKSHMI_VOL_COLORS.NEUTRAL)
  }

  // Table metrics for the latest bar
  const last = n - 1
  let sumUp = 0, sumDn = 0
  for (let i = Math.max(0, n - lookbackUD); i < n; i++) {
    if (i === 0 || closes[i] == null || closes[i - 1] == null) continue
    if (closes[i] > closes[i - 1]) sumUp += volumes[i] || 0
    else if (closes[i] < closes[i - 1]) sumDn += volumes[i] || 0
  }
  const upDn = sumDn > 0 ? sumUp / sumDn : null
  const relVol = avgVolLookback[last] > 0 ? (volumes[last] / avgVolLookback[last]) * 100 : null
  const volChg = last > 0 && volumes[last - 1] > 0
    ? ((volumes[last] - volumes[last - 1]) / volumes[last - 1]) * 100
    : null
  let pivotCount = 0, ibvCount = 0
  for (let i = Math.max(0, n - lookbackPP); i < n; i++) {
    if (ppDay[i]) pivotCount++
    if (ivDay[i]) ibvCount++
  }
  const metrics = {
    volume: volumes[last],
    avgVol: avgVolLookback[last],
    relVolPct: relVol,
    upDnRatio: upDn,
    dcr: dcrArr[last],
    changePct: volChg,
    ppvCount: pivotCount,
    ibvCount: ibvCount,
    comment: comment[last],
    lookbackAvg,
    lookbackUD,
    lookbackPP,
    maLength,
  }

  return { volMA, ivDay, ppDay, bullSnort, isHT, isHY, isHQ, isHM, lowVol, barColor, comment, metrics }
}

export function calcLakshmiCandleBarColors(opens, highs, lows, closes, volumes, opts = {}) {
  const lookbackIV = opts.lookbackIV ?? 10
  const lookbackPP = opts.lookbackPP ?? 10
  const n = closes.length
  const colors = new Array(n).fill(null)
  const tags = new Array(n).fill(null)
  if (n < lookbackIV + 2) return { colors, tags }

  const volEma = emaSeries(volumes, lookbackIV)
  const highestPriorVol = (i, length) => {
    let hi = -Infinity
    const start = Math.max(0, i - length)
    for (let j = start; j < i; j++) {
      if (volumes[j] != null && volumes[j] > hi) hi = volumes[j]
    }
    return Number.isFinite(hi) ? hi : null
  }

  for (let i = 1; i < n; i++) {
    const o = opens?.[i] ?? closes[i - 1]
    const h = highs[i], l = lows[i], c = closes[i], v = volumes[i]
    if (h == null || l == null || c == null || v == null || o == null) continue

    const greenDay = c > o
    const upday = c > closes[i - 1]
    const range = h - l
    const dailyClosingRange = range !== 0 ? ((c - l) / range) * 100 > 50 : false

    const maxVolPriorIV = highestPriorVol(i, lookbackIV)
    const ivDay = maxVolPriorIV != null
      && v >= 2 * maxVolPriorIV
      && greenDay
      && upday
      && dailyClosingRange

    let maxDownVol = 0
    const ppStart = Math.max(0, i - lookbackPP)
    for (let j = ppStart; j < i; j++) {
      if (j > 0 && closes[j] < closes[j - 1] && volumes[j] != null) {
        maxDownVol = Math.max(maxDownVol, volumes[j])
      }
    }
    const pivotPocket = greenDay
      && v >= maxDownVol
      && volEma[i] != null
      && v > volEma[i]
      && !ivDay

    const maxVol1000 = highestPriorVol(i, 1000)
    const maxVol365 = highestPriorVol(i, 365)
    const isHT = maxVol1000 != null && v >= maxVol1000
    const isHY = maxVol365 != null && v >= maxVol365

    if (ivDay) {
      colors[i] = LAKSHMI_BAR_COLORS.IBV
      tags[i] = 'IBV'
    } else if (isHT) {
      colors[i] = LAKSHMI_BAR_COLORS.HT
      tags[i] = 'HT'
    } else if (isHY) {
      colors[i] = LAKSHMI_BAR_COLORS.HY
      tags[i] = 'HY'
    } else if (pivotPocket) {
      colors[i] = LAKSHMI_BAR_COLORS.PPV
      tags[i] = 'PPV'
    }
  }
  return { colors, tags }
}

export function detectLakshmiBuySellSignals(highs, lows, closes, niftyClosesAligned = null, opts = {}) {
  const n = closes.length
  const buy = new Array(n).fill(false)
  const sell = new Array(n).fill(false)
  const trendOut = new Array(n).fill(1)
  if (n < 60) return { buy, sell, trend: trendOut }

  const atrPeriod = opts.atrPeriod ?? 10
  const multiplier = opts.multiplier ?? 2.0
  const emaFastLen = opts.emaFast ?? 9
  const emaMidLen = opts.emaMid ?? 21
  const emaSlowLen = opts.emaSlow ?? 50
  const emaLongLen = opts.emaLong ?? 200
  const rsMin = opts.rsMin ?? 50
  const rsRise = opts.rsRise ?? 10
  const ema9 = emaSeries(closes, emaFastLen)
  const ema21 = emaSeries(closes, emaMidLen)
  const ema50 = emaSeries(closes, emaSlowLen)
  const ema200 = emaSeries(closes, emaLongLen)

  // ATR
  const tr = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = (highs[i] ?? closes[i]) - (lows[i] ?? closes[i])
      continue
    }
    const h = highs[i] ?? closes[i]
    const l = lows[i] ?? closes[i]
    const pc = closes[i - 1]
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  const atr = new Array(n).fill(null)
  if (n >= atrPeriod) {
    let sum = 0
    for (let i = 0; i < atrPeriod; i++) sum += tr[i]
    atr[atrPeriod - 1] = sum / atrPeriod
    for (let i = atrPeriod; i < n; i++) {
      atr[i] = (atr[i - 1] * (atrPeriod - 1) + tr[i]) / atrPeriod
    }
  }

  // Trend bands
  const up = new Array(n).fill(null)
  const dn = new Array(n).fill(null)
  const trend = new Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    if (atr[i] == null) {
      trend[i] = i > 0 ? trend[i - 1] : 1
      trendOut[i] = trend[i]
      continue
    }
    const src = closes[i]
    let upRaw = src - multiplier * atr[i]
    let dnRaw = src + multiplier * atr[i]
    const up1 = i > 0 && up[i - 1] != null ? up[i - 1] : upRaw
    const dn1 = i > 0 && dn[i - 1] != null ? dn[i - 1] : dnRaw
    if (i > 0 && closes[i - 1] > up1) upRaw = Math.max(upRaw, up1)
    if (i > 0 && closes[i - 1] < dn1) dnRaw = Math.min(dnRaw, dn1)
    up[i] = upRaw
    dn[i] = dnRaw
    let t = i > 0 ? trend[i - 1] : 1
    if (t === -1 && closes[i] > dn1) t = 1
    else if (t === 1 && closes[i] < up1) t = -1
    trend[i] = t
    trendOut[i] = t
  }

  // Relative strength vs benchmark (optional)
  const rsRating = new Array(n).fill(null)
  const niftyOk = Array.isArray(niftyClosesAligned) && niftyClosesAligned.length === n
  if (niftyOk) {
    const perf = (arr, i, len) => {
      if (i < len || arr[i] == null || arr[i - len] == null || arr[i - len] === 0) return null
      return ((arr[i] - arr[i - len]) / arr[i - len]) * 100
    }
    const rawRS = new Array(n).fill(null)
    for (let i = 0; i < n; i++) {
      const a = perf(closes, i, 63), b = perf(closes, i, 126)
      const c = perf(closes, i, 189), d = perf(closes, i, 252)
      const na = perf(niftyClosesAligned, i, 63), nb = perf(niftyClosesAligned, i, 126)
      const nc = perf(niftyClosesAligned, i, 189), nd = perf(niftyClosesAligned, i, 252)
      if ([a, b, c, d, na, nb, nc, nd].some(v => v == null)) continue
      rawRS[i] = (a - na) * 0.4 + (b - nb) * 0.2 + (c - nc) * 0.2 + (d - nd) * 0.2
    }
    for (let i = 0; i < n; i++) {
      if (rawRS[i] == null) continue
      const start = Math.max(0, i - 251)
      let hi = -Infinity, lo = Infinity
      for (let j = start; j <= i; j++) {
        if (rawRS[j] == null) continue
        hi = Math.max(hi, rawRS[j])
        lo = Math.min(lo, rawRS[j])
      }
      if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi === lo) {
        rsRating[i] = 50
      } else {
        rsRating[i] = Math.round(((rawRS[i] - lo) / (hi - lo)) * 98 + 1)
      }
    }
  }

  let pendingUptrendBuy = false
  let inLongPosition = false
  for (let i = 1; i < n; i++) {
    const rawUptrendFlip = trend[i] === 1 && trend[i - 1] === -1
    if (rawUptrendFlip) pendingUptrendBuy = true
    if (trend[i] === -1) pendingUptrendBuy = false

    const e9 = ema9[i], e21 = ema21[i], e50 = ema50[i], e200 = ema200[i]
    const maOk = e9 != null && e50 != null && e9 > e50
    const above50 = e50 != null && closes[i] > e50
    const above200 = e200 != null && closes[i] > e200
    let rsOk = true
    if (niftyOk && rsRating[i] != null) {
      const rising = i >= 21 && rsRating[i - 21] != null
        ? (rsRating[i] - rsRating[i - 21]) >= rsRise
        : false
      rsOk = rsRating[i] > rsMin || rising
    }
    const emaConditionMet = above50 && above200 && maOk && rsOk
    const buySignal = pendingUptrendBuy && emaConditionMet
    if (buySignal) {
      buy[i] = true
      pendingUptrendBuy = false
      inLongPosition = true
    }

    const supertrendSellRaw = trend[i] === -1 && trend[i - 1] === 1
    const sellEMACrossConfirmed = e9 != null && e21 != null && e9 < e21
    const emaCrossUnderSell = e9 != null && e21 != null && ema9[i - 1] != null && ema21[i - 1] != null
      && ema9[i - 1] >= ema21[i - 1] && e9 < e21
    const sellSignal = (supertrendSellRaw && sellEMACrossConfirmed) || emaCrossUnderSell
    if (sellSignal) {
      if (inLongPosition) sell[i] = true
      inLongPosition = false
    }
  }

  return { buy, sell, trend: trendOut }
}

/** Align a benchmark close series to stock length by matching from the end (both ≈ end today). */
export function alignSeriesFromEnd(stockLen, benchCloses) {
  const out = new Array(stockLen).fill(null)
  if (!benchCloses?.length) return out
  const m = benchCloses.length
  for (let i = 0; i < stockLen; i++) {
    const bi = m - (stockLen - i)
    if (bi >= 0 && bi < m) out[i] = benchCloses[bi]
  }
  return out
}

function linRegAt(src, i, length) {
  if (i < length - 1) return null
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let k = 0; k < length; k++) {
    const y = src[i - length + 1 + k]
    if (y == null || Number.isNaN(y)) return null
    sumX += k
    sumY += y
    sumXY += k * y
    sumX2 += k * k
  }
  const den = length * sumX2 - sumX * sumX
  if (den === 0) return null
  const b = (length * sumXY - sumX * sumY) / den
  const a = (sumY - b * sumX) / length
  return a + b * (length - 1)
}

function rollingHighest(arr, i, length) {
  let hi = -Infinity
  const start = Math.max(0, i - length + 1)
  for (let j = start; j <= i; j++) {
    if (arr[j] != null && arr[j] > hi) hi = arr[j]
  }
  return Number.isFinite(hi) ? hi : null
}
function rollingLowest(arr, i, length) {
  let lo = Infinity
  const start = Math.max(0, i - length + 1)
  for (let j = start; j <= i; j++) {
    if (arr[j] != null && arr[j] < lo) lo = arr[j]
  }
  return Number.isFinite(lo) ? lo : null
}

/** IBD-style RS rating vs a benchmark close series (aligned length). */
function calcRSRatingVsBench(closes, benchAligned) {
  const n = closes.length
  const out = new Array(n).fill(null)
  if (!Array.isArray(benchAligned) || benchAligned.length !== n) return out
  const perf = (arr, i, len) => {
    if (i < len || arr[i] == null || arr[i - len] == null || arr[i - len] === 0) return null
    return ((arr[i] - arr[i - len]) / arr[i - len]) * 100
  }
  const rawRS = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const a = perf(closes, i, 63), b = perf(closes, i, 126)
    const c = perf(closes, i, 189), d = perf(closes, i, 252)
    const na = perf(benchAligned, i, 63), nb = perf(benchAligned, i, 126)
    const nc = perf(benchAligned, i, 189), nd = perf(benchAligned, i, 252)
    if ([a, b, c, d, na, nb, nc, nd].some(v => v == null)) continue
    rawRS[i] = (a - na) * 0.4 + (b - nb) * 0.2 + (c - nc) * 0.2 + (d - nd) * 0.2
  }
  for (let i = 0; i < n; i++) {
    if (rawRS[i] == null) continue
    const hi = rollingHighest(rawRS, i, 252)
    const lo = rollingLowest(rawRS, i, 252)
    if (hi == null || lo == null || hi === lo) out[i] = 50
    else out[i] = Math.round(((rawRS[i] - lo) / (hi - lo)) * 98 + 1)
  }
  return out
}

/** Lakshmi Mata 52-week break flags. */
export const LAKSHMI_HILO_COLORS = {
  HIGH: '#2962FF',
  LOW: '#FF6D00',
}

/**
 * New 52-week high / low per bar.
 *
 * The window is measured in calendar days off the bar dates rather than a
 * fixed bar count, so the same 52 weeks apply on daily, weekly and intraday
 * series. Rolling extremes come from monotonic deques (O(n)).
 *
 * `onlyFirst` marks just the bar that opens a run of new highs — otherwise a
 * trending stock earns a flag every single session.
 */
export function calcNewHighLowFlags(dates, highs, lows, opts = {}) {
  const windowDays = opts.windowDays ?? 365
  const minBars = opts.minBars ?? 20
  const onlyFirst = opts.onlyFirst !== false
  const n = highs?.length || 0
  const isHigh = new Array(n).fill(false)
  const isLow = new Array(n).fill(false)
  const newHigh = new Array(n).fill(false)
  const newLow = new Array(n).fill(false)
  if (n < minBars + 1) return { newHigh, newLow, isHigh, isLow }

  const ts = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = Date.parse(dates?.[i])
    ts[i] = Number.isFinite(t) ? t : null
  }
  const spanMs = windowDays * 86400000
  // Deques hold indices of candidate extremes in [left, i-1], decreasing highs
  // and increasing lows, so the front is always the window's extreme.
  const hq = []
  const lq = []
  let left = 0
  for (let i = 0; i < n; i++) {
    if (ts[i] != null) {
      while (left < i && ts[left] != null && ts[i] - ts[left] > spanMs) left++
    }
    while (hq.length && hq[0] < left) hq.shift()
    while (lq.length && lq[0] < left) lq.shift()
    const h = highs[i], l = lows[i]
    const priorBars = i - left
    if (h != null && Number.isFinite(h) && priorBars >= minBars && hq.length) {
      isHigh[i] = h > highs[hq[0]]
    }
    if (l != null && Number.isFinite(l) && priorBars >= minBars && lq.length) {
      isLow[i] = l < lows[lq[0]]
    }
    if (h != null && Number.isFinite(h)) {
      while (hq.length && highs[hq[hq.length - 1]] <= h) hq.pop()
      hq.push(i)
    }
    if (l != null && Number.isFinite(l)) {
      while (lq.length && lows[lq[lq.length - 1]] >= l) lq.pop()
      lq.push(i)
    }
  }
  for (let i = 0; i < n; i++) {
    newHigh[i] = isHigh[i] && (!onlyFirst || !isHigh[i - 1])
    newLow[i] = isLow[i] && (!onlyFirst || !isLow[i - 1])
  }
  return { newHigh, newLow, isHigh, isLow }
}

/**
 * Squeeze state per bar — Bollinger Bands wholly inside the Keltner Channel,
 * the same test the Super Cycle study uses. Split out so the price-pane dot
 * row can be drawn without computing the whole RS/cycle stack.
 */
export function calcLakshmiSqueeze(highs, lows, closes, opts = {}) {
  const length = opts.length ?? 21
  const bbMult = opts.bbMult ?? 2.0
  const kcMult = opts.kcMult ?? 1.5
  const n = closes?.length || 0
  const squeezeOn = new Array(n).fill(false)
  const squeezeRelease = new Array(n).fill(false)
  if (n < length + 1) return { squeezeOn, squeezeRelease }

  const basis = calcSMASeries(closes, length)
  const tr = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = (highs[i] ?? closes[i]) - (lows[i] ?? closes[i]); continue }
    const h = highs[i] ?? closes[i], l = lows[i] ?? closes[i], pc = closes[i - 1]
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  }
  const rangeKC = emaSeries(tr, length)
  for (let i = length - 1; i < n; i++) {
    if (basis[i] == null || rangeKC[i] == null) continue
    // Pine ta.stdev — population stdev over `length` bars
    let sum = 0, sum2 = 0, cnt = 0
    for (let j = i - length + 1; j <= i; j++) {
      if (closes[j] == null) continue
      sum += closes[j]
      sum2 += closes[j] * closes[j]
      cnt++
    }
    if (cnt < length) continue
    const mean = sum / length
    const stdev = Math.sqrt(Math.max(0, sum2 / length - mean * mean))
    const upperBB = basis[i] + bbMult * stdev
    const lowerBB = basis[i] - bbMult * stdev
    const upperKC = basis[i] + kcMult * rangeKC[i]
    const lowerKC = basis[i] - kcMult * rangeKC[i]
    squeezeOn[i] = lowerBB > lowerKC && upperBB < upperKC
    squeezeRelease[i] = !squeezeOn[i] && i > 0 && squeezeOn[i - 1]
  }
  return { squeezeOn, squeezeRelease }
}

export function calcLakshmiSuperCycle(highs, lows, closes, niftyClosesAligned = null, opts = {}) {
  const length = opts.length ?? 21
  const rsMALength = opts.rsMALength ?? 9
  const momLength = opts.momLength ?? 21
  const bbMult = opts.bbMult ?? 2.0
  const kcMult = opts.kcMult ?? 1.5
  const midcapAligned = opts.midcapCloses ?? null
  const smallcapAligned = opts.smallcapCloses ?? null
  const n = closes.length
  const empty = {
    cycle: new Array(n).fill(null),
    cycleUp: new Array(n).fill(false),
    cycleDown: new Array(n).fill(false),
    rsScaled: new Array(n).fill(null),
    momScaled: new Array(n).fill(null),
    maScaled: new Array(n).fill(null),
    squeezeOn: new Array(n).fill(false),
    squeezeRelease: new Array(n).fill(false),
    rsRating: new Array(n).fill(null),
    rsRatingNifty: new Array(n).fill(null),
    rsRatingMidcap: new Array(n).fill(null),
    rsRatingSmallcap: new Array(n).fill(null),
    rsAboveMA: new Array(n).fill(false),
    rsLine: new Array(n).fill(null),
  }
  if (n < length + 5) return empty

  const cycle = new Array(n).fill(null)
  const cycleSrc = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const hh = rollingHighest(highs, i, length)
    const ll = rollingLowest(lows, i, length)
    if (hh == null || ll == null || closes[i] == null) continue
    cycleSrc[i] = closes[i] - (hh + ll) / 2
  }
  for (let i = length - 1; i < n; i++) {
    cycle[i] = linRegAt(cycleSrc, i, length)
  }
  const cycleUp = new Array(n).fill(false)
  const cycleDown = new Array(n).fill(false)
  for (let i = 1; i < n; i++) {
    if (cycle[i] == null || cycle[i - 1] == null) continue
    cycleUp[i] = cycle[i] > cycle[i - 1]
    cycleDown[i] = cycle[i] < cycle[i - 1]
  }

  const { squeezeOn, squeezeRelease } = calcLakshmiSqueeze(highs, lows, closes, { length, bbMult, kcMult })

  const rsLine = new Array(n).fill(null)
  const niftyOk = Array.isArray(niftyClosesAligned) && niftyClosesAligned.length === n
  if (niftyOk) {
    for (let i = 0; i < n; i++) {
      const b = niftyClosesAligned[i]
      if (b && b !== 0 && closes[i] != null) rsLine[i] = (closes[i] / b) * 100
    }
  }

  const rsRatingNifty = calcRSRatingVsBench(closes, niftyClosesAligned)
  const rsRatingMidcap = calcRSRatingVsBench(closes, midcapAligned)
  const rsRatingSmallcap = calcRSRatingVsBench(closes, smallcapAligned)
  // Main / bgcolor source — Pine default "Main" uses Nifty benchmark rating
  const rsRating = rsRatingNifty

  // Do NOT zero-fill na into EMA — that dragged RS/Mom far from Pine
  const rsLineMA = emaSeriesSkipNull(rsLine, rsMALength)
  const momLine = emaSeriesSkipNull(rsLine, momLength)
  const rsAboveMA = new Array(n).fill(false)
  for (let i = 0; i < n; i++) {
    rsAboveMA[i] = rsLine[i] != null && rsLineMA[i] != null && rsLine[i] > rsLineMA[i]
  }

  const rsScaled = new Array(n).fill(null)
  const momScaled = new Array(n).fill(null)
  const maScaled = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const cHi = rollingHighest(cycle, i, 252)
    const cLo = rollingLowest(cycle, i, 252)
    const rHi = rollingHighest(rsLine, i, 252)
    const rLo = rollingLowest(rsLine, i, 252)
    if (cHi == null || cLo == null || rHi == null || rLo == null || rHi === rLo) continue
    const norm = (v) => (v - rLo) / (rHi - rLo)
    if (rsLine[i] != null) rsScaled[i] = cLo + norm(rsLine[i]) * (cHi - cLo)
    if (momLine[i] != null) momScaled[i] = cLo + norm(momLine[i]) * (cHi - cLo)
    if (rsLineMA[i] != null) maScaled[i] = cLo + norm(rsLineMA[i]) * (cHi - cLo)
  }

  return {
    cycle, cycleUp, cycleDown, rsScaled, momScaled, maScaled,
    squeezeOn, squeezeRelease, rsRating, rsRatingNifty, rsRatingMidcap, rsRatingSmallcap,
    rsAboveMA, rsLine,
  }
}
