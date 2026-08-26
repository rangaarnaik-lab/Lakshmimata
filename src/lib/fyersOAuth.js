/** Fyers OAuth v3. App secret never ships in the browser. */
import { supabase } from './supabase'

export const FYERS_OAUTH_STATE_KEY = 'lakshmimata-fyers-oauth-state'
const FYERS_OAUTH_REDIRECT_KEY = 'lakshmimata-fyers-oauth-redirect'
const FYERS_PENDING_KEY = 'lakshmimata-fyers-pending-oauth'
const FYERS_STEP_KEY = 'lakshmimata-fyers-last-step'

export function noteFyersStep(step) {
  try { localStorage.setItem(FYERS_STEP_KEY, JSON.stringify({ step, at: Date.now() })) } catch (_) {}
}

export function readFyersStep() {
  try {
    const raw = localStorage.getItem(FYERS_STEP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

let cachedConfig = null

export async function fetchFyersOAuthConfig() {
  if (cachedConfig) return cachedConfig
  // no-store: a tab opened before the server had its Fyers env vars would
  // otherwise keep replaying a cached "not configured" response.
  const res = await fetch('/api/fyers-oauth-config', { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Fyers config failed (${res.status})`)
  cachedConfig = {
    configured: !!data.configured && !!data.client_id,
    clientId: String(data.client_id || '').trim(),
    redirectUri: String(data.redirect_uri || '').trim(),
    reason: String(data.reason || '').trim(),
  }
  return cachedConfig
}

export function fyersRedirectUri() {
  try {
    const stored = sessionStorage.getItem(FYERS_OAUTH_REDIRECT_KEY) || localStorage.getItem(FYERS_OAUTH_REDIRECT_KEY)
    if (stored) return stored
  } catch (_) {}
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/fyers/callback`
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

export async function startFyersOAuth() {
  const cfg = await fetchFyersOAuthConfig()
  if (!cfg.configured || !cfg.clientId || !cfg.redirectUri) {
    throw new Error(cfg.reason
      ? `Fyers login is not configured: ${cfg.reason}`
      : 'Fyers login is not configured. Set FYERS_APP_ID, FYERS_SECRET_ID and FYERS_REDIRECT_URI on the server.')
  }
  const redirectUri = cfg.redirectUri
  // Fyers only honours the redirect registered on the app. Opening the site on
  // any other host (custom domain, www, a preview build) sends an unregistered
  // redirect and Fyers answers with a bare "invalid appId" page, so name the
  // problem here instead.
  if (typeof window !== 'undefined') {
    let expectedOrigin = ''
    try { expectedOrigin = new URL(redirectUri).origin } catch (_) {}
    if (expectedOrigin && window.location.origin !== expectedOrigin) {
      throw new Error(
        `Open ${expectedOrigin} to connect Fyers. This tab is on ${window.location.origin}, `
        + 'which is not the redirect URL registered with Fyers.')
    }
  }
  const state = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    sessionStorage.setItem(FYERS_OAUTH_STATE_KEY, state)
    sessionStorage.setItem(FYERS_OAUTH_REDIRECT_KEY, redirectUri)
    localStorage.setItem(FYERS_OAUTH_STATE_KEY, state)
    localStorage.setItem(FYERS_OAUTH_REDIRECT_KEY, redirectUri)
  } catch (_) {}
  const u = new URL('https://api-t1.fyers.in/api/v3/generate-authcode')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('state', state)
  // Recorded so "Last connect attempt" shows the exact appId and redirect that
  // Fyers rejected; its own error page names neither.
  noteFyersStep(`sending to Fyers · appId ${cfg.clientId} · redirect ${redirectUri}`)
  window.location.assign(u.toString())
}

export function readFyersOAuthCallback() {
  if (typeof window === 'undefined') return null
  try {
    const q = new URLSearchParams(window.location.search)
    const path = (window.location.pathname || '').replace(/\/$/, '')
    // Mirror of the guard in upstoxOAuth: an Upstox callback carries a bare
    // ?code= that we would otherwise treat as a Fyers auth_code, raising a
    // spurious "Fyers login could not be verified" during an Upstox connect.
    if (path.endsWith('/upstox/callback')) return null
    const code = q.get('auth_code') || q.get('code')
    const state = q.get('state')
    const error = q.get('error') || (q.get('s') === 'error' ? (q.get('message') || 'error') : null)
    const onPath = path.endsWith('/fyers/callback')
    if (code || error) {
      const payload = { code, state, error, errorDescription: q.get('message') || q.get('error_description') }
      if (code && state) storageSet(FYERS_PENDING_KEY, JSON.stringify({ code, state, at: Date.now() }))
      return payload
    }
    const raw = storageGet(FYERS_PENDING_KEY)
    if (!raw) return null
    const pending = JSON.parse(raw)
    if (!pending?.code || Date.now() - Number(pending.at || 0) > 10 * 60 * 1000) {
      storageRemove(FYERS_PENDING_KEY)
      return null
    }
    if (!onPath && !pending.code) return null
    return { code: pending.code, state: pending.state, error: null, errorDescription: null }
  } catch {
    return null
  }
}

export function hasPendingFyersOAuth() {
  return !!readFyersOAuthCallback()?.code
}

export function expectedFyersOAuthState() {
  return storageGet(FYERS_OAUTH_STATE_KEY)
}

export function clearFyersOAuthParams() {
  if (typeof window === 'undefined') return
  storageRemove(FYERS_PENDING_KEY)
  storageRemove(FYERS_OAUTH_STATE_KEY)
  storageRemove(FYERS_OAUTH_REDIRECT_KEY)
  try {
    const url = new URL(window.location.href)
    ;['auth_code', 'code', 'state', 'error', 'error_description', 'message', 's'].forEach(k => url.searchParams.delete(k))
    const path = url.pathname.replace(/\/$/, '')
    if (path.endsWith('/fyers/callback')) url.pathname = '/'
    const next = url.pathname + url.search + url.hash
    window.history.replaceState({}, '', next || '/')
  } catch (_) {}
}

export async function exchangeFyersAuthCode(supabaseAccessToken, code) {
  const res = await fetch('/api/fyers-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAccessToken}`,
    },
    body: JSON.stringify({ code, redirect_uri: fyersRedirectUri() }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Fyers connect failed (${res.status})`)
  if (!data.connected) throw new Error('Fyers connection was not saved')
  try { sessionStorage.removeItem(FYERS_OAUTH_REDIRECT_KEY) } catch (_) {}
  return data
}

export async function readFyersConnection() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in to Lakshmimata first.')
  const res = await fetch('/api/fyers-session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Fyers session failed (${res.status})`)
  return data
}

export async function disconnectFyers() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sign in to Lakshmimata first.')
  const res = await fetch('/api/fyers-session', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Fyers disconnect failed (${res.status})`)
  return data
}
