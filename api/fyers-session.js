import {
  authenticatedBrokerContext,
  connectionStatus,
  deleteBrokerToken,
  getBrokerRow,
  sendJson,
  setCors,
} from './_lib/brokerStore.js'

export async function handleFyersSessionRequest(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  let context
  try {
    context = await authenticatedBrokerContext(req)
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message })
    return
  }

  try {
    if (req.method === 'GET') {
      const row = await getBrokerRow(context.db, context.user.id, 'fyers')
      sendJson(res, 200, connectionStatus(row, 'fyers'))
      return
    }

    if (req.method === 'DELETE') {
      await deleteBrokerToken(context.db, context.user.id, 'fyers')
      sendJson(res, 200, { ok: true, connected: false, broker: 'fyers' })
      return
    }

    sendJson(res, 405, { error: 'GET or DELETE only' })
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || 'Fyers session request failed' })
  }
}

export default async function handler(req, res) {
  await handleFyersSessionRequest(req, res)
}
