/** Our Chart view prefs: series type and price scale mode (per device). */

export const CHART_VIEW_KEY = 'lakshmimata:chartView:v1'

export const SERIES_TYPES = [
  { id: 'candle',   label: 'Candles',       hint: 'Hollow up / filled down' },
  { id: 'hollow',   label: 'Hollow candles', hint: 'Outline only' },
  { id: 'bar',      label: 'Bars',          hint: 'OHLC bars' },
  { id: 'heikin',   label: 'Heikin Ashi',   hint: 'Smoothed candles' },
  { id: 'line',     label: 'Line',          hint: 'Close only' },
  { id: 'area',     label: 'Area',          hint: 'Close with fill' },
  { id: 'baseline', label: 'Baseline',      hint: 'Above / below first bar' },
]

/** Types that draw from OHLC (stocks have real OHLC; indices synthesize it from closes). */
export const OHLC_SERIES = ['candle', 'hollow', 'bar', 'heikin']
/** Types drawn from the close series alone. */
export const CLOSE_SERIES = ['line', 'area', 'baseline']

export const PRICE_SCALES = [
  { id: 'normal',  label: 'Regular',  hint: 'Linear price axis' },
  { id: 'log',     label: 'Log',      hint: 'Equal % moves look equal' },
  { id: 'percent', label: 'Percent',  hint: '% change from left edge' },
]

export function defaultChartView() {
  return { style: 'candle', scale: 'normal' }
}

export function normalizeChartView(raw) {
  const def = defaultChartView()
  const style = SERIES_TYPES.some(s => s.id === raw?.style) ? raw.style : def.style
  const scale = PRICE_SCALES.some(s => s.id === raw?.scale) ? raw.scale : def.scale
  return { style, scale }
}

export function loadChartView() {
  try {
    return normalizeChartView(JSON.parse(localStorage.getItem(CHART_VIEW_KEY) || 'null'))
  } catch {
    return defaultChartView()
  }
}

export function persistChartView(view) {
  try {
    localStorage.setItem(CHART_VIEW_KEY, JSON.stringify(normalizeChartView(view)))
  } catch { /* ignore */ }
}

/**
 * Heikin Ashi from raw OHLC.
 * haClose = (o+h+l+c)/4, haOpen = prev midpoint, haHigh/Low include haOpen/haClose.
 */
export function heikinAshi(opens, highs, lows, closes) {
  const n = closes?.length || 0
  const o = new Array(n).fill(null)
  const h = new Array(n).fill(null)
  const l = new Array(n).fill(null)
  const c = new Array(n).fill(null)
  let prevOpen = null, prevClose = null
  for (let i = 0; i < n; i++) {
    const ro = opens?.[i], rh = highs?.[i], rl = lows?.[i], rc = closes?.[i]
    if (ro == null || rh == null || rl == null || rc == null) continue
    const haClose = (ro + rh + rl + rc) / 4
    const haOpen = prevOpen == null || prevClose == null ? (ro + rc) / 2 : (prevOpen + prevClose) / 2
    o[i] = haOpen
    c[i] = haClose
    h[i] = Math.max(rh, haOpen, haClose)
    l[i] = Math.min(rl, haOpen, haClose)
    prevOpen = haOpen
    prevClose = haClose
  }
  return { open: o, high: h, low: l, close: c }
}
