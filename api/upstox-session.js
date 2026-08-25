import {
  authenticatedBrokerContext,
  connectionStatus,
  deleteBrokerToken,
  getBrokerRow,
  readJsonBody,
  saveBrokerToken,
  sendJson,
  setCors,
} from './_lib/brokerStore.js'
import { encryptToken } from './_lib/tokenCrypto.js'

async function validateUpstoxToken(token) {
  const response = await fetch('https://api.upstox.com/v2/user/profile', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(json.message || json.error || `Upstox rejected the token (${response.status})`))
    error.status = 400
    throw error
  }
  return json?.data || {}
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
