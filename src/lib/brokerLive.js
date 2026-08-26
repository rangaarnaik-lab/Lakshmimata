import { readUpstoxConnection } from './upstoxOAuth'
import { readFyersConnection } from './fyersOAuth'

export async function readLiveBrokerConnection() {
  const [upstox, fyers] = await Promise.all([
    readUpstoxConnection().catch(() => ({ connected: false })),
    readFyersConnection().catch(() => ({ connected: false })),
  ])
  const connected = !!(upstox.connected || fyers.connected)
  let liveBroker = null
  if (upstox.connected && fyers.connected) {
    liveBroker = new Date(fyers.updated_at || 0) >= new Date(upstox.updated_at || 0) ? 'fyers' : 'upstox'
  } else if (fyers.connected) liveBroker = 'fyers'
  else if (upstox.connected) liveBroker = 'upstox'
  return { connected, liveBroker, upstoxConnected: !!upstox.connected, fyersConnected: !!fyers.connected }
}
