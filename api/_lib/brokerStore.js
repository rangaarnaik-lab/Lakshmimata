import { createClient } from '@supabase/supabase-js'
import { decryptToken, isEncryptedToken } from './tokenCrypto.js'

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

export async function getBrokerRow(db, userId, broker = 'upstox') {
  const { data, error } = await db
    .from('user_broker_tokens')
    .select('access_token,expires_at,updated_at,broker,upstox_user_id')
    .eq('user_id', userId)
    .eq('broker', broker)
    .maybeSingle()
  if (!error && data?.access_token) return data

  if (broker !== 'upstox') return null
  const { data: legacy, error: legacyErr } = await db
    .from('user_tokens')
    .select('upstox_token,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (legacyErr || !legacy?.upstox_token) return null
  return { access_token: legacy.upstox_token, expires_at: null, updated_at: legacy.updated_at, broker: 'upstox' }
}

/** Newest encrypted connection — Upstox or Fyers. Live quotes/charts use this one. */
export async function getActiveLiveBroker(db, userId) {
  const [upstox, fyers] = await Promise.all([
    getBrokerRow(db, userId, 'upstox'),
    getBrokerRow(db, userId, 'fyers'),
  ])
  const candidates = []
  if (isEncryptedToken(upstox?.access_token)) candidates.push({ broker: 'upstox', row: upstox })
  if (isEncryptedToken(fyers?.access_token)) candidates.push({ broker: 'fyers', row: fyers })
  if (!candidates.length) return null
  candidates.sort((a, b) => new Date(b.row.updated_at || 0) - new Date(a.row.updated_at || 0))
  return candidates[0]
}

/** Next 3:30 AM IST — when a plain Upstox access token stops working. */
export function nextUpstoxTokenExpiry() {
  const nowUtcMs = Date.now()
  const istOffsetMs = 5.5 * 3600 * 1000
  const ist = new Date(nowUtcMs + istOffsetMs)
  const cutoff = new Date(ist)
  cutoff.setUTCHours(3, 30, 0, 0)
  if (cutoff <= ist) cutoff.setUTCDate(cutoff.getUTCDate() + 1)
  return new Date(cutoff.getTime() - istOffsetMs).toISOString()
}

/**
 * Upstox access tokens are JWTs, so prefer their own `exp` claim — extended
 * tokens last far longer than the nightly 3:30 AM cutoff.
 */
export function upstoxTokenExpiry(rawToken, provided = null) {
  if (provided) return provided
  try {
    const part = String(rawToken || '').split('.')[1]
    if (part) {
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
      const claims = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
      const exp = Number(claims?.exp)
      if (Number.isFinite(exp) && exp > 0) return new Date(exp * 1000).toISOString()
    }
  } catch (_) {}
  return nextUpstoxTokenExpiry()
}

export async function saveBrokerToken(db, userId, { accessToken, broker = 'upstox', brokerUserId = null, expiresAt = null }) {
  const row = {
    user_id: userId,
    broker,
    access_token: accessToken,
    upstox_user_id: brokerUserId,
    // Never null: some deployments have a NOT NULL constraint on this column.
    expires_at: expiresAt || nextUpstoxTokenExpiry(),
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('user_broker_tokens').upsert(row, { onConflict: 'user_id,broker' })
  // No fallback to user_tokens: that table holds plaintext, and a "successful"
  // plaintext write reads back as not-connected on the next request, which
  // looks like the connect silently failed.
  if (error) throw new Error(`user_broker_tokens: ${error.message}`)
}

export async function deleteBrokerToken(db, userId, broker = 'upstox') {
  await db.from('user_broker_tokens').delete().eq('user_id', userId).eq('broker', broker)
  if (broker === 'upstox') {
    await db.from('user_tokens').delete().eq('user_id', userId)
  }
}

export function connectionStatus(row, broker = 'upstox') {
  const encrypted = isEncryptedToken(row?.access_token)
  return {
    connected: encrypted,
    reconnect_required: !!row && !encrypted,
    broker: encrypted ? broker : null,
    expires_at: encrypted ? row.expires_at : null,
    updated_at: row?.updated_at || null,
  }
}

/** Decrypt the signed-in user's Upstox token, or throw a 409 the UI can handle. */
export async function requireUserUpstoxToken(req) {
  const context = await authenticatedBrokerContext(req)
  const row = await getBrokerRow(context.db, context.user.id, 'upstox')
  if (!row?.access_token) {
    const error = new Error('Connect Upstox to load prices from your account.')
    error.status = 409
    error.code = 'upstox_not_connected'
    throw error
  }
  try {
    return { ...context, token: decryptToken(row.access_token), broker: 'upstox' }
  } catch (error) {
    const wrapped = new Error(error.message || 'Reconnect Upstox')
    wrapped.status = 409
    wrapped.code = 'upstox_reconnect_required'
    throw wrapped
  }
}

/** Newest connected broker (Upstox or Fyers) with a decrypted token. */
export async function requireUserLiveBroker(req) {
  const context = await authenticatedBrokerContext(req)
  const active = await getActiveLiveBroker(context.db, context.user.id)
  if (!active) {
    const error = new Error('Connect Upstox or Fyers to load prices from your own account.')
    error.status = 409
    error.code = 'upstox_not_connected'
    throw error
  }
  try {
    return { ...context, token: decryptToken(active.row.access_token), broker: active.broker, row: active.row }
  } catch (error) {
    const wrapped = new Error(error.message || `Reconnect ${active.broker}`)
    wrapped.status = 409
    wrapped.code = `${active.broker}_reconnect_required`
    throw wrapped
  }
}
