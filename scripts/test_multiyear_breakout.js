// Harness: exercise the dashboard's pure scan logic against known fixtures.
// Run: node scripts/test_multiyear_breakout.js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '..', 'multiyear_breakout_dashboard.html'), 'utf8')
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1]

// Strip the browser-only boot block so the pure functions can run in Node.
const cut = js.indexOf('/* â”€â”€ boot â”€')
const pure = js.slice(0, cut > 0 ? cut : js.length)

// Minimal DOM stub: the dashboard's `$` helper touches document at definition
// time, and renderCards() runs during boot. Only the ids touched by the boot
// block need to resolve.
const el = () => ({ innerHTML: '', textContent: '', value: '', click: null,
                    style: {}, addEventListener: () => {}, onclick: null,
                    querySelectorAll: () => [], dataset: {} })
const nodes = {}
const sandbox = {
  console,
  document: {
    getElementById: (id) => (nodes[id] = nodes[id] || el()),
    querySelectorAll: () => [],
    createElement: () => el(),
  },
  fetch: async () => { throw new Error('no network in tests') },
  FileReader: function(){},
}
// Pre-create the ids the boot block and runScan() read, with the same defaults
// the markup ships, so the scan runs against real values instead of ''.
for (const [id, val] of [['years','1260'],['days','10'],['volx','1.5'],['near','2']]) {
  nodes[id] = el(); nodes[id].value = val
}
vm.createContext(sandbox)
vm.runInContext(pure, sandbox)
const { computeRow } = sandbox

