// Verify the v12 MA migration and the SMA series math used by the chart.
import { normalizeChartIndicatorPrefs } from '../src/lib/chartIndicatorPrefs.js'
import { calcSMASeries } from '../src/scanners/chartAnalysis.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}
const eq = (name, a, b, tol = 0) =>
  ok(name, Math.abs(a - b) <= tol, `(got ${a}, want ${b})`)

console.log('\nSMA series')
// period 3 over 1..6 => first two null, then 2, 3, 4, 5
const s = calcSMASeries([1, 2, 3, 4, 5, 6], 3)
ok('nulls before window', s[0] === null && s[1] === null)
eq('index 2', s[2], 2)
eq('index 5', s[5], 5)
ok('length preserved', s.length === 6)

// period longer than the series => all null, no throw
const short = calcSMASeries([1, 2, 3], 200)
ok('short series -> all null', short.length === 3 && short.every(v => v === null))

// period 1 is the identity (guards the smaLen clamp)
const one = calcSMASeries([4, 5, 6], 1)
ok('period 1 = passthrough', one.every((v, i) => v === [4, 5, 6][i]))

console.log('\nMA defaults (fresh install)')
const fresh = normalizeChartIndicatorPrefs(null).indicators.ma
ok('ema periods 9/21/50/150/200',
  fresh.params.ema9 === 9 && fresh.params.ma20 === 21 &&
  fresh.params.ma50 === 50 && fresh.params.ma150 === 150 && fresh.params.ma200 === 200,
  JSON.stringify([fresh.params.ema9, fresh.params.ma20, fresh.params.ma50, fresh.params.ma150, fresh.params.ma200]))
ok('sma periods 20/50/200',
  fresh.params.sma20 === 20 && fresh.params.sma50 === 50 && fresh.params.sma200 === 200)
ok('5 EMA lines on by default',
  [fresh.params.showEma9, fresh.params.showMa20, fresh.params.showMa50,
   fresh.params.showMa150, fresh.params.showMa200].every(v => v === true))
ok('3 SMA lines on by default',
  [fresh.params.showSma20, fresh.params.showSma50, fresh.params.showSma200].every(v => v === true))
ok('ma20Color is not the invisible #141414', fresh.params.ma20Color !== '#141414',
  `got ${fresh.params.ma20Color}`)
ok('version 13', normalizeChartIndicatorPrefs(null).version === 13)

console.log('\nMigration from an existing v11 profile')
const old = {
  version: 11,
  indicators: {
    ma: { enabled: true, params: { ema9: 9, ma20: 21, ma50: 50, ma150: 150, ma200: 200,
      ema9Color: '#ff9800', ma20Color: '#141414', ma50Color: '#0fe616',
      showEma9: true, showMa20: true, showMa50: true, showMa150: true, showMa200: true } },
  },
}
const mig = normalizeChartIndicatorPrefs(old)
ok('v11 -> SMA 20/50/200 seeded',
  mig.indicators.ma.params.sma20 === 20 && mig.indicators.ma.params.sma50 === 50 &&
  mig.indicators.ma.params.sma200 === 200)
ok('v11 -> SMA lines visible',
  mig.indicators.ma.params.showSma20 === true && mig.indicators.ma.params.showSma50 === true &&
  mig.indicators.ma.params.showSma200 === true)
ok('v11 -> #141414 recolored', mig.indicators.ma.params.ma20Color === '#2962ff',
  `got ${mig.indicators.ma.params.ma20Color}`)
ok('v11 -> version bumped to 13', mig.version === 13)

console.log('\nSqueeze dot row is not a continuous ribbon (v13)')
ok('fresh: "dot on every bar" off by default',
  normalizeChartIndicatorPrefs(null).indicators.squeeze.params.sqShowOff === false)
ok('v11 -> squeeze off-dots turned off',
  mig.indicators.squeeze.params.sqShowOff === false)
// A v12 profile had sqShowOff persisted true; v13 must clear it.
const v12 = normalizeChartIndicatorPrefs({
  version: 12, indicators: { squeeze: { params: { sqShowOff: true } } },
})
ok('v12 -> persisted sqShowOff:true cleared', v12.indicators.squeeze.params.sqShowOff === false,
  `got ${v12.indicators.squeeze.params.sqShowOff}`)
ok('v12 -> version bumped to 13', v12.version === 13)

console.log('\nUser overrides survive')
const custom = {
  version: 13,
  indicators: { ma: { enabled: true, params: {
    ema9: 5, ma20: 12, ma50: 34, ma150: 89, ma200: 144,
    sma20: 10, sma50: 30, sma200: 150,
    ma20Color: '#ff00ff',
    showSma20: false, showSma50: false, showSma200: false,
  } } },
}
const cust = normalizeChartIndicatorPrefs(custom).indicators.ma.params
ok('custom EMA periods kept', cust.ema9 === 5 && cust.ma200 === 144)
ok('custom SMA periods kept', cust.sma20 === 10 && cust.sma50 === 30 && cust.sma200 === 150)
ok('custom ma20Color kept', cust.ma20Color === '#ff00ff', `got ${cust.ma20Color}`)
ok('SMA toggles-off respected',
  cust.showSma20 === false && cust.showSma50 === false && cust.showSma200 === false)

console.log('\nOut-of-range SMA periods are clamped, not passed through')
const bad = normalizeChartIndicatorPrefs({
  version: 12, indicators: { ma: { params: { sma20: 0, sma50: -5 } } },
}).indicators.ma.params
ok('sma20 0 -> clamped', bad.sma20 >= 2, `got ${bad.sma20}`)
ok('sma50 -5 -> clamped', bad.sma50 >= 5, `got ${bad.sma50}`)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)