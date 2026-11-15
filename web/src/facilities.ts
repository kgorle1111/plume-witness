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
  coverage: { search_rows?: number; detail_pages_cached: number; placed_on_a_major: number; placed_elsewhere: number; not_placed: number }
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

// Whole pounds from 10 lb up (the facility's own estimate; "8,469.743 lb" claims a precision it does not have), one
// decimal from 1 lb, two significant digits below that so a small release never reads as "0 lb".
export const lbs = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return 'no number given'
  const opts: Intl.NumberFormatOptions = n >= 10 ? { maximumFractionDigits: 0 } : n >= 1 ? { maximumFractionDigits: 1 } : { maximumSignificantDigits: 2 }
  return `${n.toLocaleString('en-US', opts)} lb`
}

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

/** The list pages at this many cards, like the spikes log: 191 cards at once made a 57-screen phone page. */
export const PAGE_SIZE = 50

/** A query echoed back in "No facility matches …", cut so a pasted paragraph cannot widen the page. */
export const clipQuery = (q: string, max = 60): string => (q.length > max ? `${q.slice(0, max - 1)}…` : q)

// The eight Houston monitors a facility can be nearest to (spikes.json site_id), so a facility page can link to that
// monitor's spikes. test/facilities.test.ts checks this against facilities/index.json and spikes.json.
export const MONITOR_SITES: Readonly<Record<string, string>> = {
  'Channelview': '48_201_0026',
  'Clinton': '48_201_1035',
  'Galena Park': '48_201_0057',
  'HRM-16 Deer Park': '48_201_1614',
  'HRM-3 Haden Road': '48_201_0803',
  'Houston Milby Park': '48_201_0069',
  'Lynchburg Ferry': '48_201_1015',
  'Manchester East Ave N': '48_201_0307',
}

/** Past spikes filtered to one monitor, or null for a monitor the log does not cover. */
export const monitorSpikesHref = (monitor: string, base = ''): string | null =>
  MONITOR_SITES[monitor] ? `${base}?view=spikes&site=${MONITOR_SITES[monitor]}` : null

/** A matched night opens on its Check step, without the globe intro (about 9 MB of tiles on a desktop). */
export const nightHref = (nightId: string, base = ''): string => `${base}?night=${encodeURIComponent(nightId)}&intro=0#check`

// Raw pipeline values shown in the UI, mapped to string keys so they read in the reader's language.
// A value not listed here renders as the pipeline wrote it, marked lang="en".
const EVENT_TYPE = { 'Emissions Event': 'fx.typeEvent', 'Maintenance': 'fx.typeMaint', 'Excess Opacity': 'fx.typeOpacity' } as const
export const eventTypeKey = (type: string) => (Object.hasOwn(EVENT_TYPE, type) ? EVENT_TYPE[type as keyof typeof EVENT_TYPE] : null)
const TRI_STATUS = { linked_no_benzene_or_butadiene_form: 'fx.triLinkedNone', no_tri_id: 'fx.triNoId' } as const
export const triReasonKey = (status: string) => (Object.hasOwn(TRI_STATUS, status) ? TRI_STATUS[status as keyof typeof TRI_STATUS] : null)
/** "benzene" in prose (the column labels stay capitalised). Facility files say "butadiene" or "1,3-butadiene". */
export const compoundKey = (c: string) => (/butadiene/i.test(c) ? 'fx.cmpButadiene' : /benzene/i.test(c) ? 'fx.cmpBenzene' : null)

/** Why a facility file did not load, kept apart so a dropped connection never reads as "Facility not found". */
export type LoadError = { kind: 'network' } | { kind: 'http'; status: number } | { kind: 'damaged'; detail: string }

export const isLoadError = (e: unknown): e is LoadError =>
  isObj(e) && (e.kind === 'network' || e.kind === 'http' || e.kind === 'damaged')

/** Fetch and parse one JSON file, rejecting with a LoadError. An abort rejects with the abort itself. */
export async function loadJson<T>(url: string, parse: (raw: unknown) => T, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<T> {
  let r: Response
  try {
    r = await fetchFn(url, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw { kind: 'network' } satisfies LoadError
  }
  if (!r.ok) throw { kind: 'http', status: r.status } satisfies LoadError
  let raw: unknown
  try {
    raw = await r.json()
  } catch (e) {
    if (signal?.aborted) throw e
    // A body that is not JSON is damaged data; anything else here is the connection dropping mid-download.
    if (!(e instanceof SyntaxError)) throw { kind: 'network' } satisfies LoadError
    throw { kind: 'damaged', detail: `${url}: ${e.message}` } satisfies LoadError
  }
  try {
    return parse(raw)
  } catch (e) {
    throw { kind: 'damaged', detail: e instanceof Error ? e.message : String(e) } satisfies LoadError
  }
}
