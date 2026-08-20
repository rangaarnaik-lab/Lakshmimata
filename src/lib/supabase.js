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

/**
 * Mark this browser as the account's one active device. A newer login
 * overwrites the row, which lets an already-open older browser detect that
 * it has been replaced instead of waiting for its JWT to expire.
 */
export async function claimCurrentDevice(session) {
  const current = await resolvedAuthSession(session)
  const sessionId = authSessionId(current)
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
  return { ok: true, userId, sessionId }
}

/**
 * Check whether this browser still owns the user's active-session row.
 * Missing rows are claimed once to migrate users who were already signed in
 * when single-device enforcement was introduced.
 */
export async function verifyCurrentDevice(session) {
  const current = await resolvedAuthSession(session)
  const sessionId = authSessionId(current)
  const userId = current?.user?.id
  if (!sessionId || !userId) return { valid: false }
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
    const claimed = await claimCurrentDevice(current)
    return { valid: claimed.ok, unavailable: claimed.unavailable }
  }
  return { valid: data.session_id === sessionId, userId, sessionId }
}

export async function currentDeviceIdentity(session) {
  const current = await resolvedAuthSession(session)
  return {
    userId: current?.user?.id || null,
    sessionId: authSessionId(current),
  }
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
