import { sendJson, setCors } from './_lib/brokerStore.js'
import { fyersCredentials } from './_lib/fyers.js'

// App id is "<id>-<appType>", e.g. ABCD1234-100. Fyers rejects a bare id with
// the same opaque "invalid appId" page it uses for an unregistered redirect.
const FYERS_APP_ID_RE = /^[A-Za-z0-9]+-\d{3}$/

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
  sendJson(res, 200, fyersOAuthPublicConfig())
}

export default async function handler(req, res) {
  await handleFyersOAuthConfigRequest(req, res)
}
