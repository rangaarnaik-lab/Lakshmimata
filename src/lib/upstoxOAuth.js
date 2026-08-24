/** Upstox OAuth 2.0 (authorization code). Client secret never ships in the browser. */

export const UPSTOX_OAUTH_STATE_KEY = 'lakshmimata-upstox-oauth-state'

export function upstoxClientId() {
  return (import.meta.env.VITE_UPSTOX_CLIENT_ID || '').trim()
}

export function upstoxOAuthConfigured() {
  return !!upstoxClientId()
}

export function upstoxRedirectUri() {
  const env = (import.meta.env.VITE_UPSTOX_REDIRECT_URI || '').trim()
  if (env) return env
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/upstox/callback`
}

export function startUpstoxOAuth() {
  const clientId = upstoxClientId()
  if (!clientId) {
    throw new Error('Upstox OAuth is not configured. Set VITE_UPSTOX_CLIENT_ID and register the redirect URL in the Upstox developer app.')
  }
  const state = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try { sessionStorage.setItem(UPSTOX_OAUTH_STATE_KEY, state) } catch (_) {}
  const u = new URL('https://api.upstox.com/v2/login/authorization/dialog')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', upstoxRedirectUri())
  u.searchParams.set('state', state)
  window.location.assign(u.toString())
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
    if (!code && !error) return null
    if (!onPath && !code) return null
    return {
      code,
      state,
      error,
      errorDescription: q.get('error_description'),
    }
  } catch {
    return null
  }
}

export function clearUpstoxOAuthParams() {
  if (typeof window === 'undefined') return
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
  if (!data.access_token) throw new Error('Upstox did not return an access token')
  return data
}
