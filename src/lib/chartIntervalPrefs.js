/** Our Chart interval favorites (TradingView-style resolution bar). */

export const CHART_INTERVAL_FAV_KEY = 'lakshmimata:chartIntervalFavorites:v1'

/** Internal barInterval keys, display order. */
export const ALL_INTERVAL_ENTRIES = [
  ['1', '1', '1 minute'],
  ['3', '3', '3 minutes'],
  ['5', '5', '5 minutes'],
  ['15', '15', '15 minutes'],
  ['30', '30', '30 minutes'],
  ['60', '1H', '1 hour'],
  ['D', '1D', 'Daily'],
  ['W', '1W', 'Weekly'],
  ['M', '1M', 'Monthly'],
  ['Y', '12M', 'Yearly'],
]

export const ALL_INTERVAL_KEYS = ALL_INTERVAL_ENTRIES.map(([k]) => k)

/** Default: keep today's full toolbar so existing users see no change. */
export const DEFAULT_INTERVAL_FAVORITES = [...ALL_INTERVAL_KEYS]

const INTRADAY_KEYS = new Set(['1', '3', '5', '15', '30', '60'])

export function normalizeIntervalFavorites(raw) {
  const list = Array.isArray(raw) ? raw.map(String) : []
  const seen = new Set()
  const out = []
  for (const k of list) {
    if (!ALL_INTERVAL_KEYS.includes(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out.length ? out : [...DEFAULT_INTERVAL_FAVORITES]
}

export function loadChartIntervalFavorites(_userId = null) {
  try {
    const raw = localStorage.getItem(CHART_INTERVAL_FAV_KEY)
    if (!raw) return [...DEFAULT_INTERVAL_FAVORITES]
    const parsed = JSON.parse(raw)
    return normalizeIntervalFavorites(parsed?.favorites ?? parsed)
  } catch {
    return [...DEFAULT_INTERVAL_FAVORITES]
  }
}

export function persistChartIntervalFavorites(favorites, _userId = null) {
  try {
    const favs = normalizeIntervalFavorites(favorites)
    localStorage.setItem(CHART_INTERVAL_FAV_KEY, JSON.stringify({ version: 1, favorites: favs }))
    return favs
  } catch {
    return normalizeIntervalFavorites(favorites)
  }
}

export function toggleIntervalFavorite(favorites, key) {
  const favs = normalizeIntervalFavorites(favorites)
  if (favs.includes(key)) {
    // Always keep at least one favorite
    if (favs.length <= 1) return favs
    return favs.filter(k => k !== key)
  }
  // Insert in canonical order
  const next = new Set([...favs, key])
  return ALL_INTERVAL_KEYS.filter(k => next.has(k))
}

/** Catalog rows available given index / intraday feature. */
export function availableIntervalEntries({ isIndex, intradayFeatureOn, intradayKeys }) {
  return ALL_INTERVAL_ENTRIES.filter(([key]) => {
    if (INTRADAY_KEYS.has(key)) {
      if (isIndex || !intradayFeatureOn) return false
      return (intradayKeys || []).includes(key)
    }
    return true
  })
}