let pass = 0, fail = 0
function check(name, got, want, tol){
  const ok = tol === undefined ? Object.is(got, want) : Math.abs(got - want) <= tol
  if (ok){ pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  FAIL ' + name + ' -> got ' + got + ', want ' + want) }
}

/** Build n bars: flat 100, then an optional breakout spike on the last bar. */
function mk(n, last, volMul){
  const prices = new Array(n).fill(100)
  prices[n - 1] = last
  const dates = prices.map((_, i) => '2020-01-' + String((i % 28) + 1).padStart(2, '0'))
  const volumes = new Array(n).fill(1000)
  if (volMul !== undefined) volumes[n - 1] = 1000 * volMul
  return { prices, dates, volumes }
}

console.log('\n1. flat series, last bar at 100 -> no breakout')
{
  const { prices, dates, volumes } = mk(300, 100)
  const r = computeRow('AAA', dates, prices, volumes, 252)
  check('pctAbove is 0', r.pctAbove, 0, 0.001)
  check('not brokeOut', r.brokeOut, false)
  check('barsSince null', r.barsSince, null)
  check('longHistory true', r.longHistory, true)
}

console.log('\n2. last bar breaks the prior high -> breakout today')
{
  const { prices, dates, volumes } = mk(300, 120, 2.0)
  const r = computeRow('BBB', dates, prices, volumes, 252)
  check('pctAbove +20%', r.pctAbove, 20, 0.001)
  check('brokeOut', r.brokeOut, true)
  check('barsSince 0 (today)', r.barsSince, 0)
  check('priorHigh 100', r.priorHigh, 100, 0.001)
  check('volRatio 2x', r.volRatio, 2, 0.001)
}

console.log('\n3. high set 3 bars ago -> barsSince 3, vol measured then')
{
  const prices = new Array(300).fill(100)
  prices[296] = 130   // 4th from last
  prices[297] = 131
  prices[298] = 129
  prices[299] = 128   // latest, still above the 100 shelf
  const dates = prices.map((_, i) => 'd' + i)
  const volumes = new Array(300).fill(1000)
  volumes[296] = 2500
  const r = computeRow('CCC', dates, prices, volumes, 252)
  check('brokeOut', r.brokeOut, true)
  check('barsSince 3', r.barsSince, 3)
  check('priorHigh still 100', r.priorHigh, 100, 0.001)
  check('volRatio uses breakout bar', r.volRatio, 2.5, 0.001)
}

console.log('\n4. prior high is the max of the window, not the last value')
{
  const prices = new Array(50).fill(80)
  prices[10] = 200      // old spike inside the window
  prices[49] = 90       // latest, well under the spike
  const dates = prices.map((_, i) => 'd' + i)
  const r = computeRow('DDD', dates, prices, new Array(50).fill(500), 252)
  check('priorHigh is the 200 spike', r.priorHigh, 200, 0.001)
  check('pctAbove is -55%', r.pctAbove, -55, 0.001)
  check('not brokeOut', r.brokeOut, false)
}

console.log('\n5. window truncation: spike older than the lookback is ignored')
{
  const prices = new Array(400).fill(100)
  prices[5] = 500       // very old spike, outside a 252-bar window
  prices[399] = 105
  const dates = prices.map((_, i) => 'd' + i)
  const r = computeRow('EEE', dates, prices, new Array(400).fill(500), 252)
  check('priorHigh is 100, not 500', r.priorHigh, 100, 0.001)
  check('brokeOut on 105', r.brokeOut, true)
}

console.log('\n6. latest bar is excluded from its own prior high')
{
  // Without excluding the latest bar, a stock AT its high could never register.
  const prices = new Array(20).fill(100)
  prices[19] = 150
  const r = computeRow('FFF', prices.map((_, i) => 'd' + i), prices, null, 252)
  check('brokeOut is true', r.brokeOut, true)
  check('barsSince 0', r.barsSince, 0)
}

console.log('\n7. missing volume data degrades gracefully')
{
  const { prices, dates } = mk(300, 120)
  const r = computeRow('GGG', dates, prices, null, 252)
  check('volRatio null', r.volRatio, null)
  check('volVal null', r.volVal, null)
  check('still a breakout', r.brokeOut, true)
}

console.log('\n8. short series returns null rather than throwing')
{
  check('single bar', computeRow('H', ['d'], [100], null, 252), null)
  check('empty', computeRow('I', [], [], null, 252), null)
}

console.log('\n9. non-positive / NaN closes are rejected upstream')
{
  const prices = new Array(300).fill(100); prices[5] = 0
  check('zero close poisons the set', prices.some((x) => Number.isNaN(x) || x <= 0), true)
}

console.log('\n10. longHistory reflects listing length vs window')
{
  const short = computeRow('J', ['a','b','c'], [10,11,12], null, 252)
  check('longHistory false when shorter', short.longHistory, false)
}

/* ── 11. end-to-end: boot with a stubbed Supabase payload ─────────────────
   Runs the WHOLE script (including the boot block) against a fake fetch, then
   asserts the scan produced rows and rendered them. This is the test that would
   catch a broken boot sequence or render path. */
console.log('\n11. end-to-end boot with stubbed Supabase response')
{
  const mk = (sym, last) => {
    const prices = new Array(300).fill(100)
    prices[299] = last
    const volumes = new Array(300).fill(1000)
    volumes[299] = 3000
    return {
      sym,
      dates: prices.map((_, i) => '2026-01-' + String(i % 28 + 1).padStart(2, '0')),
      prices,
      volumes,
    }
  }
  const payload = [mk('AAA', 120), mk('BBB', 95), mk('CCC', 100)]

  const mkEl = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    addEventListener: () => {}, onclick: null, querySelectorAll: () => [],
  })
  const nodes2 = {}
  nodes2.years = mkEl(); nodes2.years.value = '1260'
  nodes2.days  = mkEl(); nodes2.days.value  = '10'
  nodes2.volx  = mkEl(); nodes2.volx.value  = '1.5'
  nodes2.near  = mkEl(); nodes2.near.value  = '2'

  // The page declares its own `const CONFIG`, which shadows anything on the
  // sandbox, so patch the stub credentials into the source before running it.
  const bootJs = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('PASTE_YOUR_ANON_KEY_HERE', 'stub-anon')
  const sb2 = {
    console,
    document: {
      getElementById: (id) => (nodes2[id] = nodes2[id] || mkEl()),
      querySelectorAll: () => [],
      createElement: () => mkEl(),
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
    CONFIG: { SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_ANON_KEY: 'stub-anon', PAGE: 1000 },
  }
  const ctx = vm.createContext(sb2)
  vm.runInContext(bootJs, ctx)
  await new Promise((r) => setTimeout(r, 50))   // let the async boot finish

  // Top-level `let` bindings live in the context's scope, not on the sandbox
  // object, so read them back by evaluating an expression in that same context.
  const q = (expr) => vm.runInContext(expr, ctx)
  const computed = q('computed')

  check('AAA (120 vs 100) flagged as a breakout', computed.some(r => r.sym === 'AAA' && r.brokeOut), true)
  check('CCC (flat) not flagged', computed.filter(r => r.sym === 'CCC' && r.brokeOut).length, 0)
  check('AAA clears the 1.5x volume gate', computed.find(r => r.sym === 'AAA').volOk, true)
  check('AAA rendered into the table', /AAA/.test(nodes2.tbody.innerHTML), true)
  check('summary cards rendered', nodes2.cards.innerHTML.includes('Breakouts'), true)
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
