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

async function fetchQuoteRequest({ symbols = [], indices = [] } = {}) {
  const jwt = await lakshmimataAccessToken()
  if (!jwt) {
    const error = new Error('Sign in and connect Upstox or Fyers to view live prices.')
    error.code = 'upstox_not_connected'
    throw error
  }
  const res = await fetch('/api/upstox-quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ symbols, indices }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Broker quotes ${res.status}`)
    err.status = res.status
    err.code = json.code
    throw err
  }
  return json?.quotes || {}
}

export async function fetchLiveQuotes({ symbols = [], indices = [] } = {}) {
  const uniqSyms = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
  const uniqIdx = [...new Set((indices || []).map(n => String(n || '').trim()).filter(Boolean))]
  const stocks = new Map()
  const indexMap = new Map()
  if (!uniqSyms.length && !uniqIdx.length) return { stocks, indices: indexMap }

  const data = await fetchQuoteRequest({
    symbols: uniqSyms.slice(0, 80),
    indices: uniqIdx.slice(0, 24),
  })
  for (const sym of uniqSyms.slice(0, 80)) {
    const parsed = parseUpstoxQuote(lookupQuote(data, sym))
    if (parsed) stocks.set(sym, parsed)
  }
  for (const name of uniqIdx.slice(0, 24)) {
    const parsed = parseUpstoxQuote(lookupQuote(data, name) || data[name])
    if (parsed) indexMap.set(name, parsed)
  }
  return { stocks, indices: indexMap }
}

export async function fetchUpstoxQuotes(symbols) {
  const { stocks } = await fetchLiveQuotes({ symbols })
  return stocks
}

export async function fetchUpstoxIndexQuotes(names) {
  const { indices } = await fetchLiveQuotes({ indices: names })
  return indices
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
const CANDLE_CACHE_TTL_MINUTES_MS = 90_000
const CANDLE_CACHE_TTL_DAILY_MS = 20 * 60 * 1000

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
  const ttl = unit === 'minutes' ? CANDLE_CACHE_TTL_MINUTES_MS : CANDLE_CACHE_TTL_DAILY_MS
  if (!bypassCache) {
    const hit = _candleCache.get(cacheKey)
    if (hit && Date.now() - hit.at < ttl && hit.payload && !hit.payload.error) {
      return hit.payload
    }
  }

  const jwt = await lakshmimataAccessToken()
  if (!jwt) {
    return { error: 'Connect Upstox or Fyers to load this chart from your account.', code: 'upstox_not_connected' }
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
  if (_candleCache.size > 80) {
    const oldest = [..._candleCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) _candleCache.delete(oldest[0])
  }
  return payload
}
