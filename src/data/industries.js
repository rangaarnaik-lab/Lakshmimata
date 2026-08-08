// Static NSE industry lookup (from all-stocks.csv) + peer-group fixes for
// result-quality ranking. DB/Screener often tags shipbuilders like GRSE as
// "Miscellaneous"; we correct those before industry-peer comparisons.
import INDUSTRY_MAP from './industry-map.json'

const JUNK_INDUSTRY = /^(miscellaneous|other|n\/a|na|—|-)$/i

/** Canonical peer-group labels for result ranking (may differ from raw NSE industry). */
export const PEER_GROUP_OVERRIDES = {
  GRSE: 'Shipping & Defence',
  MAZDOCK: 'Shipping & Defence',
  COCHINSHIP: 'Shipping & Defence',
  UFBL: 'Leisure - Restaurants',
  RBA: 'Leisure - Restaurants',
  COFFEEDAY: 'Leisure - Restaurants',
  DEVYANI: 'Leisure - Restaurants',
  JUBLFOOD: 'Leisure - Restaurants',
  SAPPHIRE: 'Leisure - Restaurants',
  SPECIALITY: 'Leisure - Restaurants',
  WESTLIFE: 'Leisure - Restaurants',
  THELEELA: 'Leisure - Restaurants',
}

/** Map raw industry strings to a shared peer group when appropriate. */
const INDUSTRY_PEER_ALIASES = {
  'Ship Building & Allied Services': 'Shipping & Defence',
  Restaurants: 'Leisure - Restaurants',
  'Hotels & Resorts': 'Hotels & Resorts',
}

export function lookupStaticIndustry(sym) {
  const key = String(sym || '').trim().toUpperCase()
  return INDUSTRY_MAP[key] || null
}

/** Resolved industry for display + peer filters (never "Miscellaneous" when we know better). */
export function resolveIndustry(sym, dbIndustry = null, dbSector = null) {
  const key = String(sym || '').trim().toUpperCase()
  if (PEER_GROUP_OVERRIDES[key]) return PEER_GROUP_OVERRIDES[key]

  let industry = (dbIndustry || '').trim()
  if (!industry || JUNK_INDUSTRY.test(industry)) {
    const stat = lookupStaticIndustry(key)
    if (stat?.industry) industry = stat.industry
  }

  if (industry && INDUSTRY_PEER_ALIASES[industry]) {
    return INDUSTRY_PEER_ALIASES[industry]
  }

  return industry || null
}

export function resolveSector(sym, dbSector = null, resolvedIndustry = null) {
  const key = String(sym || '').trim().toUpperCase()
  const stat = lookupStaticIndustry(key)
  const sector = (dbSector || '').trim()
  if (sector && !JUNK_INDUSTRY.test(sector)) return sector
  if (stat?.sector) return stat.sector
  if (resolvedIndustry === 'Shipping & Defence') return 'Defence'
  if (resolvedIndustry === 'Leisure - Restaurants') return 'Leisure Services'
  return dbSector || null
}

/** Peer-group key used by SectorRankingPanel — same string for all comparable names. */
export function getPeerGroup(sym, industry = null) {
  const key = String(sym || '').trim().toUpperCase()
  if (PEER_GROUP_OVERRIDES[key]) return PEER_GROUP_OVERRIDES[key]
  const ind = industry || resolveIndustry(sym, null)
  if (ind && INDUSTRY_PEER_ALIASES[ind]) return INDUSTRY_PEER_ALIASES[ind]
  return ind
}
