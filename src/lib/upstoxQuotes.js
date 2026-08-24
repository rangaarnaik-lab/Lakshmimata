/**
 * Live LTP / % change from the signed-in user's Upstox token.
 * Scanners (RS, HY/HT, squeeze, …) stay on the owner Railway scan.
 */

const QUOTE_URL = 'https://api.upstox.com/v2/market-quote/quotes'
const BATCH = 80

export function isPersonalUpstoxToken(token, ownerToken = '') {
  const t = String(token || '').trim()
  if (!t) return false
  const o = String(ownerToken || '').trim()
  if (o && t === o) return false
  return true
}

export function nseEquityInstrumentKey(sym) {
  return `NSE_EQ|${String(sym || '').trim().toUpperCase()}`
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function parseUpstoxQuote(raw) {
  if (!raw || typeof raw !== 'object') return null
  const last = num(raw.last_price)
  if (last == null || last <= 0) return null
  const ohlc = raw.ohlc && typeof raw.ohlc === 'object' ? raw.ohlc : {}
  const netChange = num(raw.net_change)
  let prevClose = null
  if (netChange != null) {
    const p = last - netChange
    if (p > 0) prevClose = p
  }
  if (prevClose == null) prevClose = num(ohlc.close)
  const open = num(ohlc.open)
  const high = num(ohlc.high)
  const low = num(ohlc.low)
  const volume = num(raw.volume) ?? num(ohlc.volume)
  const flatPrev = prevClose != null && Math.abs(last - prevClose) < Math.max(0.005, Math.abs(last) * 0.0003)
  const chg = prevClose && prevClose > 0 && !flatPrev
    ? +(((last - prevClose) / prevClose) * 100).toFixed(2)
    : (prevClose && prevClose > 0 ? +(((last - prevClose) / prevClose) * 100).toFixed(2) : 0)
  return { last, chg, open, high, low, volume, prevClose, netChange }
}

function lookupQuote(data, sym) {
  const u = String(sym || '').trim().toUpperCase()
  return data[`NSE_EQ:${u}`] || data[`NSE_EQ|${u}`] || data[nseEquityInstrumentKey(u)] || null
}

async function fetchQuoteBatch(token, symbols) {
  const keys = symbols.map(nseEquityInstrumentKey)
  const url = new URL(QUOTE_URL)
  url.searchParams.set('instrument_key', keys.join(','))
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`Upstox quotes ${res.status}`)
    err.status = res.status
    err.body = text.slice(0, 240)
    throw err
  }
  let json
  try { json = JSON.parse(text) } catch {
    throw new Error('Upstox quotes: invalid JSON')
  }
  const data = json?.data || {}
  const map = new Map()
  for (const sym of symbols) {
    const parsed = parseUpstoxQuote(lookupQuote(data, sym))
    if (parsed) map.set(String(sym).toUpperCase(), parsed)
  }
  return map
}

/** Fetch live quotes for many symbols. Returns Map(SYM → parsed quote). */
export async function fetchUpstoxQuotes(token, symbols) {
  const t = String(token || '').trim()
  const uniq = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
  if (!t || !uniq.length) return new Map()
  const chunks = []
  for (let i = 0; i < uniq.length; i += BATCH) chunks.push(uniq.slice(i, i + BATCH))
  const out = new Map()
  const CONCUR = 3
  for (let i = 0; i < chunks.length; i += CONCUR) {
    const slice = chunks.slice(i, i + CONCUR)
    const parts = await Promise.all(slice.map(chunk => fetchQuoteBatch(t, chunk)))
    for (const part of parts) {
      for (const [k, v] of part) out.set(k, v)
    }
  }
  return out
}

export function applyQuoteToStock(stock, quote) {
  if (!stock || !quote) return stock
  const last = quote.last
  const prev = quote.prevClose
  const chg = quote.chg
  const open = quote.open ?? stock.open
  return {
    ...stock,
    last,
    chg,
    last_price: last,
    chg_pct: chg,
    open,
    prevClose: prev ?? stock.prevClose,
    gapPct: (open != null && prev) ? +(((open - prev) / prev) * 100).toFixed(2) : stock.gapPct,
    liveFromUser: true,
  }
}
