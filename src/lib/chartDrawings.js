/** Persist Our Chart drawings in localStorage (per symbol + bar interval). */

const STORAGE_PREFIX = 'lakshmimata:chartDrawings:v1:'

export const DRAW_TOOLS = [
  { id: 'pan', label: 'Pan', title: 'Pan / zoom (default)' },
  { id: 'trend', label: 'Trend', title: 'Trend line (2 clicks)' },
  { id: 'ray', label: 'Ray', title: 'Ray — extends right (2 clicks)' },
  { id: 'hline', label: 'H-Line', title: 'Horizontal line (1 click)' },
  { id: 'vline', label: 'V-Line', title: 'Vertical line (1 click)' },
  { id: 'rect', label: 'Rect', title: 'Rectangle (2 clicks)' },
  // Ruler is transient: it measures, it is never saved as a drawing.
  { id: 'measure', label: 'Ruler', title: 'Measure price, % and bars (2 clicks · M)' },
]

function storageKey(sym, barInterval) {
  return `${STORAGE_PREFIX}${sym || 'UNKNOWN'}:${barInterval || 'D'}`
}

export function loadChartDrawings(sym, barInterval) {
  try {
    const raw = localStorage.getItem(storageKey(sym, barInterval))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(d => d && d.id && d.type) : []
  } catch {
    return []
  }
}

export function saveChartDrawings(sym, barInterval, drawings) {
  try {
    localStorage.setItem(storageKey(sym, barInterval), JSON.stringify(drawings || []))
  } catch {
    // quota / private mode — ignore
  }
}

export function newDrawingId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Default stroke colors cycling for new drawings */
export const DRAW_COLORS = ['#2962ff', '#ff6d00', '#e040fb', '#00c853', '#ffd600', '#00bcd4']

export function nextDrawColor(count = 0) {
  return DRAW_COLORS[count % DRAW_COLORS.length]
}
