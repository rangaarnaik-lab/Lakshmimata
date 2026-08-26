import {
  authenticatedBrokerContext,
  getActiveLiveBroker,
  readJsonBody,
  sendJson,
  setCors,
} from './_lib/brokerStore.js'
import { decryptToken } from './_lib/tokenCrypto.js'
import { resolveEquityKeys, resolveIndexKeys } from './_lib/upstoxInstruments.js'
import { fetchFyersQuoteMap, fyersCredentials } from './_lib/fyers.js'

const MAX_SYMBOLS = 240
const BATCH_SIZE = 80

function cleanSymbols(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().toUpperCase())
    .filter(value => /^[A-Z0-9&.-]{1,30}$/.test(value)))]
    .slice(0, MAX_SYMBOLS)
}

function lookupQuote(data, label, instrumentKey) {
  return data[instrumentKey]
    || data[label]
    || data[`NSE_EQ:${label}`]
    || data[`NSE_INDEX:${label}`]
    || null
}

async function fetchBatch(token, symbols, keyBySymbol) {
  const pairs = symbols
    .map(symbol => [symbol, keyBySymbol.get(symbol)])
    .filter(([, key]) => key)
  if (!pairs.length) return {}
  const url = new URL('https://api.upstox.com/v2/market-quote/quotes')
  url.searchParams.set('instrument_key', pairs.map(([, key]) => key).join(','))
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
  return Object.fromEntries(pairs
    .map(([symbol, key]) => [symbol, lookupQuote(data, symbol, key)])
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
    const indices = [...new Set((Array.isArray(body.indices) ? body.indices : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))]
      .slice(0, MAX_SYMBOLS)
    if (!symbols.length && !indices.length) {
      sendJson(res, 400, { error: 'Provide at least one NSE symbol or index' })
      return
    }

    const active = await getActiveLiveBroker(context.db, context.user.id)
    if (!active?.row?.access_token) {
      sendJson(res, 409, {
        code: 'upstox_not_connected',
        error: 'Connect Upstox or Fyers to view live price and change.',
      })
      return
    }

    let token
    try {
      token = decryptToken(active.row.access_token)
    } catch (error) {
      sendJson(res, 409, { code: `${active.broker}_reconnect_required`, error: error.message })
      return
    }

    if (active.broker === 'fyers') {
      const { appId, configured } = fyersCredentials()
      if (!configured) {
        sendJson(res, 503, { error: 'Fyers is connected but FYERS_APP_ID is missing on the server.' })
        return
      }
      const quotes = await fetchFyersQuoteMap(appId, token, { symbols, indices })
      sendJson(res, 200, { quotes, broker: 'fyers' })
      return
    }

    const quotes = {}
    if (symbols.length) {
      const keyBySymbol = await resolveEquityKeys(token, symbols)
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        Object.assign(quotes, await fetchBatch(token, symbols.slice(i, i + BATCH_SIZE), keyBySymbol))
      }
    }
    if (indices.length) {
      const keyByName = await resolveIndexKeys(token, indices)
      for (let i = 0; i < indices.length; i += BATCH_SIZE) {
        Object.assign(quotes, await fetchBatch(token, indices.slice(i, i + BATCH_SIZE), keyByName))
      }
    }
    sendJson(res, 200, { quotes, broker: 'upstox' })
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
