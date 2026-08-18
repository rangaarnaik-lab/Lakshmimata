/** Per-user Our Chart indicator parameters (localStorage + optional Supabase sync). */

export const CHART_IND_PREF_KEY = 'lakshmimata:chartIndicatorPrefs:v1'

/**
 * Field defs for the Indicators settings UI (per indicator id).
 * `tab` splits them into the TradingView-style Inputs / Style tabs.
 * Types: number (default), bool, color, select.
 */
export const INDICATOR_PARAM_FIELDS = {
  ma: [
    { key: 'ema9', label: 'EMA', min: 2, max: 50, step: 1 },
    { key: 'ma20', label: 'MA short', min: 2, max: 100, step: 1 },
    { key: 'ma50', label: 'MA mid', min: 5, max: 200, step: 1 },
    { key: 'ma200', label: 'MA long', min: 20, max: 400, step: 1 },
    { key: 'ema9Color', label: 'EMA color', type: 'color', tab: 'style' },
    { key: 'ma20Color', label: 'MA short color', type: 'color', tab: 'style' },
    { key: 'ma50Color', label: 'MA mid color', type: 'color', tab: 'style' },
    { key: 'ma200Color', label: 'MA long color', type: 'color', tab: 'style' },
    { key: 'showEma9', label: 'Plot EMA', type: 'bool', tab: 'style' },
    { key: 'showMa20', label: 'Plot MA short', type: 'bool', tab: 'style' },
    { key: 'showMa50', label: 'Plot MA mid', type: 'bool', tab: 'style' },
    { key: 'showMa200', label: 'Plot MA long', type: 'bool', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
    { key: 'showScaleTags', label: 'Values on price scale', type: 'bool', tab: 'style' },
  ],
  guppy: [
    { key: 'ribbonOpacity', label: 'Ribbon opacity %', min: 20, max: 100, step: 5 },
    { key: 'shortColor', label: 'Short ribbon', type: 'color', tab: 'style' },
    { key: 'longColor', label: 'Long ribbon', type: 'color', tab: 'style' },
    { key: 'showCloud', label: 'Cloud fill', type: 'bool', tab: 'style' },
    { key: 'cloudUpColor', label: 'Cloud up', type: 'color', tab: 'style' },
    { key: 'cloudDnColor', label: 'Cloud down', type: 'color', tab: 'style' },
    { key: 'cloudOpacity', label: 'Cloud opacity %', min: 5, max: 80, step: 1, tab: 'style' },
    { key: 'fastColor', label: 'EMA fast line', type: 'color', tab: 'style' },
    { key: 'slowColor', label: 'EMA slow line', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Ribbon width', min: 0.4, max: 3, step: 0.1, tab: 'style' },
    { key: 'showHighlight', label: 'Highlight cross EMAs', type: 'bool', tab: 'style' },
  ],
  sr: [
    { key: 'resColor', label: 'Resistance', type: 'color', tab: 'style' },
    { key: 'supColor', label: 'Support', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 3, step: 0.1, tab: 'style' },
    {
      key: 'lineStyle', label: 'Line style', type: 'select', tab: 'style',
      options: [
        { value: 'dashed', label: 'Dashed' },
        { value: 'solid', label: 'Solid' },
        { value: 'dotted', label: 'Dotted' },
      ],
    },
    { key: 'showLabels', label: 'Show labels', type: 'bool', tab: 'style' },
  ],
  patterns: [
    { key: 'insideColor', label: 'Inside bar dot', type: 'color', tab: 'style' },
    { key: 'cupColor', label: 'Cup & Handle', type: 'color', tab: 'style' },
    { key: 'vcpColor', label: 'VCP connectors', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Outline width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
    { key: 'showLabels', label: 'Show labels', type: 'bool', tab: 'style' },
  ],
  rsi: [
    { key: 'length', label: 'Length', min: 2, max: 100, step: 1 },
    { key: 'overbought', label: 'Overbought', min: 50, max: 95, step: 1 },
    { key: 'oversold', label: 'Oversold', min: 5, max: 50, step: 1 },
    { key: 'lineColor', label: 'Line color', type: 'color', tab: 'style' },
    { key: 'bandColor', label: 'Band color', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
    { key: 'showBands', label: 'OB/OS bands', type: 'bool', tab: 'style' },
  ],
  macd: [
    { key: 'fast', label: 'Fast', min: 2, max: 50, step: 1 },
    { key: 'slow', label: 'Slow', min: 5, max: 100, step: 1 },
    { key: 'signal', label: 'Signal', min: 2, max: 50, step: 1 },
    { key: 'macdColor', label: 'MACD color', type: 'color', tab: 'style' },
    { key: 'signalColor', label: 'Signal color', type: 'color', tab: 'style' },
    { key: 'histUpColor', label: 'Histogram up', type: 'color', tab: 'style' },
    { key: 'histDnColor', label: 'Histogram down', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
  ],
  supercycle: [
    { key: 'length', label: 'Length', min: 5, max: 100, step: 1 },
    { key: 'rsMALength', label: 'Smooth A', min: 2, max: 50, step: 1 },
    { key: 'momLength', label: 'Smooth B', min: 5, max: 100, step: 1 },
    { key: 'bbMult', label: 'Band A', min: 0.5, max: 5, step: 0.1 },
    { key: 'kcMult', label: 'Band B', min: 0.5, max: 5, step: 0.1 },
    { key: 'showTable', label: 'RS history table', type: 'bool', tab: 'style' },
    {
      key: 'tablePlacement', label: 'Table placement', type: 'select', tab: 'style',
      options: [
        { value: 'reserve', label: 'Above the pane' },
        { value: 'below', label: 'Below the pane' },
        { value: 'overlay', label: 'Overlap the pane' },
      ],
    },
    { key: 'tableOpacity', label: 'Table opacity %', min: 30, max: 100, step: 5, tab: 'style' },
    { key: 'tableDays', label: 'Table columns', min: 3, max: 10, step: 1, tab: 'style' },
    { key: 'showStatus', label: 'Status card', type: 'bool', tab: 'style' },
    { key: 'rsColor', label: 'RS line', type: 'color', tab: 'style' },
    { key: 'momColor', label: 'Momentum line', type: 'color', tab: 'style' },
    { key: 'rsMaColor', label: 'RS MA line', type: 'color', tab: 'style' },
    { key: 'showRsBg', label: 'RS background (price pane)', type: 'bool', tab: 'style' },
    { key: 'rsBgStrongColor', label: 'RS bg strong', type: 'color', tab: 'style' },
    { key: 'rsBgAvgColor', label: 'RS bg average', type: 'color', tab: 'style' },
    { key: 'rsBgWeakColor', label: 'RS bg weak', type: 'color', tab: 'style' },
    { key: 'rsBgOpacity', label: 'RS bg opacity %', min: 2, max: 30, step: 1, tab: 'style' },
    { key: 'barOpacity', label: 'Histogram opacity %', min: 30, max: 100, step: 5, tab: 'style' },
  ],
  buysell: [
    { key: 'atrPeriod', label: 'Period A', min: 5, max: 50, step: 1 },
    { key: 'multiplier', label: 'Mult', min: 0.5, max: 10, step: 0.1 },
    { key: 'emaFast', label: 'Fast', min: 3, max: 30, step: 1 },
    { key: 'emaMid', label: 'Mid', min: 5, max: 50, step: 1 },
    { key: 'emaSlow', label: 'Slow', min: 10, max: 100, step: 1 },
    { key: 'emaLong', label: 'Long', min: 50, max: 300, step: 1 },
    { key: 'rsMin', label: 'Gate A', min: 1, max: 99, step: 1 },
    { key: 'rsRise', label: 'Gate B', min: 1, max: 40, step: 1 },
    { key: 'buyColor', label: 'Buy label', type: 'color', tab: 'style' },
    { key: 'sellColor', label: 'Sell label', type: 'color', tab: 'style' },
    { key: 'labelSize', label: 'Label size', min: 6, max: 14, step: 0.5, tab: 'style' },
    { key: 'showLabels', label: 'Show Buy/Sell text', type: 'bool', tab: 'style' },
  ],
  barcolor: [
    { key: 'lookbackIV', label: 'Period A', min: 5, max: 50, step: 1 },
    { key: 'lookbackPP', label: 'Period B', min: 5, max: 50, step: 1 },
    { key: 'barOpacity', label: 'Candle opacity %', min: 40, max: 100, step: 5, tab: 'style' },
  ],
  lakshmivol: [
    { key: 'lookbackIV', label: 'Period A', min: 5, max: 100, step: 1 },
    { key: 'lookbackPP', label: 'Period B', min: 5, max: 100, step: 1 },
    { key: 'maLength', label: 'MA', min: 5, max: 100, step: 1 },
    { key: 'lookbackAvg', label: 'Avg bars', min: 10, max: 200, step: 1 },
    { key: 'lookbackUD', label: 'Ratio bars', min: 10, max: 200, step: 1 },
    { key: 'ivMult', label: 'Mult A', min: 1.2, max: 6, step: 0.1 },
    { key: 'ivDcr', label: 'Floor A', min: 30, max: 90, step: 1 },
    { key: 'lowVolMult', label: 'Quiet mult', min: 0.1, max: 1, step: 0.05 },
    { key: 'bullSnortMult', label: 'Snort mult', min: 2, max: 8, step: 0.5 },
    { key: 'bullSnortDcr', label: 'Snort floor', min: 50, max: 90, step: 1 },
    { key: 'snortAvgLen', label: 'Snort avg bars', min: 10, max: 200, step: 1 },
    { key: 'relVolHigh', label: 'Rel.Vol high %', min: 100, max: 500, step: 10 },
    { key: 'showTable', label: 'Metrics table', type: 'bool', tab: 'style' },
    {
      key: 'tablePlacement', label: 'Table placement', type: 'select', tab: 'style',
      options: [
        { value: 'reserve', label: 'Above the pane' },
        { value: 'below', label: 'Below the pane' },
        { value: 'overlay', label: 'Overlap the pane' },
      ],
    },
    { key: 'tableOpacity', label: 'Table opacity %', min: 30, max: 100, step: 5, tab: 'style' },
    { key: 'showMarkers', label: 'Signal icons', type: 'bool', tab: 'style' },
    { key: 'showVolMA', label: 'Volume MA line', type: 'bool', tab: 'style' },
    { key: 'volUpColor', label: 'Volume up', type: 'color', tab: 'style' },
    { key: 'volDownColor', label: 'Volume down', type: 'color', tab: 'style' },
    { key: 'volMaColor', label: 'Volume MA', type: 'color', tab: 'style' },
    { key: 'barOpacity', label: 'Bar opacity %', min: 20, max: 100, step: 5, tab: 'style' },
  ],
  bullsnort: [
    { key: 'volMa', label: 'MA', min: 5, max: 50, step: 1 },
    { key: 'volMult', label: 'Mult', min: 1, max: 5, step: 0.1 },
    { key: 'closePct', label: 'Floor', min: 0.4, max: 0.95, step: 0.05 },
    { key: 'markerColor', label: 'Marker color', type: 'color', tab: 'style' },
    { key: 'markerSize', label: 'Marker size', min: 4, max: 16, step: 0.5, tab: 'style' },
  ],
  forecast: [
    { key: 'sampleBars', label: 'Bars', min: 10, max: 60, step: 1 },
    { key: 'projPct', label: 'Reach', min: 0.05, max: 0.4, step: 0.01 },
    { key: 'lineColor', label: 'Line color', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
    { key: 'showLabel', label: 'Show label', type: 'bool', tab: 'style' },
  ],
  circuit: [
    { key: 'pct', label: 'Band %', min: 2, max: 20, step: 1 },
    { key: 'ucColor', label: 'Upper circuit', type: 'color', tab: 'style' },
    { key: 'lcColor', label: 'Lower circuit', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 3, step: 0.1, tab: 'style' },
    { key: 'showLabels', label: 'Show labels', type: 'bool', tab: 'style' },
  ],
}

const DEFAULT_ENABLED = {
  ma: true,
  guppy: true, // part of the Lakshmi Mata overlay — cloud on by default
  sr: true,
  rsi: true, // oscillator pane on by default
  macd: false,
  supercycle: true, // Super Cycle oscillator under volume — on by default
  patterns: true,
  lakshmivol: true, // Lakshmi Mata Volume pane (IBV/PPV/HT/HY/…)
  barcolor: true,
  bullsnort: true,
  buysell: true,
  forecast: false,
  circuit: false, // UC/LC circuit band around the previous close
}

const DEFAULT_PARAMS = {
  ma: {
    ema9: 9, ma20: 20, ma50: 50, ma200: 200,
    ema9Color: '#26c6da', ma20Color: '#42a5f5', ma50Color: '#ffca28', ma200Color: '#ab47bc',
    showEma9: true, showMa20: true, showMa50: true, showMa200: true,
    lineWidth: 1.3, showScaleTags: true,
  },
  guppy: {
    ribbonOpacity: 85, shortColor: '#2dd4bf', longColor: '#f472b6',
    showCloud: true, cloudUpColor: '#16a34a', cloudDnColor: '#ef4444', cloudOpacity: 20,
    fastColor: '#26c6da', slowColor: '#ab47bc', lineWidth: 0.9, showHighlight: true,
  },
  sr: {
    resColor: '#ef4444', supColor: '#22c55e',
    lineWidth: 1, lineStyle: 'dashed', showLabels: true,
  },
  rsi: {
    length: 14, overbought: 70, oversold: 30,
    lineColor: '#b388ff', bandColor: '#ef4444', lineWidth: 1.4, showBands: true,
  },
  macd: {
    fast: 12, slow: 26, signal: 9,
    macdColor: '#42a5f5', signalColor: '#ff9100',
    histUpColor: '#22c55e', histDnColor: '#ef4444', lineWidth: 1.3,
  },
  supercycle: {
    length: 21, rsMALength: 9, momLength: 21, bbMult: 2.0, kcMult: 1.5,
    showTable: true, tablePlacement: 'below', tableOpacity: 100, tableDays: 10, showStatus: true,
    showRsBg: true, rsBgStrongColor: '#00e676', rsBgAvgColor: '#ffd600', rsBgWeakColor: '#ff1744', rsBgOpacity: 8,
    rsColor: '#29b6f6', momColor: '#26c6da', rsMaColor: '#ffd600', barOpacity: 92,
  },
  patterns: {
    insideColor: '#26c6da', cupColor: '#ab47bc', vcpColor: '#ff9100',
    lineWidth: 2, showLabels: true,
  },
  lakshmivol: {
    lookbackIV: 10, lookbackPP: 10, maLength: 10,
    lookbackAvg: 50, lookbackUD: 50,
    ivMult: 2, ivDcr: 50, lowVolMult: 0.5,
    bullSnortMult: 3, bullSnortDcr: 65, snortAvgLen: 50,
    relVolHigh: 200,
    showTable: true, tablePlacement: 'reserve', tableOpacity: 100,
    showMarkers: true, showVolMA: true,
    volUpColor: '#26a69a', volDownColor: '#ef5350', volMaColor: '#f0b90b', barOpacity: 50,
  },
  barcolor: { lookbackIV: 10, lookbackPP: 10, barOpacity: 100 },
  bullsnort: { volMa: 20, volMult: 2, closePct: 0.7, markerColor: '#f59e0b', markerSize: 9 },
  buysell: {
    atrPeriod: 10, multiplier: 2.0,
    emaFast: 9, emaMid: 21, emaSlow: 50, emaLong: 200,
    rsMin: 50, rsRise: 10,
    buyColor: '#22c55e', sellColor: '#ef4444', labelSize: 8, showLabels: true,
  },
  forecast: { sampleBars: 30, projPct: 0.15, lineColor: '#f0b90b', lineWidth: 1.5, showLabel: true },
  circuit: { pct: 20, ucColor: '#26a69a', lcColor: '#ef5350', lineWidth: 0.9, showLabels: true },
}

export function defaultChartIndicatorPrefs() {
  const indicators = {}
  for (const id of Object.keys(DEFAULT_ENABLED)) {
    indicators[id] = {
      enabled: DEFAULT_ENABLED[id],
      params: { ...(DEFAULT_PARAMS[id] || {}) },
    }
  }
  return { version: 4, indicators }
}

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function cleanColor(v, fallback) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback
}

function cleanSelect(v, options, fallback) {
  return (options || []).some(o => o.value === v) ? v : fallback
}

/** Coerce one param value to whatever its field def allows. */
function cleanParam(field, value, fallback) {
  if (!field) return Number.isFinite(Number(value)) ? Number(value) : fallback
  if (field.type === 'bool') return !!value
  if (field.type === 'color') return cleanColor(value, fallback)
  if (field.type === 'select') return cleanSelect(value, field.options, fallback)
  return clampNum(value, field.min, field.max, fallback)
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
      base.indicators[id].params[f.key] =
        cleanParam(f, params[f.key], base.indicators[id].params[f.key])
    }
  }
  // v2: Super Cycle + RSI; v3: Lakshmi Volume on;
  // v4: Guppy joins the Lakshmi Mata price overlay, so its cloud comes on once.
  const prevVer = Number(raw.version) || 1
  if (prevVer < 2) {
    base.indicators.supercycle.enabled = true
    base.indicators.rsi.enabled = true
  }
  if (prevVer < 3) {
    base.indicators.lakshmivol.enabled = true
  }
  if (prevVer < 4) {
    base.indicators.guppy.enabled = true
  }
  base.version = 4
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
  next.indicators[id] = {
    ...next.indicators[id],
    params: { ...next.indicators[id].params, [key]: cleanParam(f, value, fallback) },
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
