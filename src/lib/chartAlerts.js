/**
 * TradingView-style price alerts drawn on Our Chart.
 *
 * Alerts live in localStorage (per device, like drawings) and are evaluated
 * from two places: the open chart's live-price poll, and the app-wide scan
 * refresh — so an alert on RELIANCE still fires while you're looking at TCS.
 */

export const CHART_ALERTS_KEY = 'lakshmimata:chartAlerts:v1'

export const ALERT_CONDITIONS = [
  { id: 'crossing',     label: 'Crossing',      hint: 'Price touches the level from either side' },
  { id: 'crossingUp',   label: 'Crossing Up',   hint: 'Price rises through the level' },
  { id: 'crossingDown', label: 'Crossing Down', hint: 'Price falls through the level' },
  { id: 'above',        label: 'Greater than',  hint: 'Price is above the level' },
  { id: 'below',        label: 'Less than',     hint: 'Price is below the level' },
]

export const ALERT_TRIGGERS = [
  { id: 'once',     label: 'Only once',  hint: 'Alert stops after it fires' },
  { id: 'everyTime', label: 'Every time', hint: 'Keeps firing (max once every 5 min)' },
]

/** Level-state conditions can stay true for hours — don't spam them. */
const REPEAT_COOLDOWN_MS = 5 * 60 * 1000

export function newChartAlertId() {
  return `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeAlert(a) {
  if (!a || !a.id) return null
  const price = Number(a.price)
  if (!Number.isFinite(price) || price <= 0) return null
  const condition = ALERT_CONDITIONS.some(c => c.id === a.condition) ? a.condition : 'crossing'
  const trigger = ALERT_TRIGGERS.some(t => t.id === a.trigger) ? a.trigger : 'once'
  return {
    id: String(a.id),
    sym: String(a.sym || '').toUpperCase(),
    price,
    condition,
    trigger,
    note: typeof a.note === 'string' ? a.note.slice(0, 140) : '',
    active: a.active !== false,
    createdAt: Number(a.createdAt) || Date.now(),
    lastPrice: Number.isFinite(Number(a.lastPrice)) ? Number(a.lastPrice) : null,
    lastFiredAt: Number(a.lastFiredAt) || null,
    fireCount: Number(a.fireCount) || 0,
  }
}

export function loadChartAlerts() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHART_ALERTS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeAlert).filter(Boolean)
  } catch {
    return []
  }
}

export function saveChartAlerts(list) {
  try {
    localStorage.setItem(CHART_ALERTS_KEY, JSON.stringify((list || []).map(normalizeAlert).filter(Boolean)))
    // Chart and header both render the same list — keep them in step.
    window.dispatchEvent(new CustomEvent('lm-chart-alerts'))
  } catch {
    // quota / private mode — ignore
  }
  return list
}

export function chartAlertsFor(sym) {
  const s = String(sym || '').toUpperCase()
  return loadChartAlerts().filter(a => a.sym === s)
}

export function upsertChartAlert(alert) {
  const item = normalizeAlert(alert)
  if (!item) return loadChartAlerts()
  const list = loadChartAlerts()
  const i = list.findIndex(a => a.id === item.id)
  if (i >= 0) list[i] = { ...list[i], ...item }
  else list.unshift(item)
  saveChartAlerts(list)
  return list
}

export function removeChartAlert(id) {
  const list = loadChartAlerts().filter(a => a.id !== id)
  saveChartAlerts(list)
  return list
}

export function removeChartAlertsFor(sym) {
  const s = String(sym || '').toUpperCase()
  const list = loadChartAlerts().filter(a => a.sym !== s)
  saveChartAlerts(list)
  return list
}

export function conditionLabel(id) {
  return ALERT_CONDITIONS.find(c => c.id === id)?.label || 'Crossing'
}

/** Human summary used on the alert tag and in notifications. */
export function describeChartAlert(a) {
  if (!a) return ''
  const price = Number(a.price)
  const pretty = price >= 1000 ? price.toFixed(0) : price.toFixed(2)
  return `${a.sym} ${conditionLabel(a.condition).toLowerCase()} ${pretty}`
}

function shouldFire(alert, prev, cur) {
  const lvl = alert.price
  switch (alert.condition) {
    case 'crossingUp':   return prev != null && prev < lvl && cur >= lvl
    case 'crossingDown': return prev != null && prev > lvl && cur <= lvl
    case 'crossing':     return prev != null && ((prev < lvl && cur >= lvl) || (prev > lvl && cur <= lvl))
    case 'above':        return cur > lvl
    case 'below':        return cur < lvl
    default:             return false
  }
}

/**
 * Run every active alert against fresh prices.
 *
 * `priceBySym` is a plain object of UPPERCASE symbol → last traded price.
 * Symbols missing from it are left untouched, so a partial universe (index
 * filter, watchlist) never resets an alert's crossing state.
 *
 * Returns the alerts that fired; the stored list is updated in place.
 */
export function evaluateChartAlerts(priceBySym) {
  const list = loadChartAlerts()
  if (!list.length) return []
  const now = Date.now()
  const fired = []
  let changed = false

  const next = list.map(a => {
    const cur = Number(priceBySym?.[a.sym])
    if (!Number.isFinite(cur) || cur <= 0) return a
    const prev = a.lastPrice
    if (!a.active) {
      if (prev !== cur) { changed = true; return { ...a, lastPrice: cur } }
      return a
    }
    // First price we ever see for this alert only seeds the crossing state,
    // otherwise creating an alert below the current price fires instantly.
    if (prev == null) { changed = true; return { ...a, lastPrice: cur } }

    const cooling = a.trigger === 'everyTime'
      && a.lastFiredAt
      && (now - a.lastFiredAt) < REPEAT_COOLDOWN_MS
    if (cooling || !shouldFire(a, prev, cur)) {
      if (prev !== cur) { changed = true; return { ...a, lastPrice: cur } }
      return a
    }

    changed = true
    const updated = {
      ...a,
      lastPrice: cur,
      lastFiredAt: now,
      fireCount: (a.fireCount || 0) + 1,
      active: a.trigger === 'once' ? false : true,
    }
    fired.push({ ...updated, firedPrice: cur })
    return updated
  })

  if (changed) saveChartAlerts(next)
  return fired
}
