/**
 * POST /api/upstox-token
 * Exchanges an Upstox OAuth authorization code for an access token.
 * Client secret stays on the server. Caller must be a signed-in Lakshmimata user.
 */
import { createClient } from '@supabase/supabase-js'

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body)
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)) } catch { return Promise.resolve({}) }
  }
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export async function handleUpstoxTokenRequest(req, res) {
  const origin = req.headers.origin || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' })
    return
  }

  const auth = String(req.headers.authorization || '')
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!jwt) {
    send(res, 401, { error: 'Sign in to Lakshmimata first, then connect Upstox.' })
    return
  }

  const body = await readJsonBody(req)
  const code = String(body.code || '').trim()
  const redirectUri = String(body.redirect_uri || process.env.UPSTOX_REDIRECT_URI || '').trim()
  if (!code) {
    send(res, 400, { error: 'Missing authorization code' })
    return
  }

  const clientId = (process.env.UPSTOX_CLIENT_ID || process.env.VITE_UPSTOX_CLIENT_ID || '').trim()
  const clientSecret = (process.env.UPSTOX_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) {
    send(res, 503, { error: 'Upstox OAuth is not configured on the server (UPSTOX_CLIENT_ID / UPSTOX_CLIENT_SECRET).' })
    return
  }
  if (!redirectUri) {
    send(res, 400, { error: 'Missing redirect_uri' })
    return
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!supabaseUrl || !anonKey) {
    send(res, 503, { error: 'Supabase is not configured on the server.' })
    return
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user?.id) {
    send(res, 401, { error: 'Invalid or expired Lakshmimata session' })
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
    send(res, 400, { error: String(msg) })
    return
  }

  const db = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { error: upErr } = await db.from('user_tokens').upsert({
    user_id: user.id,
    upstox_token: accessToken,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (upErr) {
    send(res, 500, { error: `Saved token to Upstox but not to your account: ${upErr.message}` })
    return
  }

  send(res, 200, {
    ok: true,
    access_token: accessToken,
    user_name: tokenJson.user_name || null,
    expires_note: tokenJson.extended_token
      ? 'Using Upstox extended (read-only) token for live quotes.'
      : 'Upstox access tokens expire at 3:30 AM IST the next day. Reconnect after that.',
  })
}

export default async function handler(req, res) {
  await handleUpstoxTokenRequest(req, res)
}
