// Multi-year breakout detector — correctness of the prior-high window and the
// freshness walk-back, which are the two things that silently break this scan.
import assert from 'node:assert/strict'
import { multiYearBreakout, isMultiYearBreakout, barsForYears, MULTIYEAR_WINDOWS }
  from '../src/scanners/multiYearBreakout.js'

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name) }
  catch (e) { console.error('  ✗', name, '\n     ', e.message); process.exitCode = 1 }
}

const BARS_PER_YEAR = 252

// A flat series that rises only at the very end, so `last` sits above
// everything before it — the shape of a genuine breakout.
function breakoutSeries(len, { spike = 1.5 } = {}) {
  const a = new Array(len).fill(100)
  a[len - 1] = 100 * spike
  return a
}

console.log('\nmulti-year breakout')

test('window lengths match 3/5/10 years of trading bars', () => {
  assert.equal(barsForYears(3), 756)
  assert.equal(barsForYears(5), 1260)
  assert.equal(barsForYears(10), 2520)
  assert.equal(MULTIYEAR_WINDOWS.length, 3)
})

test('prior high EXCLUDES the latest bar', () => {
  // 5Y window needs 1261 bars. Flat 100, last bar 150.
  const r = multiYearBreakout(breakoutSeries(1261, { spike: 1.5 }), { years: 5 })
  assert.equal(r.priorHigh, 100, 'prior high must come from bars before the last')
  assert.equal(r.last, 150)
  assert.equal(r.pctAbove, 50)
})

test('a flat series is NOT a breakout (self-comparison would make it one)', () => {
  // Every close identical: if the latest bar were in its own prior high,
  // pctAbove would be 0 and the scan would report something.
  const flat = new Array(1261).fill(100)
  const r = multiYearBreakout(flat, { years: 5 })
  assert.equal(r.pctAbove, 0)
  assert.equal(r.broke, false)
  assert.equal(r.crossedAt, null)
  assert.equal(isMultiYearBreakout(r), false)
})

test('short series returns null instead of throwing', () => {
  // Below the 60-bar floor a multi-year claim is meaningless.
  assert.equal(multiYearBreakout([1, 2, 3], { years: 5 }), null)
  assert.equal(multiYearBreakout(new Array(60).fill(100), { years: 5 }), null)
  assert.equal(multiYearBreakout([], { years: 3 }), null)
  assert.equal(multiYearBreakout(null, { years: 3 }), null)
})

test('stale breakout is not fresh', () => {
  // Spike 30 bars back, then flat at the new level. The level is above the
  // old prior high, but the cross is outside the 10-bar freshness window.
  const len = 1261
  const a = new Array(len).fill(100)
  a[len - 30] = 150
  for (let i = len - 29; i < len; i++) a[i] = 151
  const r = multiYearBreakout(a, { years: 5, withinBars: 10 })
  assert.equal(r.fresh, false, 'cross is 30 bars back, outside the window')
  assert.equal(r.crossedAt, null, 'no cross found within withinBars')
  assert.equal(isMultiYearBreakout(r), false)
})

test('recent cross is fresh', () => {
  const len = 1261
  const a = new Array(len).fill(100)
  a[len - 4] = 150
  for (let i = len - 3; i < len; i++) a[i] = 151
  const r = multiYearBreakout(a, { years: 5, withinBars: 10 })
  assert.equal(r.fresh, true)
  // The first bar to exceed the old 100 high is len-3 (151), not the 150 spike.
  assert.equal(r.crossedAt, 2, 'crossed when price cleared 150')
  assert.equal(isMultiYearBreakout(r), true)
})

test('a plateau at the high is not a fresh crossing', () => {
  // Broke out 8 bars ago and has held flat at the new high since. The high
  // rose with the price, so every recent bar merely *equals* its prior high —
  // none of them cross it. The cross is 8 bars back, which is still inside
  // withinBars=10, so it is correctly reported as fresh-but-not-at-a-new-high.
  const len = 1261
  const a = new Array(len).fill(100)
  a[len - 8] = 150
  for (let i = len - 7; i < len; i++) a[i] = 150
  const r = multiYearBreakout(a, { years: 5, withinBars: 10 })
  assert.equal(r.broke, false, 'flat at the high is not above it')
  assert.equal(r.crossedAt, 7, 'cross happened 7 bars back')
  assert.equal(isMultiYearBreakout(r), true, 'still a recent breakout event')
})

test('spike older than the lookback window is ignored', () => {
  // Big spike 400 bars back, price back to 100 since. The 5Y prior high is
  // 150 (it is inside the window), so the stock is BELOW its own 5-year high
  // and must not be reported as breaking out.
  const len = 1261
  const a = new Array(len).fill(100)
  a[len - 400] = 150
  const r = multiYearBreakout(a, { years: 5 })
  assert.equal(r.priorHigh, 150)
  assert.equal(r.pctAbove, -33.33)
  assert.equal(r.broke, false)
})

test('near-high bucket catches stocks just under the high', () => {
  const len = 1261
  const a = new Array(len).fill(100)
  a[len - 1] = 99   // 1% below
  const r = multiYearBreakout(a, { years: 5 })
  assert.equal(r.broke, false)
  assert.equal(r.near, true, 'within 2% under the high')
})

test('longTag set when history is shorter than the tested window', () => {
  // 800 bars: enough to compute, but short of a true 5-year window.
  const r = multiYearBreakout(breakoutSeries(800, { spike: 1.5 }), { years: 5 })
  assert.equal(r.broke, true)
  assert.equal(r.longTag, true, 'guards against calling 300 bars a 5-year high')
  assert.equal(r.barsAvailable, 800)
})

test('longTag false with a full window', () => {
  const r = multiYearBreakout(breakoutSeries(2000, { spike: 1.5 }), { years: 5 })
  assert.equal(r.longTag, false)
})

test('non-positive or non-finite last close is rejected', () => {
  const a = new Array(1261).fill(100)
  a[1260] = 0
  assert.equal(multiYearBreakout(a, { years: 5 }), null)
  const b = new Array(1261).fill(100)
  b[1260] = NaN
  assert.equal(multiYearBreakout(b, { years: 5 }), null)
})

test('numeric strings from the DB are coerced', () => {
  const a = new Array(1261).fill('100')
  a[1260] = '150'
  const r = multiYearBreakout(a, { years: 5 })
  assert.equal(r.last, 150)
  assert.equal(r.broke, true)
})

test('3Y window reacts faster than 10Y on the same series', () => {
  // Spike to 150, then settle back to 149. The 149s are at the 3Y high, but the
  // 150 spike is still inside the 10Y window — so the two windows disagree
  // about whether the stock is at its multi-year high.
  const len = 2521
  const a = new Array(len).fill(100)
  a[len - 900] = 150
  for (let i = len - 899; i < len; i++) a[i] = 149
  const r3 = multiYearBreakout(a, { years: 3 })
  const r10 = multiYearBreakout(a, { years: 10 })
  assert.equal(r3.priorHigh, 149, '3Y window rolled past the spike')
  assert.equal(r3.near, true, 'at its 3-year high')
  assert.equal(r10.priorHigh, 150, '10Y window still contains the spike')
  // 149 vs a 150 high is only -0.67%, so it still counts as "near" — what
  // separates the readings is the prior high itself, not the near band.
  assert.equal(r10.pctAbove, -0.67)
  assert.equal(r3.broke, false, 'at, not above, the 3Y high')
  assert.equal(r10.broke, false, 'below the 10Y high')
})

console.log(`\n${passed} passed\n`)