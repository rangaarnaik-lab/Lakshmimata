import { createHash } from 'node:crypto'

const FYERS_API = 'https://api-t1.fyers.in'
const USER_AGENT = 'Mozilla/5.0 (compatible; Lakshmimata/1.0)'
const QUOTE_BATCH = 50

const INDEX_SYMBOLS = [
  ['nifty 50', 'NSE:NIFTY50-INDEX'],
  ['nifty50', 'NSE:NIFTY50-INDEX'],
  ['nifty', 'NSE:NIFTY50-INDEX'],
  ['bank nifty', 'NSE:NIFTYBANK-INDEX'],
  ['nifty bank', 'NSE:NIFTYBANK-INDEX'],
  ['india vix', 'NSE:INDIAVIX-INDEX'],
  ['midcap 150', 'NSE:NIFTYMIDCAP150-INDEX'],
  ['nifty midcap 150', 'NSE:NIFTYMIDCAP150-INDEX'],
  ['smallcap 250', 'NSE:NIFTYSMLCAP250-INDEX'],
  ['nifty smallcap 250', 'NSE:NIFTYSMLCAP250-INDEX'],
  ['private bank', 'NSE:NIFTYPVTBANK-INDEX'],
  ['pvt bank', 'NSE:NIFTYPVTBANK-INDEX'],
  ['fin nifty', 'NSE:FINNIFTY-INDEX'],
  ['nifty fin service', 'NSE:FINNIFTY-INDEX'],
]

export function fyersCredentials() {
  const appId = String(process.env.FYERS_APP_ID || process.env.FYERS_CLIENT_ID || '').trim()
  const secret = String(process.env.FYERS_SECRET_ID || process.env.FYERS_CLIENT_SECRET || '').trim()
  const redirectUri = String(process.env.FYERS_REDIRECT_URI || '').trim()
  return { appId, secret, redirectUri, configured: !!(appId && secret) }
}

export function fyersAppIdHash(appId, secret) {
  return createHash('sha256').update(`${appId}:${secret}`).digest('hex')
}

export function fyersAuthHeader(appId, token) {
  return `${appId}:${token}`
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function equityFyersSymbol(symbol) {
  const clean = String(symbol || '').trim().toUpperCase()
  if (!clean) return ''
  if (clean.includes(':')) return clean
  return `NSE:${clean}-EQ`
}

export function indexFyersSymbol(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const hit = INDEX_SYMBOLS.find(([alias]) => alias === key)
  if (hit) return hit[1]
  const compact = key.replace(/[^a-z0-9]/g, '').toUpperCase()
  if (!compact) return ''
  return `NSE:${compact}-INDEX`
}

export function toUpstoxShapedQuote(v) {
  if (!v || typeof v !== 'object') return null
  const last = num(v.lp)
  if (last == null || last <= 0) return null
  return {
    last_price: last,
    net_change: num(v.ch),
    volume: num(v.volume),
    ohlc: {
      open: num(v.open_price),
      high: num(v.high_price),
      low: num(v.low_price),
      close: num(v.prev_close_price),
    },
  }
}

async function fyersJson(appId, token, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: fyersAuthHeader(appId, token),
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })
  const json = await response.json().catch(() => ({}))
  if (response.status === 401 || json?.code === -8 || json?.code === -15 || json?.code === -16 || json?.code === -17) {
    const error = new Error(String(json.message || json.emsg || 'Fyers token expired. Reconnect Fyers.'))
    error.status = 401
    error.code = 'fyers_token_expired'
    throw error
  }
  if (!response.ok || (json.s && json.s !== 'ok')) {
    const error = new Error(String(json.message || json.emsg || json.error || `Fyers request failed (${response.status})`))
    error.status = response.status >= 400 ? response.status : 502
    error.code = 'fyers_request_failed'
    error.httpStatus = response.status
    throw error
  }
  return json
}

