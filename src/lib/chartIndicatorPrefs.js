/** Per-user Our Chart indicator parameters (localStorage + optional Supabase sync). */

export const CHART_IND_PREF_KEY = 'lakshmimata:chartIndicatorPrefs:v1'

/**
 * Bull Snort thresholds — single source of truth for the standalone marker.
 * Mirrors the Lakshmi Volume pane's snortAvgLen / bullSnortMult / bullSnortDcr
 * and live_scan.detect_bull_snort, so the marker, the 🐗 icon, the screener
 * badge and the alert all agree.
 */
export const BULL_SNORT_PARAM_DEFAULTS = { volMa: 50, volMult: 3, closePct: 65 }

/** TradingView-style controls shared by every indicator. */
export const INDICATOR_VISIBILITY_FIELDS = [
  { key: 'visible', label: 'Visible on chart', type: 'bool', tab: 'visibility' },
]

/** Own indicator fields plus controls that every study supports. */
export function indicatorFields(id) {
  return [...(INDICATOR_PARAM_FIELDS[id] || []), ...INDICATOR_VISIBILITY_FIELDS]
}

/**
 * Field defs for the Indicators settings UI (per indicator id).
 * `tab` splits them into the TradingView-style Inputs / Style tabs.
 * Types: number (default), bool, color, select.
 */
