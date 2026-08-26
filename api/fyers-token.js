/**
 * POST /api/fyers-token
 * Exchanges a Fyers auth_code for a daily access token. Secret stays on the server.
 */
import {
  authenticatedBrokerContext,
  readJsonBody,
  saveBrokerToken,
  sendJson,
  setCors,
  upstoxTokenExpiry,
} from './_lib/brokerStore.js'
import { encryptToken } from './_lib/tokenCrypto.js'
import { FYERS_API, USER_AGENT, fyersAppIdHash, fyersCredentials } from './_lib/fyers.js'

export async function handleFyersTokenRequest(req, res) {
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

  let context
  try {
    context = await authenticatedBrokerContext(req)
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message })
    return
  }

  const body = await readJsonBody(req)
  const code = String(body.code || body.auth_code || '').trim()
  if (!code) {
    sendJson(res, 400, { error: 'Missing Fyers authorization code' })
    return
  }

  const { appId, secret, configured } = fyersCredentials()
  if (!configured) {
    sendJson(res, 503, { error: 'Fyers OAuth is not configured on the server (FYERS_APP_ID / FYERS_SECRET_ID).' })
    return
  }

  const tokenRes = await fetch(`${FYERS_API}/api/v3/validate-authcode`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      appIdHash: fyersAppIdHash(appId, secret),
      code,
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => ({}))
  const accessToken = tokenJson.access_token
  if (!tokenRes.ok || tokenJson.s !== 'ok' || !accessToken) {
    const msg = tokenJson.message || tokenJson.emsg || tokenJson.error || `Fyers token exchange failed (${tokenRes.status})`
    sendJson(res, 400, { error: String(msg) })
    return
  }

  try {
    await saveBrokerToken(context.db, context.user.id, {
      broker: 'fyers',
      accessToken: encryptToken(accessToken),
      brokerUserId: tokenJson.client_id || null,
      expiresAt: upstoxTokenExpiry(accessToken),
    })
  } catch (error) {
    sendJson(res, 500, { error: `Fyers connected but the encrypted token could not be saved: ${error.message}` })
    return
  }

  sendJson(res, 200, {
    ok: true,
    connected: true,
    broker: 'fyers',
    expires_note: 'Fyers access tokens expire at the end of the trading day. Reconnect the next morning.',
  })
}

export default async function handler(req, res) {
  await handleFyersTokenRequest(req, res)
}
