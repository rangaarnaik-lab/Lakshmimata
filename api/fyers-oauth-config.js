import { authenticatedBrokerContext, sendJson, setCors } from './_lib/brokerStore.js'
import { fyersCredentials } from './_lib/fyers.js'

// App id is "<id>-<appType>", e.g. ABCD1234-100. Fyers rejects a bare id with
// the same opaque "invalid appId" page it uses for an unregistered redirect.
const FYERS_APP_ID_RE = /^[A-Za-z0-9]+-\d{3}$/

// A self-use app on myapi.fyers.in only authorises the account that created it.
// Everyone else clears the Fyers login screen and is then bounced to a bare
// "invalid appId" page. Until Fyers converts this into a common (third-party)
// app, keep the app id away from accounts it cannot work for. Leave the env var
// unset to offer Fyers to everyone.
function fyersAllowedEmails() {
  return String(process.env.FYERS_ALLOWED_EMAILS || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function fyersOAuthPublicConfig() {
  const { appId, secret, redirectUri } = fyersCredentials()
  const problems = []
  if (!appId) problems.push('FYERS_APP_ID is not set')
  else if (!FYERS_APP_ID_RE.test(appId)) {
    problems.push('FYERS_APP_ID must be the app id plus app type, like ABCD1234-100')
  }
  if (!secret) problems.push('FYERS_SECRET_ID is not set')
  // Deliberately not inferred from the request host. Fyers only accepts the
  // redirect registered on the app, so a host-derived guess sends the user to
  // an "invalid appId" page instead of failing here with a readable reason.
  if (!redirectUri) problems.push('FYERS_REDIRECT_URI is not set')
  return {
    configured: problems.length === 0,
    client_id: appId || null,
    redirect_uri: redirectUri || null,
    reason: problems.length ? problems.join('; ') : null,
  }
}

export async function handleFyersOAuthConfigRequest(req, res) {
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

  const allowlist = fyersAllowedEmails()
  if (!allowlist.length) {
    sendJson(res, 200, { ...fyersOAuthPublicConfig(), allowed: true })
    return
  }

  // Read the email off the verified Supabase JWT, not the request body, so the
  // gate cannot be talked around by editing a payload.
  let email = ''
  try {
    const { user } = await authenticatedBrokerContext(req)
    email = String(user?.email || '').trim().toLowerCase()
  } catch (_) {
    // Signed out, or an expired session: treated as not allowed below.
  }

  if (email && allowlist.includes(email)) {
    sendJson(res, 200, { ...fyersOAuthPublicConfig(), allowed: true })
    return
  }

  sendJson(res, 200, {
    configured: false,
    client_id: null,
    redirect_uri: null,
    reason: 'Fyers login is limited to approved accounts on this deployment.',
    allowed: false,
  })
}

export default async function handler(req, res) {
  await handleFyersOAuthConfigRequest(req, res)
}
