import {
  authenticatedBrokerContext,
  getBrokerRow,
  readJsonBody,
  sendJson,
  setCors,
} from './_lib/brokerStore.js'
import { decryptToken } from './_lib/tokenCrypto.js'

const MAX_SYMBOLS = 240
const BATCH_SIZE = 80

function cleanSymbols(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(value => /^[A-Z0-9&.-]{1,30}$/.test(value)))]
    .slice(0, MAX_SYMBOLS)
}

function instrumentKey(symbol) {
  return `NSE_EQ|${symbol}`
}

function lookupQuote(data, symbol) {
  return data[`NSE_EQ:${symbol}`] || data[`NSE_EQ|${symbol}`] || data[instrumentKey(symbol)] || null
}

async function fetchBatch(token, symbols) {
  const url = new URL('https://api.upstox.com/v2/market-quote/quotes')
  url.searchParams.set('instrument_key', symbols.map(instrumentKey).join(','))
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(json.message || json.error || `Upstox quote request failed (${response.status})`))
    error.status = response.status === 401 ? 401 : 502
    error.code = response.status === 401 ? 'upstox_token_expired' : 'upstox_quote_failed'
    throw error
  }
  const data = json?.data || {}
  return Object.fromEntries(symbols
    .map(symbol => [symbol, lookupQuote(data, symbol)])
    .filter(([, quote]) => quote))
}

export async function handleUpstoxQuotesRequest(req, res) {
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
    const context = await authenticatedBrokerContext(req)
    const body = await readJsonBody(req)
    const symbols = cleanSymbols(body.symbols)
    if (!symbols.length) {
      sendJson(res, 400, { error: 'Provide at least one NSE symbol' })
      return
    }

    const row = await getBrokerRow(context.db, context.user.id)
    if (!row?.access_token) {
      sendJson(res, 409, {
        code: 'upstox_not_connected',
        error: 'Connect Upstox to view live price and change.',
      })
      return
    }

    let token
    try {
      token = decryptToken(row.access_token)
    } catch (error) {
      sendJson(res, 409, { code: 'upstox_reconnect_required', error: error.message })
      return
    }

    const quotes = {}
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      Object.assign(quotes, await fetchBatch(token, symbols.slice(i, i + BATCH_SIZE)))
    }
    sendJson(res, 200, { quotes })
  } catch (error) {
    sendJson(res, error.status || 500, {
      code: error.code || 'upstox_quotes_error',
      error: error.message || 'Could not fetch Upstox quotes',
    })
  }
}

export default async function handler(req, res) {
  await handleUpstoxQuotesRequest(req, res)
}
