/**
 * Our Chart intraday (1/3/5/15/30/60) feature flags.
 *
 * Disable without deleting code:
 *  1. Railway: ENABLE_INTRADAY_1M=0  → stops writing + scan_meta.features.intraday_1m=false
 *     Frontend hides buttons on next scan_meta refresh (no Vercel redeploy).
 *  2. Vercel:  VITE_ENABLE_INTRADAY_CHART=0  → hard-hide UI even if server is ON.
 */
import { fetchScanMeta } from './db'

const ENV_RAW = (import.meta.env.VITE_ENABLE_INTRADAY_CHART ?? '').toString().trim().toLowerCase()

export const INTRADAY_INTERVAL_KEYS = ['1', '3', '5', '15', '30', '60']

/** Explicit frontend kill — overrides server when set to 0/false. */
export function isIntradayChartEnvEnabled() {
  if (ENV_RAW === '0' || ENV_RAW === 'false' || ENV_RAW === 'off' || ENV_RAW === 'no') return false
  return true
}

export function isIntradayChartEnabledFromMeta(scanMeta) {
  if (!isIntradayChartEnvEnabled()) return false
  const f = scanMeta?.features
  if (f && typeof f === 'object' && 'intraday_1m' in f) {
    return f.intraday_1m === true
  }
  // No flag published yet (old server / SQL not live) — show toolbar;
  // empty state handles missing bars.
  return true
}

/** Intervals to show in the toolbar (server can narrow the list). */
export function resolveIntradayIntervalKeys(scanMeta) {
  if (!isIntradayChartEnabledFromMeta(scanMeta)) return []
  const list = scanMeta?.features?.intraday_intervals
  if (Array.isArray(list) && list.length) {
    return list.map(String).filter(k => INTRADAY_INTERVAL_KEYS.includes(k))
  }
  return [...INTRADAY_INTERVAL_KEYS]
}

let _cache = { at: 0, enabled: false, intervals: INTRADAY_INTERVAL_KEYS }
const CACHE_MS = 45_000

/** Cached check for chart components (refreshes ~every 45s). */
export async function resolveIntradayChartEnabled() {
  if (!isIntradayChartEnvEnabled()) {
    _cache = { at: Date.now(), enabled: false, intervals: [] }
    return false
  }
  const now = Date.now()
  if (now - _cache.at < CACHE_MS) return _cache.enabled
  try {
    const meta = await fetchScanMeta()
    const enabled = isIntradayChartEnabledFromMeta(meta)
    _cache = {
      at: now,
      enabled,
      intervals: enabled ? resolveIntradayIntervalKeys(meta) : [],
    }
    return enabled
  } catch {
    return _cache.enabled
  }
}

export async function resolveIntradayIntervals() {
  await resolveIntradayChartEnabled()
  return _cache.intervals?.length ? _cache.intervals : []
}
