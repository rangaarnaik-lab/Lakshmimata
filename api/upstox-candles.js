/**
 * POST /api/upstox-candles
 * OHLC for one instrument using the signed-in user's Upstox token.
 * Market breadth and scanner flags stay on our derived tables.
 */
import { readJsonBody, requireUserUpstoxToken, sendJson, setCors } from './_lib/brokerStore.js'
import { resolveEquityKey, resolveIndexKey } from './_lib/upstoxInstruments.js'

function istYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftIstYmd(days) {
  const now = new Date()
  const shifted = new Date(now.getTime() + days * 86400000)
  return istYmd(shifted)
}

function parseCandleRow(row) {
  if (!Array.isArray(row) || row.length < 5) return null
  const ts = String(row[0] || '')
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5]) || 0
  if (!ts || ![open, high, low, close].every(n => Number.isFinite(n) && n > 0)) return null
  return { ts, open, high, low, close, volume }
}

function toPayload(symbol, rows, interval) {
  const ordered = [...rows].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
  const daily = interval === 'day'
  return {
    sym: symbol,
    dates: ordered.map(r => (daily ? String(r.ts).slice(0, 10) : r.ts)),
    opens: ordered.map(r => r.open),
    highs: ordered.map(r => r.high),
    lows: ordered.map(r => r.low),
    prices: ordered.map(r => r.close),
    volumes: ordered.map(r => r.volume),
    daysCount: ordered.length,
    updatedAt: ordered[ordered.length - 1]?.ts || null,
    interval,
    source: 'upstox',
  }
}

async function upstoxJson(token, url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(json.message || json.error || json.errors?.[0]?.message || `Upstox candles failed (${response.status})`))
    error.status = response.status === 401 ? 401 : 502
    error.code = response.status === 401 ? 'upstox_token_expired' : 'upstox_candle_failed'
    error.httpStatus = response.status
    throw error
  }
  const candles = json?.data?.candles
  return Array.isArray(candles) ? candles.map(parseCandleRow).filter(Boolean) : []
}

function historicalUrl(instrumentKey, unit, interval, toDate, fromDate) {
  const base = `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(instrumentKey)}/${unit}/${interval}/${toDate}`
  return fromDate ? `${base}/${fromDate}` : base
}

function intradayUrl(instrumentKey, unit, interval) {
  return `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${unit}/${interval}`
}

export async function handleUpstoxCandlesRequest(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST only' })
    return
  }

  try {
    const { token } = await requireUserUpstoxToken(req)
    const body = await readJsonBody(req)
    const symbol = String(body.symbol || '').trim()
    const segment = String(body.segment || 'equity').toLowerCase() === 'index' ? 'index' : 'equity'
    const unit = String(body.unit || 'days') === 'minutes' ? 'minutes' : 'days'
    const interval = String(body.interval || '1')
    if (!symbol) {
      sendJson(res, 400, { error: 'Provide a symbol' })
      return
    }

    const key = segment === 'index'
      ? await resolveIndexKey(token, symbol)
      : await resolveEquityKey(token, symbol)
    if (!key) {
      sendJson(res, 404, {
        code: 'instrument_not_found',
        error: `${symbol} is not a tradable NSE ${segment === 'index' ? 'index' : 'symbol'} on Upstox.`,
      })
      return
    }

    const toDate = String(body.to_date || istYmd()).slice(0, 10)
    const fromDate = String(body.from_date || (unit === 'minutes' ? shiftIstYmd(-28) : shiftIstYmd(-365 * 9))).slice(0, 10)

    if (unit === 'days') {
      const rows = await upstoxJson(token, historicalUrl(key, 'days', interval, toDate, fromDate))
      sendJson(res, 200, toPayload(symbol, rows, 'day'))
      return
    }

    const historical = await upstoxJson(token, historicalUrl(key, 'minutes', interval, toDate, fromDate))
      .catch((error) => {
        if (error?.httpStatus === 400 || error?.httpStatus === 404) return []
        throw error
      })
    let today = []
    try {
      today = await upstoxJson(token, intradayUrl(key, 'minutes', interval))
    } catch (_) {
      today = []
    }
    const byTs = new Map()
    for (const row of [...historical, ...today]) byTs.set(row.ts, row)
    sendJson(res, 200, toPayload(symbol, [...byTs.values()], '1m'))
  } catch (error) {
    sendJson(res, error.status || 500, {
      code: error.code || 'upstox_candles_error',
      error: error.message || 'Could not fetch Upstox candles',
    })
  }
}

export default async function handler(req, res) {
  await handleUpstoxCandlesRequest(req, res)
}
