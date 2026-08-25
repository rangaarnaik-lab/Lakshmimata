import { sendJson, setCors } from './_lib/brokerStore.js'

export function upstoxOAuthPublicConfig(req) {
  const clientId = String(process.env.UPSTOX_CLIENT_ID || '').trim()
  const envRedirect = String(process.env.UPSTOX_REDIRECT_URI || '').trim()
  const origin = String(req.headers.origin || '').replace(/\/$/, '')
  const host = String(req.headers.host || '').trim()
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const inferred = origin
    ? `${origin}/upstox/callback`
    : (host ? `${proto}://${host}/upstox/callback` : '')
  return {
    configured: !!(clientId && String(process.env.UPSTOX_CLIENT_SECRET || '').trim()),
    client_id: clientId || null,
    redirect_uri: envRedirect || inferred || null,
  }
}

export async function handleUpstoxOAuthConfigRequest(req, res) {
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
  sendJson(res, 200, upstoxOAuthPublicConfig(req))
}

export default async function handler(req, res) {
  await handleUpstoxOAuthConfigRequest(req, res)
}
