import {
  authenticatedBrokerContext,
  connectionStatus,
  deleteBrokerToken,
  getBrokerRow,
  readJsonBody,
  saveBrokerToken,
  sendJson,
  setCors,
  upstoxTokenExpiry,
} from './_lib/brokerStore.js'
import { encryptToken } from './_lib/tokenCrypto.js'

async function upstoxGet(token, url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

/**
 * Accepts a daily access token, an extended token, or a 1-year Analytics Token.
 * Analytics Tokens are restricted to a subset of GET APIs, so a profile refusal
 * is not proof of a bad token — fall back to a market-data read.
 */
async function validateUpstoxToken(token) {
  const profile = await upstoxGet(token, 'https://api.upstox.com/v2/user/profile')
  if (profile.ok) return profile.json?.data || {}

  const quote = await upstoxGet(
    token,
    'https://api.upstox.com/v2/market-quote/ltp?instrument_key=NSE_INDEX%7CNifty%2050',
  )
  if (quote.ok) return {}

  const json = profile.json || {}
  const error = new Error(String(
    json.message || json.error || json.errors?.[0]?.message
    || `Upstox rejected the token (${profile.status})`,
  ))
  error.status = 400
  throw error
}

export async function handleUpstoxSessionRequest(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  let context
  try {
    context = await authenticatedBrokerContext(req)
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message })
    return
  }

  try {
    if (req.method === 'GET') {
      const row = await getBrokerRow(context.db, context.user.id)
      sendJson(res, 200, connectionStatus(row))
      return
    }

    if (req.method === 'DELETE') {
      await deleteBrokerToken(context.db, context.user.id)
      sendJson(res, 200, { ok: true, connected: false })
      return
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const token = String(body.access_token || '').trim()
      if (!token) {
        sendJson(res, 400, { error: 'Missing Upstox access token' })
        return
      }
      const profile = await validateUpstoxToken(token)
      await saveBrokerToken(context.db, context.user.id, {
        accessToken: encryptToken(token),
        brokerUserId: profile.user_id || null,
        expiresAt: upstoxTokenExpiry(token),
      })
      sendJson(res, 200, { ok: true, connected: true, user_name: profile.user_name || null })
      return
    }

    sendJson(res, 405, { error: 'GET, POST, or DELETE only' })
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || 'Broker session request failed' })
  }
}

export default async function handler(req, res) {
  await handleUpstoxSessionRequest(req, res)
}
