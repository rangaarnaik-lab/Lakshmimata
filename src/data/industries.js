// Static NSE industry lookup (from all-stocks.csv) + peer-group fixes for
// result-quality ranking. DB/Screener often tags shipbuilders like GRSE as
// "Miscellaneous"; we correct those before industry-peer comparisons.
//
// Pharma catch-all "Bulk Drugs & Formln" mixes CIPLA with IOLCP — peer
// ranking MUST split Formulations vs Bulk/API so result peers stay comparable.
import INDUSTRY_MAP from './industry-map.json'

const JUNK_INDUSTRY = /^(miscellaneous|other|n\/a|na|—|-)$/i
const PHARMA_CATCHALL = /Bulk Drugs\s*&\s*Form/i

/** True for catch-all labels that must never be used as result-ranking peer groups. */
export function isJunkIndustry(label) {
  if (label == null || label === '') return true
  return JUNK_INDUSTRY.test(String(label).trim())
}

const PHARMA_FORMULATIONS = 'Pharmaceuticals - Formulations'
const PHARMA_BULK_API = 'Pharmaceuticals - Bulk Drugs / API'

/** Finished-dosage / branded pharma — never peer-rank with pure API/bulk names. */
const PHARMA_FORMULATION_SYMS = new Set([
  'AJANTPHARM','ALKEM','ALIVUS','AMRUTANJAN','APLLTD','AUROPHARMA','BAJAJHCARE',
  'BIOCON','BLISSGVS','BROOKS','CAPLIPOINT','CIPLA','DRREDDY','EMCURE','ERIS',
  'FDC','GLAND','GLENMARK','GUFICBIO','INDOCO','IPCALAB','JAGSNPHARM','JBCHEPHARM',
  'LUPIN','MANKIND','MARKSANS','NATCOPHARM','ORCHPHARMA','PANACEABIO','PPLPHARMA',
  'RPGLIFE','RUBICON','SUNPHARMA','THEMISMED','TORNTPHARM','UNICHEMLAB','WOCKPHARMA',
  'ZOTA','ZYDUSLIFE','ALBERTDAVD','MEDICO','STAR','BAFNAPH','HESTERBIO','KILITCH',
  'LINCOLN','MEDICAMEQ','SAIPARENT','SENORES','SHILPAMED','VENUSREM','WINDLAS',
])

/** API / bulk drugs / CDMO / pharma-chem — IOLCP belongs here, not with CIPLA. */
const PHARMA_BULK_API_SYMS = new Set([
  'AAREYDRUGS','AARTIDRUGS','AARTIPHARM','ACUTAAS','ADVENZYMES','AKUMS','ALPA',
  'AMANTA','ANTHEM','ANUHPHR','BALAXI','BALPHARMA','BETA','BLUEJET','COHANCE',
  'CONCORDBIO','CORONA','DCAL','DIVISLAB','GRANULES','GUJTHEM','HALEOSLABS','HIKAL',
  'INDSWFTLAB','INNOVACAP','IOLCP','JUBLPHARMA','KOPRAN','KPL','KREBSBIO','LASA',
  'LAURUSLABS','LYKALABS','MANGALAM','MOREPENLAB','NATCAPSUQ','NECLIFE','NEULANDLAB',
  'NGLFINE','ONESOURCE','ORTINGLOBE','PAR','SAILIFE','SAKAR','SIGACHI','SMSPHARMA',
  'SOLARA','SUDEEPPHRM','SUPRIYA','SYNCOMF','VAISHALI','VALIANTLAB','VINEETLAB',
  'VIVIMEDLAB','VIYASH','WANBURY','ZIMLAB',
])

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
  IOLCP: PHARMA_BULK_API,
}

/** Map raw industry strings to a shared peer group when appropriate. */
const INDUSTRY_PEER_ALIASES = {
  'Ship Building & Allied Services': 'Shipping & Defence',
  Restaurants: 'Leisure - Restaurants',
  'Hotels & Resorts': 'Hotels & Resorts',
  'Pharmaceuticals - Indian - Bulk Drugs': PHARMA_BULK_API,
  'Pharmaceuticals - Indian - Formulations': PHARMA_FORMULATIONS,
}

function pharmaPeerBucket(sym) {
  const key = String(sym || '').trim().toUpperCase()
  if (PHARMA_FORMULATION_SYMS.has(key)) return PHARMA_FORMULATIONS
  if (PHARMA_BULK_API_SYMS.has(key)) return PHARMA_BULK_API
  return null
}

function normalizeIndustryLabel(industry, sym) {
  if (!industry) return null
  if (INDUSTRY_PEER_ALIASES[industry]) return INDUSTRY_PEER_ALIASES[industry]
  // NSE catch-all mixes CIPLA + IOLCP — never keep it as a peer key
  if (PHARMA_CATCHALL.test(industry)) {
    return pharmaPeerBucket(sym) || PHARMA_BULK_API
  }
  return industry
}

export function lookupStaticIndustry(sym) {
  const key = String(sym || '').trim().toUpperCase()
  return INDUSTRY_MAP[key] || null
}

/** Resolved industry for display + peer filters (never "Miscellaneous" when we know better). */
export function resolveIndustry(sym, dbIndustry = null, dbSector = null) {
  const key = String(sym || '').trim().toUpperCase()
  if (PEER_GROUP_OVERRIDES[key]) return PEER_GROUP_OVERRIDES[key]

  const pharma = pharmaPeerBucket(key)
  if (pharma) return pharma

  let industry = (dbIndustry || '').trim()
  if (!industry || isJunkIndustry(industry)) {
    const stat = lookupStaticIndustry(key)
    if (stat?.industry) industry = stat.industry
  }

  const resolved = normalizeIndustryLabel(industry, key) || industry || null
  // Never surface "Other" / Miscellaneous — callers treat null as "no peers".
  if (!resolved || isJunkIndustry(resolved)) return null
  return resolved
}

export function resolveSector(sym, dbSector = null, resolvedIndustry = null) {
  const key = String(sym || '').trim().toUpperCase()
  const stat = lookupStaticIndustry(key)
  const sector = (dbSector || '').trim()
  if (sector && !isJunkIndustry(sector)) return sector
  if (stat?.sector) return stat.sector
  if (resolvedIndustry === 'Shipping & Defence') return 'Defence'
  if (resolvedIndustry === 'Leisure - Restaurants') return 'Leisure Services'
  if (resolvedIndustry === PHARMA_FORMULATIONS || resolvedIndustry === PHARMA_BULK_API) {
    return 'Healthcare'
  }
  // Prefer null over "Other" so UI can hide catch-all groupings.
  if (dbSector && !isJunkIndustry(dbSector)) return dbSector
  return null
}

/** Peer-group key used by SectorRankingPanel — same string for all comparable names. */
export function getPeerGroup(sym, industry = null) {
  // Always go through resolveIndustry so junk DB labels ("Other") fall through
  // to the static map / overrides instead of becoming a mega peer bucket.
  return resolveIndustry(sym, industry)
}
