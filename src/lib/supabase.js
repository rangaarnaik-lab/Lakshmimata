import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

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
