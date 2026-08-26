/**
 * Live LTP / % change via our server. The decrypted Upstox token never reaches the browser.
 * Scanners (RS, HY/HT, squeeze, …) stay on the owner Railway scan.
 */
import { supabase } from './supabase'

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
  const chg = prevClose && prevClose > 0
    ? +(((last - prevClose) / prevClose) * 100).toFixed(2)
    : 0
  return { last, chg, open, high, low, volume, prevClose, netChange }
}

function lookupQuote(data, sym) {
  const u = String(sym || '').trim().toUpperCase()
  return data[u] || data[`NSE_EQ:${u}`] || data[`NSE_EQ|${u}`] || data[nseEquityInstrumentKey(u)] || null
}

async function lakshmimataAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ''
}

async function fetchQuoteBatch(symbols) {
  const jwt = await lakshmimataAccessToken()
  if (!jwt) {
    const error = new Error('Sign in and connect Upstox to view live prices.')
    error.code = 'upstox_not_connected'
    throw error
  }
  const res = await fetch('/api/upstox-quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ symbols }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Upstox quotes ${res.status}`)
    err.status = res.status
    err.code = json.code
    throw err
  }
  const data = json?.quotes || {}
  const map = new Map()
  for (const sym of symbols) {
    const parsed = parseUpstoxQuote(lookupQuote(data, sym))
    if (parsed) map.set(String(sym).toUpperCase(), parsed)
  }
  return map
}

export async function fetchUpstoxQuotes(symbols) {
  const uniq = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
  if (!uniq.length) return new Map()
  const out = new Map()
  for (let i = 0; i < uniq.length; i += 240) {
    const part = await fetchQuoteBatch(uniq.slice(i, i + 240))
    for (const [k, v] of part) out.set(k, v)
  }
  return out
}

export async function fetchUpstoxIndexQuotes(names) {
  const uniq = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))]
  if (!uniq.length) return new Map()
  const jwt = await lakshmimataAccessToken()
  if (!jwt) {
    const error = new Error('Sign in and connect Upstox to view live index prices.')
    error.code = 'upstox_not_connected'
    throw error
  }
  const res = await fetch('/api/upstox-quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ indices: uniq }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Upstox quotes ${res.status}`)
    err.status = res.status
    err.code = json.code
    throw err
  }
  const data = json?.quotes || {}
  const map = new Map()
  for (const name of uniq) {
    const parsed = parseUpstoxQuote(lookupQuote(data, name) || data[name])
    if (parsed) map.set(name, parsed)
  }
  return map
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

const _candleCache = new Map()
const CANDLE_CACHE_TTL_MS = 90_000

export function clearUpstoxCandleCache() {
  _candleCache.clear()
}

export async function fetchUpstoxCandles({
  symbol,
  segment = 'equity',
  unit = 'days',
  interval = '1',
  days,
  bypassCache = false,
} = {}) {
  const clean = String(symbol || '').trim()
  if (!clean) return { error: 'No symbol' }
  const cacheKey = `${clean}|${segment}|${unit}|${interval}|${days || ''}`
  if (!bypassCache) {
    const hit = _candleCache.get(cacheKey)
    if (hit && Date.now() - hit.at < CANDLE_CACHE_TTL_MS && hit.payload && !hit.payload.error) {
      return hit.payload
    }
  }

  const jwt = await lakshmimataAccessToken()
  if (!jwt) {
    return { error: 'Connect Upstox to load this chart from your account.', code: 'upstox_not_connected' }
  }

  const body = {
    symbol: clean,
    segment,
    unit,
    interval: String(interval),
  }
  if (unit === 'minutes' && days) {
    const from = new Date()
    from.setDate(from.getDate() - Math.max(1, Math.min(28, Number(days) || 10)))
    body.from_date = from.toISOString().slice(0, 10)
  }

  const res = await fetch('/api/upstox-candles', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      error: json.error || `Upstox candles ${res.status}`,
      code: json.code,
    }
  }
  if (!Array.isArray(json.prices) || !json.prices.length) {
    return { error: `No Upstox candles for ${clean}` }
  }
  const payload = json
  _candleCache.set(cacheKey, { at: Date.now(), payload })
  if (_candleCache.size > 40) {
    const oldest = [..._candleCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) _candleCache.delete(oldest[0])
  }
  return payload
}
