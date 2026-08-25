/**
 * POST /api/upstox-token
 * Exchanges an Upstox OAuth authorization code for an access token.
 * Client secret and decrypted token stay on the server.
 */
import {
  authenticatedBrokerContext,
  readJsonBody,
  saveBrokerToken,
  sendJson,
  setCors,
} from './_lib/brokerStore.js'
import { encryptToken } from './_lib/tokenCrypto.js'

export async function handleUpstoxTokenRequest(req, res) {
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
  const code = String(body.code || '').trim()
  const redirectUri = String(body.redirect_uri || process.env.UPSTOX_REDIRECT_URI || '').trim()
  if (!code) {
    sendJson(res, 400, { error: 'Missing authorization code' })
    return
  }

  const clientId = String(process.env.UPSTOX_CLIENT_ID || '').trim()
  const clientSecret = (process.env.UPSTOX_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) {
    sendJson(res, 503, { error: 'Upstox OAuth is not configured on the server (UPSTOX_CLIENT_ID / UPSTOX_CLIENT_SECRET).' })
    return
  }
  if (!redirectUri) {
    sendJson(res, 400, { error: 'Missing redirect_uri' })
    return
  }

  const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => ({}))
  const accessToken = tokenJson.extended_token || tokenJson.access_token || tokenJson.data?.access_token
  if (!tokenRes.ok || !accessToken) {
    const msg = tokenJson.message || tokenJson.error || tokenJson.errors?.[0]?.message || `Upstox token exchange failed (${tokenRes.status})`
    sendJson(res, 400, { error: String(msg) })
    return
  }

  try {
    await saveBrokerToken(context.db, context.user.id, {
      accessToken: encryptToken(accessToken),
      brokerUserId: tokenJson.user_id || tokenJson.data?.user_id || null,
      expiresAt: tokenJson.expires_at || null,
    })
  } catch (error) {
    sendJson(res, 500, { error: `Upstox connected but the encrypted token could not be saved: ${error.message}` })
    return
  }

  sendJson(res, 200, {
    ok: true,
    connected: true,
    user_name: tokenJson.user_name || null,
    expires_note: tokenJson.extended_token
      ? 'Using Upstox extended (read-only) token for live quotes.'
      : 'Upstox access tokens expire at 3:30 AM IST the next day. Reconnect after that.',
  })
}

export default async function handler(req, res) {
  await handleUpstoxTokenRequest(req, res)
}
