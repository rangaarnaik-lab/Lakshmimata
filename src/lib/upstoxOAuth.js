/** Upstox OAuth 2.0. Client ID is loaded from the server; the secret never ships in the browser. */
import { supabase } from './supabase'

export const UPSTOX_OAUTH_STATE_KEY = 'lakshmimata-upstox-oauth-state'
const UPSTOX_OAUTH_REDIRECT_KEY = 'lakshmimata-upstox-oauth-redirect'
const UPSTOX_PENDING_KEY = 'lakshmimata-upstox-pending-oauth'
const UPSTOX_STEP_KEY = 'lakshmimata-upstox-last-step'

/** Last thing the connect flow did, so a silent branch is still visible on Account. */
export function noteUpstoxStep(step) {
  try { localStorage.setItem(UPSTOX_STEP_KEY, JSON.stringify({ step, at: Date.now() })) } catch (_) {}
}

export function readUpstoxStep() {
  try {
    const raw = localStorage.getItem(UPSTOX_STEP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

let cachedConfig = null

export async function fetchUpstoxOAuthConfig() {
  if (cachedConfig) return cachedConfig
  const res = await fetch('/api/upstox-oauth-config')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upstox config failed (${res.status})`)
  cachedConfig = {
    configured: !!data.configured && !!data.client_id,
    clientId: String(data.client_id || '').trim(),
    redirectUri: String(data.redirect_uri || '').trim(),
  }
  return cachedConfig
}

export function upstoxRedirectUri() {
  try {
    const stored = sessionStorage.getItem(UPSTOX_OAUTH_REDIRECT_KEY) || localStorage.getItem(UPSTOX_OAUTH_REDIRECT_KEY)
    if (stored) return stored
  } catch (_) {}
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/upstox/callback`
}

export async function startUpstoxOAuth() {
  const cfg = await fetchUpstoxOAuthConfig()
  if (!cfg.configured || !cfg.clientId) {
    throw new Error('Upstox OAuth is not configured. Set UPSTOX_CLIENT_ID and UPSTOX_CLIENT_SECRET on the server.')
  }
  const redirectUri = cfg.redirectUri || upstoxRedirectUri()
  if (!redirectUri) throw new Error('Missing Upstox redirect URL. Set UPSTOX_REDIRECT_URI on the server.')
  const state = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    sessionStorage.setItem(UPSTOX_OAUTH_STATE_KEY, state)
    sessionStorage.setItem(UPSTOX_OAUTH_REDIRECT_KEY, redirectUri)
    localStorage.setItem(UPSTOX_OAUTH_STATE_KEY, state)
    localStorage.setItem(UPSTOX_OAUTH_REDIRECT_KEY, redirectUri)
  } catch (_) {}
  const u = new URL('https://api.upstox.com/v2/login/authorization/dialog')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  window.location.assign(u.toString())
}

function storageGet(key) {
  try { return sessionStorage.getItem(key) || localStorage.getItem(key) || '' } catch { return '' }
}

function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, value)
    localStorage.setItem(key, value)
  } catch (_) {}
}

function storageRemove(key) {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch (_) {}
}

export function readUpstoxOAuthCallback() {
  if (typeof window === 'undefined') return null
  try {
    const q = new URLSearchParams(window.location.search)
    const path = (window.location.pathname || '').replace(/\/$/, '')
    const code = q.get('code')
    const state = q.get('state')
    const error = q.get('error')
    const onPath = path.endsWith('/upstox/callback')
    if (code || error) {
      const payload = {
        code,
        state,
        error,
        errorDescription: q.get('error_description'),
      }
      if (code && state) storageSet(UPSTOX_PENDING_KEY, JSON.stringify({ code, state, at: Date.now() }))
      return payload
    }
    const raw = storageGet(UPSTOX_PENDING_KEY)
    if (!raw) return null
    const pending = JSON.parse(raw)
    if (!pending?.code || Date.now() - Number(pending.at || 0) > 10 * 60 * 1000) {
      storageRemove(UPSTOX_PENDING_KEY)
      return null
    }
    if (!onPath && !pending.code) return null
    return { code: pending.code, state: pending.state, error: null, errorDescription: null }
  } catch {
    return null
  }
}

export function hasPendingUpstoxOAuth() {
  return !!readUpstoxOAuthCallback()?.code
}

export function expectedUpstoxOAuthState() {
  return storageGet(UPSTOX_OAUTH_STATE_KEY)
}

export function clearUpstoxOAuthParams() {
  if (typeof window === 'undefined') return
  storageRemove(UPSTOX_PENDING_KEY)
  storageRemove(UPSTOX_OAUTH_STATE_KEY)
  storageRemove(UPSTOX_OAUTH_REDIRECT_KEY)
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    const path = url.pathname.replace(/\/$/, '')
    if (path.endsWith('/upstox/callback')) url.pathname = '/'
    const next = url.pathname + url.search + url.hash
    window.history.replaceState({}, '', next || '/')
  } catch (_) {}
}

export async function exchangeUpstoxAuthCode(supabaseAccessToken, code) {
  const res = await fetch('/api/upstox-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAccessToken}`,
    },
    body: JSON.stringify({ code, redirect_uri: upstoxRedirectUri() }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upstox connect failed (${res.status})`)
  if (!data.connected) throw new Error('Upstox connection was not saved')
  try { sessionStorage.removeItem(UPSTOX_OAUTH_REDIRECT_KEY) } catch (_) {}
  return data
}

async function brokerSessionRequest(method = 'GET', payload) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in to Lakshmimata first.')
  const res = await fetch('/api/upstox-session', {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upstox session failed (${res.status})`)
  return data
}

export function readUpstoxConnection() {
  return brokerSessionRequest('GET')
}

export function savePastedUpstoxToken(accessToken) {
  return brokerSessionRequest('POST', { access_token: accessToken })
}

export function disconnectUpstox() {
  return brokerSessionRequest('DELETE')
}
