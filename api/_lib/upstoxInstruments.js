/**
 * Upstox identifies instruments by segment + ISIN ("NSE_EQ|INE002A01018"),
 * not by trading symbol, so every symbol has to be resolved to a key first.
 *
 * Primary source is the public instrument master (no auth, one download per
 * warm instance). The authenticated Search API covers misses and the case
 * where the asset host is unreachable.
 */
import { gunzipSync } from 'node:zlib'

const NSE_MASTER_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz'
const MASTER_TTL_MS = 12 * 60 * 60 * 1000

const equityKeys = new Map()
const equityIsins = new Map()
const indexKeys = new Map()
const unresolved = new Map()
const UNRESOLVED_TTL_MS = 10 * 60 * 1000

let masterLoadedAt = 0
let masterPromise = null

const INDEX_ALIASES = {
  'nifty 50': ['Nifty 50'],
  'nifty50': ['Nifty 50'],
  'nifty': ['Nifty 50'],
  'bank nifty': ['Nifty Bank', 'Nifty Bank'],
  'nifty bank': ['Nifty Bank'],
  'india vix': ['India VIX'],
  'midcap 150': ['Nifty Midcap 150', 'NIFTY MIDCAP 150'],
  'nifty midcap 150': ['Nifty Midcap 150', 'NIFTY MIDCAP 150'],
  'smallcap 250': ['Nifty Smallcap 250', 'NIFTY SMLCAP 250'],
  'nifty smallcap 250': ['Nifty Smallcap 250', 'NIFTY SMLCAP 250'],
  'private bank': ['Nifty Private Bank'],
  'pvt bank': ['Nifty Private Bank'],
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizeIndexName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function loadMaster() {
  const response = await fetch(NSE_MASTER_URL)
  if (!response.ok) throw new Error(`instrument master ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const rows = JSON.parse(gunzipSync(buffer).toString('utf8'))
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.instrument_key) continue
    if (row.segment === 'NSE_EQ' && row.instrument_type === 'EQ' && row.trading_symbol) {
      const symbol = normalizeSymbol(row.trading_symbol)
      equityKeys.set(symbol, row.instrument_key)
      if (row.isin) equityIsins.set(symbol, row.isin)
    } else if (row.segment === 'NSE_INDEX') {
      const label = row.trading_symbol || row.name
      if (label) indexKeys.set(normalizeIndexName(label), row.instrument_key)
    }
  }
  masterLoadedAt = Date.now()
}

async function ensureMaster() {
  if (equityKeys.size && Date.now() - masterLoadedAt < MASTER_TTL_MS) return true
  if (!masterPromise) {
    masterPromise = loadMaster()
      .catch((error) => {
        console.warn('Upstox instrument master unavailable:', error?.message || error)
        return null
      })
      .finally(() => { masterPromise = null })
  }
  await masterPromise
  return equityKeys.size > 0
}

async function searchInstrument(token, query, segments) {
  const url = new URL('https://api.upstox.com/v2/instruments/search')
  url.searchParams.set('query', query)
  url.searchParams.set('exchanges', 'NSE')
  url.searchParams.set('segments', segments)
  url.searchParams.set('records', '30')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return []
  return Array.isArray(json?.data) ? json.data : []
}

function recentlyUnresolved(cacheKey) {
  const at = unresolved.get(cacheKey)
  if (!at) return false
  if (Date.now() - at > UNRESOLVED_TTL_MS) {
    unresolved.delete(cacheKey)
    return false
  }
  return true
}

/** Instrument key for an NSE cash-segment symbol, or null when there is no match. */
export async function resolveEquityKey(token, symbol) {
  const clean = normalizeSymbol(symbol)
  if (!clean) return null
  if (equityKeys.has(clean)) return equityKeys.get(clean)
  if (recentlyUnresolved(`EQ:${clean}`)) return null

  await ensureMaster()
  if (equityKeys.has(clean)) return equityKeys.get(clean)

  const results = await searchInstrument(token, clean, 'EQ')
  const match = results.find(r => r.segment === 'NSE_EQ' && normalizeSymbol(r.trading_symbol) === clean)
  if (match?.instrument_key) {
    equityKeys.set(clean, match.instrument_key)
    if (match.isin) equityIsins.set(clean, match.isin)
    return match.instrument_key
  }
  unresolved.set(`EQ:${clean}`, Date.now())
  return null
}

/**
 * BSE listing for the same security. Several names in the scan universe are
 * BSE-listed with almost no NSE history, so the NSE key alone charts nothing.
 */
export async function resolveBseEquityKey(token, symbol) {
  const clean = normalizeSymbol(symbol)
  if (!clean) return null
  const isin = equityIsins.get(clean)
  if (isin) return `BSE_EQ|${isin}`

  const results = await searchInstrument(token, clean, 'EQ')
  const bse = results.find(r => r.segment === 'BSE_EQ' && normalizeSymbol(r.trading_symbol) === clean)
    || results.find(r => r.segment === 'BSE_EQ')
  return bse?.instrument_key || null
}

/** Resolve many symbols at once; returns a Map of symbol -> instrument key. */
export async function resolveEquityKeys(token, symbols) {
  const wanted = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))]
  const out = new Map()
  if (!wanted.length) return out

  const missing = wanted.filter(s => !equityKeys.has(s))
  if (missing.length) await ensureMaster()

  const stillMissing = []
  for (const symbol of wanted) {
    const key = equityKeys.get(symbol)
    if (key) out.set(symbol, key)
    else if (!recentlyUnresolved(`EQ:${symbol}`)) stillMissing.push(symbol)
  }

  // Only symbols the master file does not carry fall back to the search API,
  // so a normal scan costs zero extra Upstox calls.
  for (const symbol of stillMissing.slice(0, 25)) {
    const key = await resolveEquityKey(token, symbol)
    if (key) out.set(symbol, key)
  }
  return out
}

/** Instrument key for an index label such as "Nifty 50", "Metal", or "Bank Nifty". */
export async function resolveIndexKey(token, name) {
  const raw = String(name || '').trim()
  if (!raw) return null
  const candidates = [raw, ...(INDEX_ALIASES[normalizeIndexName(raw)] || [])]
  if (!/^nifty\b/i.test(raw) && !/^india vix$/i.test(raw) && !/^bank nifty$/i.test(raw)) {
    candidates.push(`Nifty ${raw}`)
  }
  if (/^bank nifty$/i.test(raw)) candidates.push('Nifty Bank')

  const lookup = (label) => indexKeys.get(normalizeIndexName(label))
  for (const candidate of candidates) {
    const hit = lookup(candidate)
    if (hit) return hit
  }

  await ensureMaster()
  for (const candidate of candidates) {
    const hit = lookup(candidate)
    if (hit) return hit
  }

  for (const candidate of candidates) {
    const results = await searchInstrument(token, candidate, 'INDEX')
    const wanted = normalizeIndexName(candidate)
    const match = results.find(r => r.segment === 'NSE_INDEX'
      && (normalizeIndexName(r.trading_symbol) === wanted || normalizeIndexName(r.name) === wanted))
      || results.find(r => r.segment === 'NSE_INDEX')
    if (match?.instrument_key) {
      indexKeys.set(normalizeIndexName(raw), match.instrument_key)
      indexKeys.set(normalizeIndexName(candidate), match.instrument_key)
      return match.instrument_key
    }
  }
  return null
}

export async function resolveIndexKeys(token, names) {
  const wanted = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))]
  const out = new Map()
  if (!wanted.length) return out
  await ensureMaster()
  for (const name of wanted) {
    const key = await resolveIndexKey(token, name)
    if (key) out.set(name, key)
  }
  return out
}
