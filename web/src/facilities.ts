// Pure helpers for the facility views (FacilityViews.tsx). Self-contained, with .ts imports, so
// `node --test test/facilities.test.ts` can load it without a bundler.

// Mirrors pipeline/facilities.py. Files hold what a facility reported to the state and to EPA, plus replayed nights
// where its own report matched. They never list nights where it was merely upwind.
export const INDEX_SCHEMA = 'plume-witness.facilities-index/v1'
export const FACILITY_SCHEMA = 'plume-witness.facility/v1'
export const REGISTRY_ID = /^\d{12}$/

export interface IndexRow {
  id: string
  name: string
  address: string
  distance_km: number
  nearest_monitor: string
  reports: number
  tri_years: number
  matched_nights: number
}

export interface FacilityIndex {
  coverage: { detail_pages_cached: number; placed_on_a_major: number; placed_elsewhere: number; not_placed: number }
  caveats: string[]
  facilities: IndexRow[]
}

export interface StateReport {
  incident: string
  event_type: string
  start_local: string
  end_local: string
  benzene_lbs: number
  butadiene_lbs: number
  cause_excerpt: string
  cause_withheld?: boolean
  url: string
}

export interface TriYear { stack_lbs: number | null; fugitive_lbs: number | null; total_lbs: number | null }

export interface MatchedNight {
  night_id: string
  date: string
  hour_cst: number
  monitor: string
  compound: string
  value_ppb: number
  incident: string
  distance_km: number
  bearing_deg: number
}

export interface FacilityFile {
  registry_id: string
  name: string
  address: string
  distance_km: number
  nearest_monitor: string
  echo_url: string
  reports_to_state: { source: string; years: string[]; count: number; reports: StateReport[] }
  reports_to_epa: {
    status: string
    reason: string | null
    years: Record<string, Record<string, TriYear>>
    source: string
    note: string
  }
  matched_nights: MatchedNight[]
  caveats: string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseIndex(raw: unknown): FacilityIndex {
  if (!isObj(raw) || raw.schema !== INDEX_SCHEMA || !Array.isArray(raw.facilities)) {
    throw new Error(`facilities/index.json is not ${INDEX_SCHEMA}. Re-run \`uv run python -m pipeline.facilities\`.`)
  }
  raw.facilities.forEach((r, i) => {
    if (!isObj(r) || typeof r.id !== 'string' || !REGISTRY_ID.test(r.id) || typeof r.name !== 'string' || typeof r.reports !== 'number') {
      throw new Error(`facilities/index.json row ${i} is malformed. Re-run \`uv run python -m pipeline.facilities\`.`)
    }
  })
  return raw as unknown as FacilityIndex
}

export function parseFacility(raw: unknown, id: string): FacilityFile {
  if (!isObj(raw) || raw.schema !== FACILITY_SCHEMA || raw.registry_id !== id || !isObj(raw.reports_to_state)
    || !Array.isArray(raw.reports_to_state.reports) || !isObj(raw.reports_to_epa) || !Array.isArray(raw.matched_nights)) {
    throw new Error(`facilities/${id}.json is not a ${FACILITY_SCHEMA} file for that facility.`)
  }
  return raw as unknown as FacilityFile
}

/** Every whitespace-separated word of the query must appear in the name, address, id or nearest monitor. */
export function searchFacilities(rows: IndexRow[], query: string): IndexRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter((r) => {
    const hay = `${r.name} ${r.address} ${r.id} ${r.nearest_monitor}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const facilityHref = (id: string, base = ''): string => `${base}?view=facility&id=${encodeURIComponent(id)}`
export const facilitiesHref = (base = '', q = ''): string => `${base}?view=facilities${q ? `&q=${encodeURIComponent(q)}` : ''}`

export const lbs = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'no number given' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} lb`

/** "2024-06-06T06:30" -> "2024-06-06 06:30" (local time at the facility, as TCEQ publishes it). */
export const localTime = (s: string): string => s.replace('T', ' ')

// EPA registers names in capitals. Display only: the registered name stays on the facility page and in citations.
// kn: acronym and brand lists cover the 2024-25 index; a new acronym renders title-cased until it is added here.
const KEEP_UPPER = new Set([
  'LLC', 'LP', 'LTD', 'USA', 'US', 'TX', 'II', 'III', 'IV', 'ACCP', 'AES', 'ASU', 'BASF', 'EGU', 'EO', 'EPOLP', 'FC', 'GCL',
  'GE', 'HRM', 'KMCC', 'LBC', 'LCY', 'MB', 'MCA', 'NGL', 'PCI', 'PVA', 'PVC', 'PWE', 'RST', 'SI', 'SJRR', 'SMR', 'TECO', 'TM',
  'VCM', 'WWTP',
])
const SMALL = new Set(['AND', 'OF', 'THE', 'AT', 'FOR', 'IN', 'ON'])
const BRANDS: Record<string, string> = { EXXONMOBIL: 'ExxonMobil', LYONDELLBASELL: 'LyondellBasell', TOTALENERGIES: 'TotalEnergies', INEOS: 'INEOS' }
const cap = (w: string): string => w.charAt(0) + w.slice(1).toLowerCase()

function word(w: string, first: boolean): string {
  if (BRANDS[w]) return BRANDS[w]
  if (KEEP_UPPER.has(w) || w.length === 1) return w
  if (!first && SMALL.has(w)) return w.toLowerCase()
  if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase()
  if (/\d/.test(w) || !/[A-Z]/.test(w)) return w
  if (/^MC[A-Z]{2,}$/.test(w)) return 'Mc' + cap(w.slice(2))
  return cap(w)
}

/** "INEOS AMERICAS PASADENA SITE" -> "INEOS Americas Pasadena Site". Names that are not all capitals pass through. */
export function displayName(name: string): string {
  if (/[a-z]/.test(name)) return name
  return name.split(' ').map((w, i) => w.split('-').map((part) => word(part, i === 0)).join('-')).join(' ')
}
