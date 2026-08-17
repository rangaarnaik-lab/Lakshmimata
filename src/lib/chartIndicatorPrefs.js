/** Per-user Our Chart indicator parameters (localStorage + optional Supabase sync). */

export const CHART_IND_PREF_KEY = 'lakshmimata:chartIndicatorPrefs:v1'

/** Field defs for the Indicators settings UI (per indicator id). */
export const INDICATOR_PARAM_FIELDS = {
  ma: [
    { key: 'ema9', label: 'EMA', min: 2, max: 50, step: 1 },
    { key: 'ma20', label: 'MA short', min: 2, max: 100, step: 1 },
    { key: 'ma50', label: 'MA mid', min: 5, max: 200, step: 1 },
    { key: 'ma200', label: 'MA long', min: 20, max: 400, step: 1 },
  ],
  rsi: [
    { key: 'length', label: 'Length', min: 2, max: 100, step: 1 },
    { key: 'overbought', label: 'Overbought', min: 50, max: 95, step: 1 },
    { key: 'oversold', label: 'Oversold', min: 5, max: 50, step: 1 },
  ],
  macd: [
    { key: 'fast', label: 'Fast', min: 2, max: 50, step: 1 },
    { key: 'slow', label: 'Slow', min: 5, max: 100, step: 1 },
    { key: 'signal', label: 'Signal', min: 2, max: 50, step: 1 },
  ],
  supercycle: [
    { key: 'length', label: 'Cycle length', min: 5, max: 100, step: 1 },
    { key: 'rsMALength', label: 'RS MA', min: 2, max: 50, step: 1 },
    { key: 'momLength', label: 'Momentum', min: 5, max: 100, step: 1 },
    { key: 'bbMult', label: 'BB mult', min: 0.5, max: 5, step: 0.1 },
    { key: 'kcMult', label: 'KC mult', min: 0.5, max: 5, step: 0.1 },
  ],
  buysell: [
    { key: 'atrPeriod', label: 'ATR period', min: 5, max: 50, step: 1 },
    { key: 'multiplier', label: 'ATR mult', min: 0.5, max: 10, step: 0.1 },
    { key: 'emaFast', label: 'EMA fast', min: 3, max: 30, step: 1 },
    { key: 'emaMid', label: 'EMA mid', min: 5, max: 50, step: 1 },
    { key: 'emaSlow', label: 'EMA slow', min: 10, max: 100, step: 1 },
    { key: 'emaLong', label: 'EMA long', min: 50, max: 300, step: 1 },
    { key: 'rsMin', label: 'RS min', min: 1, max: 99, step: 1 },
    { key: 'rsRise', label: 'RS rise (21)', min: 1, max: 40, step: 1 },
  ],
  barcolor: [
    { key: 'lookbackIV', label: 'IBV lookback', min: 5, max: 50, step: 1 },
    { key: 'lookbackPP', label: 'PPV lookback', min: 5, max: 50, step: 1 },
  ],
  bullsnort: [
    { key: 'volMa', label: 'Vol MA', min: 5, max: 50, step: 1 },
    { key: 'volMult', label: 'Vol ×', min: 1, max: 5, step: 0.1 },
    { key: 'closePct', label: 'Close % of range', min: 0.4, max: 0.95, step: 0.05 },
  ],
  forecast: [
    { key: 'sampleBars', label: 'Sample bars', min: 10, max: 60, step: 1 },
    { key: 'projPct', label: 'Project % of view', min: 0.05, max: 0.4, step: 0.01 },
  ],
}

const DEFAULT_ENABLED = {
  ma: true,
  guppy: false,
  sr: true,
  rsi: true, // oscillator pane on by default
  macd: false,
  supercycle: true, // Super Cycle oscillator under volume — on by default
  patterns: true,
  barcolor: true,
  bullsnort: true,
  buysell: true,
  forecast: false,
}

