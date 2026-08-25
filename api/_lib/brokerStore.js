import { createClient } from '@supabase/supabase-js'
import { isEncryptedToken } from './tokenCrypto.js'

export function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url || !anonKey) throw new Error('Supabase is not configured on the server')
  return { url, anonKey }
}

export async function authenticatedBrokerContext(req) {
  const auth = String(req.headers.authorization || '')
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!jwt) {
    const error = new Error('Sign in to Lakshmimata first, then connect Upstox.')
    error.status = 401
    throw error
  }
  const { url, anonKey } = supabaseConfig()
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: userError } = await authClient.auth.getUser(jwt)
  if (userError || !data?.user?.id) {
    const error = new Error('Invalid or expired Lakshmimata session')
    error.status = 401
    throw error
  }
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  return { db, user: data.user, jwt }
}

export async function getBrokerRow(db, userId) {
  const { data, error } = await db
    .from('user_broker_tokens')
    .select('access_token,expires_at,updated_at')
    .eq('user_id', userId)
    .eq('broker', 'upstox')
    .maybeSingle()
  if (!error && data?.access_token) return data

  const { data: legacy, error: legacyErr } = await db
    .from('user_tokens')
    .select('upstox_token,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (legacyErr || !legacy?.upstox_token) return null
  return { access_token: legacy.upstox_token, expires_at: null, updated_at: legacy.updated_at }
}

export async function saveBrokerToken(db, userId, { accessToken, brokerUserId = null, expiresAt = null }) {
  const row = {
    user_id: userId,
    broker: 'upstox',
    access_token: accessToken,
    upstox_user_id: brokerUserId,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('user_broker_tokens').upsert(row, { onConflict: 'user_id,broker' })
  if (!error) return

  const { error: legacyErr } = await db.from('user_tokens').upsert({
    user_id: userId,
    upstox_token: accessToken,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (legacyErr) {
    throw new Error(`${error.message}; fallback user_tokens: ${legacyErr.message}`)
  }
}

export async function deleteBrokerToken(db, userId) {
  await db.from('user_broker_tokens').delete().eq('user_id', userId).eq('broker', 'upstox')
  await db.from('user_tokens').delete().eq('user_id', userId)
}

export function connectionStatus(row) {
  const encrypted = isEncryptedToken(row?.access_token)
  return {
    connected: encrypted,
    reconnect_required: !!row && !encrypted,
    broker: encrypted ? 'upstox' : null,
    expires_at: encrypted ? row.expires_at : null,
  }
}