export async function fetchFyersQuoteMap(appId, token, { symbols = [], indices = [] }) {
  const jobs = []
  for (const symbol of symbols) {
    jobs.push({ label: String(symbol).toUpperCase(), fyers: equityFyersSymbol(symbol) })
  }
  for (const name of indices) {
    const fyers = indexFyersSymbol(name)
    if (fyers) jobs.push({ label: name, fyers })
  }
  const quotes = {}
  for (let i = 0; i < jobs.length; i += QUOTE_BATCH) {
    const chunk = jobs.slice(i, i + QUOTE_BATCH)
    const url = `${FYERS_API}/data/quotes?symbols=${chunk.map(j => encodeURIComponent(j.fyers)).join(',')}`
    const json = await fyersJson(appId, token, url)
    const rows = Array.isArray(json?.d) ? json.d : []
    const byN = new Map(rows.map(row => [String(row?.n || ''), row]))
    for (const job of chunk) {
      const row = byN.get(job.fyers) || rows.find(r => String(r?.n || '') === job.fyers)
      const shaped = toUpstoxShapedQuote(row?.v || row)
      if (shaped) quotes[job.label] = shaped
    }
  }
  return quotes
}

function ymdFromEpoch(sec) {
  const d = new Date(Number(sec) * 1000)
  if (!Number.isFinite(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function isoFromEpoch(sec) {
  const d = new Date(Number(sec) * 1000)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function parseFyersCandle(row, daily) {
  if (!Array.isArray(row) || row.length < 5) return null
  const rawTs = row[0]
  const ts = typeof rawTs === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawTs)
    ? (daily ? rawTs.slice(0, 10) : `${rawTs.slice(0, 10)}T00:00:00+05:30`)
    : (daily ? ymdFromEpoch(rawTs) : isoFromEpoch(rawTs))
  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5]) || 0
  if (!ts || ![open, high, low, close].every(n => Number.isFinite(n) && n > 0)) return null
  return { ts, open, high, low, close, volume }
}

function shiftYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

async function historyRange(appId, token, symbol, resolution, fromYmd, toYmd) {
  const url = new URL(`${FYERS_API}/data/history`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('resolution', resolution)
  url.searchParams.set('date_format', '1')
  url.searchParams.set('range_from', fromYmd)
  url.searchParams.set('range_to', toYmd)
  url.searchParams.set('cont_flag', '1')
  const json = await fyersJson(appId, token, url)
  const daily = resolution === 'D' || resolution === '1D'
  return (Array.isArray(json?.candles) ? json.candles : []).map(row => parseFyersCandle(row, daily)).filter(Boolean)
}

export async function fetchFyersCandles(appId, token, { symbol, segment, unit, fromDate, toDate }) {
  const fyersSymbol = segment === 'index' ? indexFyersSymbol(symbol) : equityFyersSymbol(symbol)
  if (!fyersSymbol) return []
  const resolution = unit === 'minutes' ? '1' : 'D'
  const maxSpan = unit === 'minutes' ? 90 : 360
  const rows = []
  let cursor = fromDate
  while (cursor <= toDate) {
    const chunkTo = shiftYmd(cursor, maxSpan) < toDate ? shiftYmd(cursor, maxSpan) : toDate
    try {
      const part = await historyRange(appId, token, fyersSymbol, resolution, cursor, chunkTo)
      rows.push(...part)
    } catch (error) {
      if (unit === 'minutes' && (error.httpStatus === 400 || error.httpStatus === 404)) break
      throw error
    }
    if (chunkTo >= toDate) break
    cursor = shiftYmd(chunkTo, 1)
  }
  if (segment !== 'index' && unit === 'days' && rows.length < 30) {
    const bse = `BSE:${String(symbol).trim().toUpperCase()}-EQ`
    try {
      const extra = await historyRange(appId, token, bse, 'D', fromDate, toDate)
      if (extra.length > rows.length) return extra
    } catch (_) {}
  }
  return rows
}

export { FYERS_API, USER_AGENT }