const DEFAULT_PARAMS = {
  ma: { ema9: 9, ma20: 20, ma50: 50, ma200: 200 },
  guppy: {},
  sr: {},
  rsi: { length: 14, overbought: 70, oversold: 30 },
  macd: { fast: 12, slow: 26, signal: 9 },
  supercycle: { length: 21, rsMALength: 9, momLength: 21, bbMult: 2.0, kcMult: 1.5 },
  patterns: {},
  barcolor: { lookbackIV: 10, lookbackPP: 10 },
  bullsnort: { volMa: 20, volMult: 2, closePct: 0.7 },
  buysell: {
    atrPeriod: 10, multiplier: 2.0,
    emaFast: 9, emaMid: 21, emaSlow: 50, emaLong: 200,
    rsMin: 50, rsRise: 10,
  },
  forecast: { sampleBars: 30, projPct: 0.15 },
}

export function defaultChartIndicatorPrefs() {
  const indicators = {}
  for (const id of Object.keys(DEFAULT_ENABLED)) {
    indicators[id] = {
      enabled: DEFAULT_ENABLED[id],
      params: { ...(DEFAULT_PARAMS[id] || {}) },
    }
  }
  return { version: 2, indicators }
}

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeChartIndicatorPrefs(raw) {
  const base = defaultChartIndicatorPrefs()
  if (!raw || typeof raw !== 'object') return base
  const src = raw.indicators && typeof raw.indicators === 'object' ? raw.indicators : raw
  for (const id of Object.keys(base.indicators)) {
    const row = src[id]
    if (!row || typeof row !== 'object') continue
    if (typeof row.enabled === 'boolean') base.indicators[id].enabled = row.enabled
    const params = row.params && typeof row.params === 'object' ? row.params : row
    const fields = INDICATOR_PARAM_FIELDS[id] || []
    for (const f of fields) {
      if (params[f.key] == null) continue
      base.indicators[id].params[f.key] = clampNum(
        params[f.key], f.min, f.max, base.indicators[id].params[f.key],
      )
    }
  }
  // v2: ensure Super Cycle + RSI oscillators are on for older saved prefs
  const prevVer = Number(raw.version) || 1
  if (prevVer < 2) {
    base.indicators.supercycle.enabled = true
    base.indicators.rsi.enabled = true
  }
  base.version = 2
  return base
}

function storageKey(userId) {
  return userId ? `${CHART_IND_PREF_KEY}:${userId}` : CHART_IND_PREF_KEY
}

export function loadChartIndicatorPrefs(userId) {
  try {
    const keyed = localStorage.getItem(storageKey(userId))
    const legacy = userId ? localStorage.getItem(CHART_IND_PREF_KEY) : null
    const raw = JSON.parse(keyed || legacy || 'null')
    return normalizeChartIndicatorPrefs(raw)
  } catch {
    return defaultChartIndicatorPrefs()
  }
}

export function persistChartIndicatorPrefsLocal(prefs, userId) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(normalizeChartIndicatorPrefs(prefs)))
  } catch { /* ignore */ }
}

export function setIndicatorEnabled(prefs, id, enabled) {
  const next = normalizeChartIndicatorPrefs(prefs)
  if (!next.indicators[id]) return next
  next.indicators[id] = { ...next.indicators[id], enabled: !!enabled }
  return next
}

export function setIndicatorParam(prefs, id, key, value) {
  const next = normalizeChartIndicatorPrefs(prefs)
  if (!next.indicators[id]) return next
  const fields = INDICATOR_PARAM_FIELDS[id] || []
  const f = fields.find(x => x.key === key)
  const fallback = next.indicators[id].params[key]
  const clamped = f
    ? clampNum(value, f.min, f.max, fallback)
    : (Number.isFinite(Number(value)) ? Number(value) : fallback)
  next.indicators[id] = {
    ...next.indicators[id],
    params: { ...next.indicators[id].params, [key]: clamped },
  }
  return next
}

export function resetIndicatorParams(prefs, id) {
  const next = normalizeChartIndicatorPrefs(prefs)
  if (!next.indicators[id]) return next
  next.indicators[id] = {
    ...next.indicators[id],
    params: { ...(DEFAULT_PARAMS[id] || {}) },
  }
  return next
}

export function indEnabled(prefs, id) {
  return normalizeChartIndicatorPrefs(prefs).indicators[id]?.enabled !== false
}

export function indParams(prefs, id) {
  return normalizeChartIndicatorPrefs(prefs).indicators[id]?.params || {}
}
