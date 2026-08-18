/**
 * Our Chart layout: pane heights, pane order, price-scale width and saved presets.
 *
 * Heights are stored as scale factors (1 = product default) per pane, so the
 * built-in responsive split still drives the base layout and a drag only
 * biases it. Factors are renormalised at render time so they never drift.
 */

export const CHART_LAYOUT_KEY = 'lakshmimata:chartLayout:v1'
export const CHART_LAYOUT_PRESETS_KEY = 'lakshmimata:chartLayoutPresets:v1'
/** Pre-presets key — read once so early adopters keep their dragged heights. */
export const CHART_PANE_SIZE_KEY = 'lakshmimata:chartPaneSizes:v1'

export const PANE_KEYS = ['price', 'vol', 'sc', 'rsi', 'macd']

export const PANE_LABELS = {
  price: 'Price',
  vol: 'Volume',
  sc: 'Super Cycle',
  rsi: 'RSI',
  macd: 'MACD',
}

/** Smallest usable pane height in px — drags stop here. */
export const PANE_MIN_PX = {
  price: 90,
  vol: 48,
  sc: 44,
  rsi: 44,
  macd: 44,
}

export const AXIS_W_MIN = 36
export const AXIS_W_MAX = 160

export function defaultPaneScale() {
  return { price: 1, vol: 1, sc: 1, rsi: 1, macd: 1 }
}

export function defaultPaneOrder() {
  return [...PANE_KEYS]
}

export function normalizePaneScale(raw) {
  const out = defaultPaneScale()
  const src = raw && typeof raw === 'object' ? (raw.panes || raw) : null
  if (!src) return out
  for (const k of PANE_KEYS) {
    const n = Number(src[k])
    if (Number.isFinite(n)) out[k] = Math.min(6, Math.max(0.2, n))
  }
  return out
}

/** Any order array → all five keys exactly once, unknown/missing keys appended. */
export function normalizePaneOrder(raw) {
  const seen = new Set()
  const out = []
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (PANE_KEYS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k) }
    }
  }
  for (const k of PANE_KEYS) if (!seen.has(k)) out.push(k)
  return out
}

export function normalizeAxisW(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.min(AXIS_W_MAX, Math.max(AXIS_W_MIN, Math.round(n)))
}

export function normalizeChartLayout(raw) {
  return {
    panes: normalizePaneScale(raw),
    order: normalizePaneOrder(raw?.order),
    axisW: normalizeAxisW(raw?.axisW),
  }
}

export function defaultChartLayout() {
  return { panes: defaultPaneScale(), order: defaultPaneOrder(), axisW: null }
}

export function loadChartLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHART_LAYOUT_KEY) || 'null')
    if (raw) return normalizeChartLayout(raw)
    const legacy = JSON.parse(localStorage.getItem(CHART_PANE_SIZE_KEY) || 'null')
    if (legacy) return normalizeChartLayout(legacy)
  } catch { /* ignore */ }
  return defaultChartLayout()
}

export function persistChartLayout(layout) {
  try {
    localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify({
      version: 1,
      ...normalizeChartLayout(layout),
    }))
  } catch { /* ignore */ }
}

export function isChartLayoutDefault(layout) {
  const l = normalizeChartLayout(layout)
  return PANE_KEYS.every(k => Math.abs(l.panes[k] - 1) < 0.005)
    && PANE_KEYS.every((k, i) => l.order[i] === k)
    && l.axisW == null
}

/** Order filtered to the panes currently switched on (price + volume always on). */
export function visiblePaneOrder(order, { sc = false, rsi = false, macd = false } = {}) {
  const on = { price: true, vol: true, sc, rsi, macd }
  return normalizePaneOrder(order).filter(k => on[k])
}

/** Move a pane one slot up/down within the currently visible panes. */
export function movePane(order, key, dir, visibility) {
  const full = normalizePaneOrder(order)
  const vis = visiblePaneOrder(full, visibility)
  const at = vis.indexOf(key)
  const to = at + (dir < 0 ? -1 : 1)
  if (at < 0 || to < 0 || to >= vis.length) return full
  const swapWith = vis[to]
  const iA = full.indexOf(key)
  const iB = full.indexOf(swapWith)
  const out = [...full]
  out[iA] = swapWith
  out[iB] = key
  return out
}

// ── Named layout presets ──────────────────────────────────────────────

export function normalizePreset(raw) {
  const name = String(raw?.name || '').trim().slice(0, 40)
  if (!name) return null
  return {
    id: String(raw?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    name,
    ...normalizeChartLayout(raw),
  }
}

export function loadLayoutPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHART_LAYOUT_PRESETS_KEY) || 'null')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizePreset).filter(Boolean).slice(0, 20)
  } catch {
    return []
  }
}

export function persistLayoutPresets(list) {
  try {
    const clean = (Array.isArray(list) ? list : []).map(normalizePreset).filter(Boolean).slice(0, 20)
    localStorage.setItem(CHART_LAYOUT_PRESETS_KEY, JSON.stringify(clean))
    return clean
  } catch {
    return Array.isArray(list) ? list : []
  }
}

/** Add or overwrite (same name, case-insensitive) a preset from a layout. */
export function upsertPreset(list, name, layout) {
  const preset = normalizePreset({ name, ...normalizeChartLayout(layout) })
  if (!preset) return Array.isArray(list) ? list : []
  const rest = (Array.isArray(list) ? list : [])
    .filter(p => String(p?.name || '').toLowerCase() !== preset.name.toLowerCase())
  return [preset, ...rest].slice(0, 20)
}

export function removePreset(list, id) {
  return (Array.isArray(list) ? list : []).filter(p => p?.id !== id)
}
