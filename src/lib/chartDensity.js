/**
 * Chart density — "clean" is the decluttered TradingView-like look (one thin
 * toolbar, tall price pane, tiny tables, no legend strip); "pro" is the older
 * everything-on-screen layout. Stored per device, like the other chart prefs.
 */

export const CHART_DENSITY_KEY = 'lakshmimata:chartDensity:v1'

export const CHART_DENSITY_MODES = ['clean', 'pro']

export function normalizeChartDensity(v) {
  return CHART_DENSITY_MODES.includes(v) ? v : 'clean'
}

export function loadChartDensity() {
  try {
    return normalizeChartDensity(localStorage.getItem(CHART_DENSITY_KEY))
  } catch {
    return 'clean'
  }
}

export function persistChartDensity(mode) {
  try {
    localStorage.setItem(CHART_DENSITY_KEY, normalizeChartDensity(mode))
  } catch { /* ignore */ }
}
