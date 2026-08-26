import { sendJson, setCors } from './_lib/brokerStore.js'
import { fyersCredentials } from './_lib/fyers.js'

export function fyersOAuthPublicConfig(req) {
  const { appId, configured, redirectUri } = fyersCredentials()
  const origin = String(req.headers.origin || '').replace(/\/$/, '')
  const host = String(req.headers.host || '').trim()
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const inferred = origin
    ? `${origin}/fyers/callback`
    : (host ? `${proto}://${host}/fyers/callback` : '')
  return {
    configured,
    client_id: appId || null,
    redirect_uri: redirectUri || inferred || null,
  }
}

export async function handleFyersOAuthConfigRequest(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET only' })
    return
  }
  sendJson(res, 200, fyersOAuthPublicConfig(req))
}

export default async function handler(req, res) {
  await handleFyersOAuthConfigRequest(req, res)
}
