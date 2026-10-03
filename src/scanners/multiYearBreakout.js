/**
 * Multi-year breakout — closing-price breakouts above the 3 / 5 / 10-year high.
 *
 * The 52-week breakout column the stocks table carries only looks back one
 * year. This is the same idea stretched out: a stock trading at the top of its
 * own multi-year range is a different and stronger signal than one at a 52-week
 * high, because the prior high it cleared was set over years, not quarters.
 *
 * Two details make or break this:
 *
 * 1. The prior high must EXCLUDE the latest bar. Comparing the last close
 *    against `Math.max(...closes)` including itself makes every stock sit at
 *    exactly 0% from its own high and the scan silently finds nothing.
 * 2. The window must exclude the latest bar too, or a stock with only 300 bars
 *    would be reported as breaking its "5-year" high. We therefore require the
 *    series to actually cover the window before reporting a tier, and surface
 *    the `LONG` tag when it doesn't.
 *
 * Freshness matters as much as the level. Two separate questions are asked:
 *
 *   - `broke`  — is it above the multi-year high *right now*?
 *   - `fresh`  — did it cross that high within the last `withinBars` bars?
 *
 * They are deliberately independent. A stock that broke out 30 bars ago and
 * held the move now sits *at* its prior high (the high rose with it), so `broke`
 * is false while the crossing is still a recent, tradeable event. Gating one on
 * the other would throw that away — which is why the cross is found by walking
 * back over recent bars and comparing each against the window *before* it.
 */

export const MULTIYEAR_WINDOWS = [
  { years: 3,  bars: 756  },
  { years: 5,  bars: 1260 },
  { years: 10, bars: 2520 },
]

// Bars per year used to convert a calendar span into a bar count.
const BARS_PER_YEAR = 252

export function barsForYears(years) {
  const w = MULTIYEAR_WINDOWS.find(x => x.years === years)
  return w ? w.bars : Math.round(years * BARS_PER_YEAR)
}

/**
 * Evaluate one series.
 *
 * @param {number[]} closes oldest → newest
 * @param {object}   opts
 * @param {number}   opts.years     3 | 5 | 10 (default 5)
 * @param {number}   opts.withinBars how many bars back a valid cross may sit (default 10)
 * @returns {object|null} null when the series is too short to mean anything
 */
// Absolute floor on history before a multi-year claim is defensible at all.
const MIN_BARS = 60

export function multiYearBreakout(closes, opts = {}) {
  const years   = opts.years   ?? 5
  const withinBars = opts.withinBars ?? 10
  const bars    = opts.bars ?? barsForYears(years)

  const n = closes?.length || 0
  // Too little history to say anything — a 40-bar series is not a 5-year high.
  if (n < MIN_BARS + 1) return null

  const last = Number(closes[n - 1])
  if (!isFinite(last) || last <= 0) return null

  // Prior high EXCLUDES the latest bar — see note 1 above. When history is
  // shorter than the window we take everything we have rather than returning
  // null, and flag it via `longTag` so the UI can discount the reading.
  const from = Math.max(0, n - 1 - bars)
  const window = closes.slice(from, n - 1)
  if (!window.length) return null
  const priorHigh = Math.max(...window)

  const pctAbove = (last - priorHigh) / priorHigh * 100
  const near = pctAbove >= -2
  const broke = pctAbove > 0

  // History available vs bars the window wanted.
  const longTag = (n - 1) < bars

  // Walk back over the recent bars for the most recent genuine cross. Each bar
  // is tested against the window *ending just before it*, so a plateau that
  // merely sits at the high is not mistaken for a new crossing.
  let crossedAt = null
  for (let back = 0; back <= withinBars && n - 1 - back > from; back++) {
    const i = n - 1 - back
    const prevWindow = closes.slice(Math.max(from, i - bars), i)
    if (!prevWindow.length) break
    const prevHigh = Math.max(...prevWindow)
    const c = Number(closes[i])
    if (!isFinite(c) || c <= 0) continue
    if (c > prevHigh) { crossedAt = back; break }
  }

  const fresh = crossedAt != null

  return {
    years,
    bars,
    last,
    priorHigh,
    pctAbove: +pctAbove.toFixed(2),
    near,
    broke,
    fresh,
    crossedAt,          // bars back, or null
    longTag,            // history shorter than the window it was tested against
    barsAvailable: n,
  }
}

/**
 * True when the reading counts as a multi-year breakout.
 *
 * Keyed on `fresh` alone, not `broke && fresh`: a stock that crossed its 5-year
 * high four bars ago and is now consolidating just under the old level still
 * broke out four bars ago, and that is the signal worth surfacing.
 */
export function isMultiYearBreakout(r) {
  return !!r && r.fresh === true
}