export const INDICATOR_PARAM_FIELDS = {
  ma: [
    { key: 'ema9', label: 'Custom EMA 1', min: 2, max: 50, step: 1 },
    { key: 'ma20', label: 'Custom EMA 2', min: 2, max: 100, step: 1 },
    { key: 'ma50', label: 'EMA 50 Day / 10 Week', min: 5, max: 200, step: 1 },
    { key: 'ma150', label: 'EMA 150 Day / 30 Week', min: 20, max: 300, step: 1 },
    { key: 'ma200', label: 'EMA 200 Day / 40 Week', min: 20, max: 400, step: 1 },
    { key: 'rsPeriod', label: 'RS Period', min: 1, max: 252, step: 1 },
    { key: 'ema9Color', label: 'Custom EMA 1 color', type: 'color', tab: 'style' },
    { key: 'ma20Color', label: 'Custom EMA 2 color', type: 'color', tab: 'style' },
    { key: 'ma50Color', label: 'EMA 50 color', type: 'color', tab: 'style' },
    { key: 'ma150Color', label: 'EMA 150 color', type: 'color', tab: 'style' },
    { key: 'ma200Color', label: 'EMA 200 color', type: 'color', tab: 'style' },
    { key: 'showEma9', label: 'Plot Custom EMA 1', type: 'bool', tab: 'style' },
    { key: 'showMa20', label: 'Plot Custom EMA 2', type: 'bool', tab: 'style' },
    { key: 'showMa50', label: 'Plot EMA 50', type: 'bool', tab: 'style' },
    { key: 'showMa150', label: 'Plot EMA 150', type: 'bool', tab: 'style' },
    { key: 'showMa200', label: 'Plot EMA 200', type: 'bool', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
    { key: 'showScaleTags', label: 'Values on price scale', type: 'bool', tab: 'style' },
    { key: 'showRsBackground', label: 'Show Relative Strength (RS) Background', type: 'bool', tab: 'style' },
    { key: 'rsPositiveBgColor', label: 'RS > 0 background', type: 'color', tab: 'style' },
    { key: 'rsNegativeBgColor', label: 'RS < 0 background', type: 'color', tab: 'style' },
    { key: 'rsBackgroundOpacity', label: 'RS background opacity %', min: 2, max: 40, step: 1, tab: 'style' },
  ],
  guppy: [
    { key: 'showCloud', label: 'Cloud fill', type: 'bool', tab: 'style' },
    { key: 'cloudUpColor', label: 'Cloud up', type: 'color', tab: 'style' },
    { key: 'cloudDnColor', label: 'Cloud down', type: 'color', tab: 'style' },
    { key: 'cloudOpacity', label: 'Cloud opacity %', min: 5, max: 80, step: 1, tab: 'style' },
  ],
  squeeze: [
    { key: 'sqLength', label: 'BB / KC Length', min: 5, max: 100, step: 1 },
    { key: 'sqBbMult', label: 'BB StdDev Mult', min: 0.5, max: 5, step: 0.1 },
    { key: 'sqKcHigh', label: 'KC Mult — High Compression', min: 0.5, max: 5, step: 0.1 },
    { key: 'sqKcMult', label: 'KC Mult — Mid (classic squeeze)', min: 0.5, max: 5, step: 0.1 },
    { key: 'sqKcLow', label: 'KC Mult — Low Compression', min: 0.5, max: 5, step: 0.1 },
    { key: 'sqMomLength', label: 'Momentum Length', min: 5, max: 100, step: 1 },
    { key: 'sqHighColor', label: 'High compression dot', type: 'color', tab: 'style' },
    { key: 'sqOnColor', label: 'Mid compression dot', type: 'color', tab: 'style' },
    { key: 'sqLowColor', label: 'Low compression dot', type: 'color', tab: 'style' },
    { key: 'sqReleaseColor', label: 'Squeeze fired dot', type: 'color', tab: 'style' },
    { key: 'sqOffColor', label: 'No squeeze dot', type: 'color', tab: 'style' },
    { key: 'sqShowOff', label: 'Dot on every bar', type: 'bool', tab: 'style' },
    { key: 'sqDotSize', label: 'Dot size', min: 1, max: 5, step: 0.2, tab: 'style' },
  ],
  hilo52: [
    { key: 'hlWindowDays', label: 'Window (days)', min: 30, max: 1095, step: 5 },
    { key: 'hlOnlyFirst', label: 'Only the first bar of a run', type: 'bool' },
    { key: 'hlShowHigh', label: 'Flag new highs', type: 'bool', tab: 'style' },
    { key: 'hlShowLow', label: 'Flag new lows', type: 'bool', tab: 'style' },
    { key: 'hlHighColor', label: 'New high flag', type: 'color', tab: 'style' },
    { key: 'hlLowColor', label: 'New low flag', type: 'color', tab: 'style' },
    { key: 'hlSize', label: 'Flag size', min: 6, max: 18, step: 0.5, tab: 'style' },
    { key: 'hlShowLabels', label: 'Show 52WH / 52WL text', type: 'bool', tab: 'style' },
  ],
  sr: [
    { key: 'leftBars', label: 'Pivot Left Bars', min: 1, max: 30, step: 1 },
    { key: 'rightBars', label: 'Pivot Right Bars', min: 1, max: 30, step: 1 },
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
  bb: [
    { key: 'length', label: 'Length', min: 1, max: 200, step: 1 },
    { key: 'mult', label: 'StdDev', min: 0.001, max: 50, step: 0.1 },
    { key: 'offset', label: 'Offset', min: -100, max: 100, step: 1 },
    { key: 'basisColor', label: 'Basis', type: 'color', tab: 'style' },
    { key: 'bandColor', label: 'Upper / Lower', type: 'color', tab: 'style' },
    { key: 'fillColor', label: 'Background', type: 'color', tab: 'style' },
    { key: 'fillOpacity', label: 'Background opacity %', min: 0, max: 50, step: 1, tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 4, step: 0.1, tab: 'style' },
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
    { key: 'tableDays', label: 'Table days', min: 3, max: 30, step: 1, tab: 'style' },
    { key: 'rsColor', label: 'RS line', type: 'color', tab: 'style' },
    { key: 'momColor', label: 'Momentum line', type: 'color', tab: 'style' },
    { key: 'rsMaColor', label: 'RS MA line', type: 'color', tab: 'style' },
    {
      key: 'ratingBgSource', label: 'RS Rating Background Source', type: 'select', tab: 'style',
      options: [
        { value: 'main', label: 'Main' },
        { value: 'nifty', label: 'Nifty' },
        { value: 'smallcap', label: 'Smallcap' },
        { value: 'midcap', label: 'Midcap' },
      ],
    },
    { key: 'showRatingBg', label: 'Show RS Rating Background', type: 'bool', tab: 'style' },
    { key: 'ratingBgStrongColor', label: 'RS Rating > 70', type: 'color', tab: 'style' },
    { key: 'ratingBgAvgColor', label: 'RS Rating 50–70', type: 'color', tab: 'style' },
    { key: 'ratingBgWeakColor', label: 'RS Rating < 50', type: 'color', tab: 'style' },
    { key: 'ratingBgOpacity', label: 'RS Rating background opacity %', min: 2, max: 30, step: 1, tab: 'style' },
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
    { key: 'bullSnortMult', label: 'Bull Snort: Min Rel Vol (× Avg)', min: 2, max: 8, step: 0.5 },
    { key: 'bullSnortDcr', label: 'Min DCR %', min: 50, max: 90, step: 1 },
    { key: 'snortAvgLen', label: 'Rel Vol Avg Bars (e.g. 50d)', min: 10, max: 200, step: 1 },
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
    { key: 'bullSnortColor', label: 'Bull Snort Color', type: 'color', tab: 'style' },
    { key: 'barOpacity', label: 'Bar opacity %', min: 20, max: 100, step: 5, tab: 'style' },
  ],
  bullsnort: [
    { key: 'volMult', label: 'Bull Snort: Min Rel Vol (× Avg)', min: 1, max: 8, step: 0.1 },
    { key: 'closePct', label: 'Min DCR %', min: 50, max: 90, step: 1 },
    { key: 'volMa', label: 'Rel Vol Avg Bars (e.g. 50d)', min: 5, max: 200, step: 1 },
    { key: 'markerColor', label: 'Bull Snort Color', type: 'color', tab: 'style' },
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
    { key: 'autoDetect', label: 'Auto-detect from genuine lock days (Daily)', type: 'bool' },
    { key: 'ucColor', label: 'Upper circuit', type: 'color', tab: 'style' },
    { key: 'lcColor', label: 'Lower circuit', type: 'color', tab: 'style' },
    { key: 'lineWidth', label: 'Line width', min: 0.5, max: 3, step: 0.1, tab: 'style' },
    { key: 'showLabels', label: 'Show labels', type: 'bool', tab: 'style' },
  ],
}

const DEFAULT_ENABLED = {
  ma: true,
  guppy: true, // part of the Lakshmi Mata overlay — cloud on by default
  squeeze: true, // Lakshmi Mata squeeze dot row under the candles
  hilo52: true, // 52-week break flags on the candles
  sr: true,
  bb: false, // Pine default: Show Bollinger Bands is off; part of Lakshmi Mata settings.
  rsi: true, // oscillator pane on by default
  macd: false,
  supercycle: true, // Super Cycle oscillator under volume — on by default
  patterns: true,
  lakshmivol: true, // Lakshmi Mata Volume pane (IBV/PPV/HT/HY/…)
  barcolor: true,
  bullsnort: true,
  buysell: true,
  forecast: false,
  circuit: true, // Pine default: UC/LC circuit limits are part of Lakshmi Mata.
}

const DEFAULT_PARAMS = {
  ma: {
    // Exact Lakshmi_Mata.pine defaults: custom EMA 9/21 plus EMA 50/150/200.
    ema9: 9, ma20: 21, ma50: 50, ma150: 150, ma200: 200,
    rsPeriod: 65,
    ema9Color: '#ff9800', ma20Color: '#141414', ma50Color: '#0fe616',
    ma150Color: '#5b46e3', ma200Color: '#bd4dee',
    showEma9: true, showMa20: true, showMa50: true, showMa150: true, showMa200: true,
    lineWidth: 1.3, showScaleTags: true,
    showRsBackground: true,
    rsPositiveBgColor: '#b6f0ca', rsNegativeBgColor: '#f7bcbf', rsBackgroundOpacity: 25,
  },
  guppy: {
    showCloud: true, cloudUpColor: '#16a34a', cloudDnColor: '#ef4444', cloudOpacity: 20,
  },
  // Squeeze Pro (John Carter): one BB against three Keltner widths, so the
  // dot says how hard price is coiled instead of just on/off.
  squeeze: {
    sqLength: 20, sqBbMult: 2.0, sqKcHigh: 1.0, sqKcMult: 1.5, sqKcLow: 2.0, sqMomLength: 20,
    sqHighColor: '#ff9100', sqOnColor: '#ff1744', sqLowColor: '#b0bec5',
    sqReleaseColor: '#00e676', sqOffColor: '#5d606b',
    sqShowOff: true, sqDotSize: 2.2,
  },
  hilo52: {
    hlWindowDays: 365, hlOnlyFirst: true,
    hlShowHigh: true, hlShowLow: true,
    hlHighColor: '#2962ff', hlLowColor: '#ff6d00',
    hlSize: 11, hlShowLabels: false,
  },
  sr: {
    leftBars: 5, rightBars: 5,
    resColor: '#ef4444', supColor: '#22c55e',
    lineWidth: 3, lineStyle: 'dotted', showLabels: true,
  },
  bb: {
    length: 20, mult: 2.0, offset: 0,
    basisColor: '#ff6d00', bandColor: '#2962ff', fillColor: '#2196f3',
    fillOpacity: 5, lineWidth: 1,
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
    showTable: true, tablePlacement: 'below', tableOpacity: 100, tableDays: 10,
    ratingBgSource: 'main', showRatingBg: true,
    ratingBgStrongColor: '#00e676', ratingBgAvgColor: '#ffd600', ratingBgWeakColor: '#ff1744',
    ratingBgOpacity: 15,
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
    volUpColor: '#26a69a', volDownColor: '#ef5350', volMaColor: '#f0b90b',
    bullSnortColor: '#E040FB', barOpacity: 50,
  },
  barcolor: { lookbackIV: 10, lookbackPP: 10, barOpacity: 100 },
  bullsnort: { ...BULL_SNORT_PARAM_DEFAULTS, markerColor: '#E040FB', markerSize: 9 },
  buysell: {
    atrPeriod: 10, multiplier: 2.0,
    emaFast: 9, emaMid: 21, emaSlow: 50, emaLong: 200,
    rsMin: 50, rsRise: 10,
    buyColor: '#22c55e', sellColor: '#ef4444', labelSize: 8, showLabels: true,
  },
  forecast: { sampleBars: 30, projPct: 0.15, lineColor: '#f0b90b', lineWidth: 1.5, showLabel: true },
  circuit: { pct: 20, autoDetect: true, ucColor: '#26a69a', lcColor: '#ef5350', lineWidth: 0.9, showLabels: true },
}

export function defaultChartIndicatorPrefs() {
  const indicators = {}
  for (const id of Object.keys(DEFAULT_ENABLED)) {
    indicators[id] = {
      enabled: DEFAULT_ENABLED[id],
      params: {
        ...(DEFAULT_PARAMS[id] || {}),
        // Persist explicitly so cloud restore always has the Visibility toggle.
        visible: true,
      },
    }
  }
  return { version: 11, indicators }
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
    const fields = indicatorFields(id)
    for (const f of fields) {
      if (params[f.key] == null) continue
      base.indicators[id].params[f.key] =
        cleanParam(f, params[f.key], base.indicators[id].params[f.key])
    }
  }
  // v2: Super Cycle + RSI; v3: Lakshmi Volume on;
  // v4: Guppy joins the Lakshmi Mata price overlay, so its cloud comes on once.
  // v5: squeeze dots join the same overlay; v6: 52-week break flags too.
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
  if (prevVer < 5) {
    base.indicators.squeeze.enabled = true
  }
  if (prevVer < 6) {
    base.indicators.hilo52.enabled = true
  }
  // v7: Bull Snort shipped with looser thresholds (2x of a 20-bar average,
  // DCR 70) than the Lakshmi Volume pane it is supposed to mirror. Saved
  // params would otherwise keep overriding the corrected defaults and the
  // marker would disagree with the 🐗 icon, so re-seed them once.
  if (prevVer < 7) {
    base.indicators.bullsnort.params = {
      ...base.indicators.bullsnort.params,
      ...BULL_SNORT_PARAM_DEFAULTS,
    }
  }
  // v8: Min DCR is edited as a percent (65) like TradingView / Lakshmi Volume,
  // not a 0–1 fraction. Convert any leftover fractional closePct once.
  if (prevVer < 8) {
    const cp = Number(base.indicators.bullsnort.params.closePct)
    if (Number.isFinite(cp) && cp > 0 && cp <= 1) {
      base.indicators.bullsnort.params.closePct = Math.round(cp * 100)
    } else {
      base.indicators.bullsnort.params.closePct = BULL_SNORT_PARAM_DEFAULTS.closePct
    }
    if (base.indicators.lakshmivol.params.bullSnortColor == null) {
      base.indicators.lakshmivol.params.bullSnortColor = '#E040FB'
    }
  }
  // v9: the two Pine backgrounds are different calculations. Lakshmi Mata
  // uses 65-bar relative performance (RS >0 / <0); Super Cycle uses the
  // three RS Rating bands. Seed each study with its own controls once.
  if (prevVer < 9) {
    Object.assign(base.indicators.ma.params, {
      rsPeriod: 65,
      showRsBackground: true,
      rsPositiveBgColor: '#b6f0ca',
      rsNegativeBgColor: '#f7bcbf',
      rsBackgroundOpacity: 25,
    })
    Object.assign(base.indicators.supercycle.params, {
      ratingBgSource: 'main',
      showRatingBg: true,
      ratingBgStrongColor: '#00e676',
      ratingBgAvgColor: '#ffd600',
      ratingBgWeakColor: '#ff1744',
      ratingBgOpacity: 15,
    })
  }
  // v10: squeeze dots became John Carter Squeeze Pro — three Keltner widths
  // (high/mid/low compression) plus a momentum length. Saved prefs only have
  // the single 21/2.0/1.5 pair, so seed the tier controls once.
  if (prevVer < 10) {
    Object.assign(base.indicators.squeeze.params, {
      sqLength: 20,
      sqBbMult: 2.0,
      sqKcHigh: 1.0,
      sqKcMult: 1.5,
      sqKcLow: 2.0,
      sqMomLength: 20,
      sqHighColor: '#ff9100',
      sqLowColor: '#b0bec5',
    })
  }
  // v11: align the Lakshmi Mata parent with its Pine source. It owns the
  // 9/21/50/150/200 EMA set, S/R, Bollinger Bands, Buy/Sell and UC/LC.
  if (prevVer < 11) {
    Object.assign(base.indicators.ma.params, {
      ema9: 9, ma20: 21, ma50: 50, ma150: 150, ma200: 200,
      showEma9: true, showMa20: true, showMa50: true, showMa150: true, showMa200: true,
      ema9Color: '#ff9800', ma20Color: '#141414', ma50Color: '#0fe616',
      ma150Color: '#5b46e3', ma200Color: '#bd4dee',
    })
    Object.assign(base.indicators.sr.params, {
      leftBars: 5, rightBars: 5, lineWidth: 3, lineStyle: 'dotted',
    })
    base.indicators.sr.enabled = true
    base.indicators.buysell.enabled = true
    base.indicators.circuit.enabled = true
    base.indicators.circuit.params.autoDetect = true
  }
  base.version = 11
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
  const fields = indicatorFields(id)
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
