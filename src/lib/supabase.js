import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

function authSessionId(session) {
  try {
    const part = session?.access_token?.split('.')[1]
    if (!part) return null
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded))?.session_id || null
  } catch {
    return null
  }
}

async function resolvedAuthSession(session) {
  if (session?.access_token) return session
  const { data } = await supabase.auth.getSession()
  return data?.session || null
}

const DEVICE_ID_KEY = 'lakshmimata-device-id'

/** Stable per-browser uuid, so this works even without a session_id claim. */
function localDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

/**
 * Who owns the account right now — the browser id first, the token's
 * session_id only when storage is unavailable.
 *
 * Keying on session_id was the wrong identity for "one device": it is absent
 * from some access tokens and it changes whenever the same person signs in
 * again in this same browser, so a token refresh could make a browser look
 * like a different device and sign it out with "signed in on another device"
 * when nothing had replaced it. Coming back from a broker OAuth redirect is
 * the easiest way to hit that, because the round trip through the broker's
 * login page is long enough for a refresh. The uuid below changes only when
 * the user clears storage, which is exactly what one device should mean.
 */
function deviceIdentity(session) {
  return localDeviceId() || authSessionId(session)
}

// Rows written before the identity above changed hold a token session_id, so
// every already-signed-in browser would read as "replaced" exactly once. This
// flag lets a browser rewrite the row in its own terms one time instead of
// signing its user out for a mismatch it did not cause.
const DEVICE_CLAIM_KEY = 'lakshmimata-device-claimed'

function markClaimed() {
  try { localStorage.setItem(DEVICE_CLAIM_KEY, '1') } catch (_) {}
}

function hasEverClaimed() {
  try { return localStorage.getItem(DEVICE_CLAIM_KEY) === '1' } catch { return false }
}

/**
 * Mark this browser as the account's one active device. A newer login
 * overwrites the row, which lets an already-open older browser detect that
 * it has been replaced instead of waiting for its JWT to expire.
 */
export async function claimCurrentDevice(session) {
  const current = await resolvedAuthSession(session)
  const sessionId = deviceIdentity(current)
  const userId = current?.user?.id
  if (!sessionId || !userId) return { ok: false, unavailable: true }
  const { error } = await supabase.from('user_active_sessions').upsert({
    user_id: userId,
    session_id: sessionId,
    activated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) {
    console.warn('claimCurrentDevice:', error.message)
    return { ok: false, unavailable: true }
  }
  markClaimed()
  return { ok: true, userId, sessionId }
}

/**
 * Check whether this browser still owns the user's active-session row.
 *
 * Only a row that exists AND names a different device counts as invalid.
 * Every other outcome — unknown identity, read error, missing row, failed
 * claim — reports valid, because none of them is evidence that another
 * device took the account, and signing someone out on a guess is worse
 * than briefly failing to enforce.
 */
export async function verifyCurrentDevice(session) {
  const current = await resolvedAuthSession(session)
  const sessionId = deviceIdentity(current)
  const userId = current?.user?.id
  if (!sessionId || !userId) return { valid: true, unavailable: true }
  const { data, error } = await supabase
    .from('user_active_sessions')
    .select('session_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    // Keep auth usable until the migration is installed; the existing
    // Supabase refresh-token revocation still provides a fallback.
    console.warn('verifyCurrentDevice:', error.message)
    return { valid: true, unavailable: true }
  }
  if (!data) {
    // No row means nobody else holds the account, so claim it and stay
    // signed in even if that write fails; the next check retries.
    const claimed = await claimCurrentDevice(current)
    return { valid: true, unavailable: !claimed.ok }
  }
  if (data.session_id !== sessionId && !hasEverClaimed()) {
    // First check this browser has ever run: the row was written under the old
    // identity, so adopt it rather than reading it as another device.
    const claimed = await claimCurrentDevice(current)
    if (claimed.ok) return { valid: true, userId, sessionId, adopted: true }
  }
  return { valid: data.session_id === sessionId, userId, sessionId }
}

/**
 * Keep only this browser’s session. Call after a successful sign-in so a
 * login on phone/laptop immediately invalidates sessions on other devices.
 * Requires Auth → Sessions → “Enforce single session per user” (or this
 * alone still revokes other refresh tokens via scope: 'others').
 */
export async function revokeOtherSessions() {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    if (error) console.warn('revokeOtherSessions:', error.message)
  } catch (e) {
    console.warn('revokeOtherSessions:', e?.message || e)
  }
}

/**
 * Fetch the owner's Upstox token from Supabase at runtime.
 * Updated daily by GitHub Actions cron — no redeploy needed.
 * Falls back to the VITE_ env var if Supabase fetch fails.
 */
export async function fetchOwnerToken() {
  try {
    const { data, error } = await supabase
      .from('owner_token')
      .select('token')
      .eq('id', 'owner')
      .single()
    if (error || !data?.token) throw new Error(error?.message || 'No token')
    return data.token
  } catch (e) {
    console.warn('Could not fetch owner token from Supabase:', e.message)
    // Fallback to build-time env var
    return import.meta.env.VITE_OWNER_UPSTOX_TOKEN || ''
  }
}
