// Pure helpers for the statewide coverage page (Coverage.tsx). Self-contained, with .ts imports, so
// `node --test test/coverage.test.ts` can load it without a bundler.
//
// coverage.json lists every state hourly benzene monitor (TCEQ AutoGC) and what each recorded in the years covered.
// A spike count is how many times a monitor crossed the trigger; it is a question to check, never a finding, and a 0
// only means no hour crossed the trigger (not that the air was clean).
import { loadJson } from './facilities.ts'
import { REGIONS, regionQuery, type Regions } from './region.ts'

export const WIND_SOURCES = ['met', 'autogc', 'borrowed'] as const
export type WindSource = (typeof WIND_SOURCES)[number]

export interface CoverageSite {
  site_id: string
  name: string
  county: string
  /** The replay region this monitor belongs to, or null when the site does not replay it. */
  region_key: string | null
  lat: number
  lon: number
  /** False when the state file had no hourly readings for this monitor in the years covered: a gap, not a zero. */
  has_data: boolean
  wind_source: WindSource | null
  years: number[]
  max_benzene_ppb: number | null
  max_butadiene_ppb: number | null
  spikes: number
  by_status: Record<string, number>
}

export interface Coverage {
  generated: string
  trigger: string
  sites: CoverageSite[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SITE_ID = /^\d{2}_\d{3}_\d{4}$/
const REGION_KEY = /^[a-z][a-z0-9_]*$/

function str(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where}: ${k} must be a non-empty string`)
  return v
}

function num(o: Record<string, unknown>, k: string, where: string, min: number, max: number): number {
  const v = o[k]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${where}: ${k} must be a number in [${min}, ${max}]`)
  return v
}

function maxPpb(o: Record<string, unknown>, k: string, where: string): number | null {
  if (o[k] === null) return null
  // kn: 100000 ppb is far above any hourly AutoGC value; it only rejects garbage, not a real high reading.
  return num(o, k, where, 0, 100_000)
}

function count(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`${where} must be a whole number, 0 or more`)
  return v
}

function parseSite(raw: unknown, i: number): CoverageSite {
  const where = `coverage.json sites[${i}]`
  if (!isObj(raw)) throw new Error(`${where}: not an object`)
  const site_id = str(raw, 'site_id', where)
  if (!SITE_ID.test(site_id)) throw new Error(`${where}: site_id ${JSON.stringify(site_id)} is not a state site id (48_201_0069)`)
  const at = `${where} (${site_id})`
  const region_key = raw.region_key === null ? null : str(raw, 'region_key', at)
  if (region_key !== null && !REGION_KEY.test(region_key)) throw new Error(`${at}: bad region_key ${JSON.stringify(region_key)}`)
  if (typeof raw.has_data !== 'boolean') throw new Error(`${at}: has_data must be true or false`)
  const wind = raw.wind_source
  if (wind !== null && !(WIND_SOURCES as readonly unknown[]).includes(wind)) throw new Error(`${at}: wind_source must be met, autogc, borrowed or null`)
  if (!Array.isArray(raw.years)) throw new Error(`${at}: years must be a list`)
  const years = raw.years.map((y, j) => {
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 1990 || y > 2100) throw new Error(`${at}: years[${j}] is not a year`)
    return y
  })
  const spikes = count(raw.spikes, `${at}: spikes`)
  if (!isObj(raw.by_status)) throw new Error(`${at}: by_status must be an object`)
  const by_status: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw.by_status)) by_status[k] = count(v, `${at}: by_status.${k}`)
  const statusTotal = Object.values(by_status).reduce((a, b) => a + b, 0)
  if (statusTotal > spikes) throw new Error(`${at}: by_status counts ${statusTotal} spikes, more than spikes (${spikes})`)
  const site: CoverageSite = {
    site_id, name: str(raw, 'name', at), county: str(raw, 'county', at), region_key,
    lat: num(raw, 'lat', at, -90, 90), lon: num(raw, 'lon', at, -180, 180), has_data: raw.has_data,
    wind_source: wind as WindSource | null, years, spikes, by_status,
    max_benzene_ppb: maxPpb(raw, 'max_benzene_ppb', at), max_butadiene_ppb: maxPpb(raw, 'max_butadiene_ppb', at),
  }
  // A monitor with no readings cannot have crossed the trigger or have a highest value; one that says so is a pipeline bug.
  if (!site.has_data && (spikes > 0 || site.max_benzene_ppb !== null || site.max_butadiene_ppb !== null)) {
    throw new Error(`${at}: has_data is false but it lists spikes or a highest value`)
  }
  return site
}

/** Validates coverage.json (the pipeline's contract); throws a message naming the bad field. */
export function parseCoverage(raw: unknown): Coverage {
  if (!isObj(raw)) throw new Error('coverage.json: not an object')
  const generated = str(raw, 'generated', 'coverage.json')
  const trigger = str(raw, 'trigger', 'coverage.json')
  if (!Array.isArray(raw.sites)) throw new Error('coverage.json: sites must be a list')
  const sites = raw.sites.map(parseSite)
  const seen = new Set<string>()
  for (const s of sites) {
    if (seen.has(s.site_id)) throw new Error(`coverage.json: site ${s.site_id} is listed twice`)
    seen.add(s.site_id)
  }
  return { generated, trigger, sites }
}

/**
 * Fetches and validates coverage.json; rejects with facilities.ts's LoadError. Before the pipeline publishes the file
 * GitHub Pages answers 404, but a host with a single-page fallback (vite preview, rewrite rules) answers 200 with
 * index.html: that is also "not published yet", not damaged data, so it is reported as the 404 it stands for.
 */
export function loadCoverage(url: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Coverage> {
  const htmlIsMissing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = await fetchFn(input, init)
    return r.ok && /\btext\/html\b/i.test(r.headers.get('content-type') ?? '') ? new Response(null, { status: 404 }) : r
  }) as typeof fetch
  return loadJson(url, parseCoverage, htmlIsMissing, signal)
}

/** A region key this site can replay (it has Past spikes and nights); an unknown key is shown but never linked. */
export const replayable = (key: string | null, regions: Regions = REGIONS): key is string => key !== null && Object.hasOwn(regions, key)

export interface CoverageSummary {
  monitors: number
  withData: number
  noData: number
  /** Monitors with at least one hour at or above the trigger. */
  crossed: number
  spikes: number
  /** Monitors that crossed the trigger but are in no region this site replays: counted, not checked. */
  crossedNotReplayed: number
  /** Replayable region keys with at least one monitor in the file, in registry order. */
  regions: string[]
  /** First and last year any monitor covers, or null when none lists a year. */
  years: [number, number] | null
}

export function coverageSummary(c: Coverage, regions: Regions = REGIONS): CoverageSummary {
  const inFile = new Set(c.sites.map((s) => s.region_key).filter((k) => replayable(k, regions)))
  const allYears = c.sites.flatMap((s) => s.years)
  const crossed = c.sites.filter((s) => s.spikes > 0)
  return {
    monitors: c.sites.length,
    withData: c.sites.filter((s) => s.has_data).length,
    noData: c.sites.filter((s) => !s.has_data).length,
    crossed: crossed.length,
    spikes: c.sites.reduce((a, s) => a + s.spikes, 0),
    crossedNotReplayed: crossed.filter((s) => !replayable(s.region_key, regions)).length,
    regions: Object.keys(regions).filter((k) => inFile.has(k)),
    years: allYears.length ? [Math.min(...allYears), Math.max(...allYears)] : null,
  }
}

export const SORT_KEYS = ['name', 'county', 'region', 'benzene', 'butadiene', 'spikes', 'wind'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

/** The column's natural first direction: numbers largest first, text A to Z. */
export const firstDir = (k: SortKey): SortDir => (k === 'benzene' || k === 'butadiene' || k === 'spikes' ? 'desc' : 'asc')

/**
 * Sorted copy. A monitor with no data, or no value in the sorted column, always goes last in either direction (a gap is
 * not the smallest number). Ties fall back to the site name, then the id, so the order never depends on the file.
 * `regionName` turns a region key into the text the reader sees, so Region sorts as displayed.
 */
export function sortSites(sites: readonly CoverageSite[], key: SortKey, dir: SortDir, regionName: (k: string | null) => string = (k) => k ?? '', locale = 'en'): CoverageSite[] {
  const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  const value = (s: CoverageSite): string | number | null => {
    switch (key) {
      case 'name': return s.name
      case 'county': return s.county
      case 'region': return s.region_key === null ? null : regionName(s.region_key)
      case 'benzene': return s.has_data ? s.max_benzene_ppb : null
      case 'butadiene': return s.has_data ? s.max_butadiene_ppb : null
      case 'spikes': return s.has_data ? s.spikes : null
      case 'wind': return s.wind_source
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...sites].sort((a, b) => {
    const va = value(a), vb = value(b)
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1
    } else {
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : coll.compare(String(va), String(vb))
      if (d !== 0) return sign * d
    }
    return coll.compare(a.name, b.name) || (a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0)
  })
}

/**
 * The map marker. Shape says whether the monitor crossed the trigger (triangle) or not (circle); a hollow dashed ring
 * is a monitor with no data. Size 1-3 grows with the spike count, so the map never relies on colour alone.
 */
export type MarkerKind = { shape: 'none' | 'zero' | 'crossed'; size: 0 | 1 | 2 | 3 }
export const SPIKE_BANDS = [10, 50] as const

export function markerKind(s: CoverageSite): MarkerKind {
  if (!s.has_data) return { shape: 'none', size: 0 }
  if (s.spikes === 0) return { shape: 'zero', size: 0 }
  return { shape: 'crossed', size: s.spikes < SPIKE_BANDS[0] ? 1 : s.spikes < SPIKE_BANDS[1] ? 2 : 3 }
}

/** Past spikes for a monitor's region, or null when the site does not replay that region. */
export function regionSpikesHref(base: string, key: string | null, regions: Regions = REGIONS): string | null {
  return replayable(key, regions) ? `${base}${regionQuery(regions[key], { view: 'spikes' })}` : null
}

/** A highest reading as text: two decimals under 1 ppb, one under 100, whole above; no trailing zeros or exponent. */
export function ppbText(v: number): string {
  return String(Number(v.toFixed(v < 1 ? 2 : v < 100 ? 1 : 0)))
}

/**
 * One marker drawn as SVG, shared by the map and its key so the two cannot disagree. Fixed light-map colours (the
 * Positron tiles stay light in the dark theme), each with a white edge so it reads over roads and water.
 */
export type MarkerGeometry =
  | { px: number; el: 'polygon'; points: string; fill: string }
  | { px: number; el: 'circle'; r: number; fill: string; dashed: boolean }

const TRIANGLE_PX = [0, 14, 20, 28] as const

export function markerGeometry(k: MarkerKind): MarkerGeometry {
  if (k.shape === 'crossed') {
    const px = TRIANGLE_PX[k.size]
    return { px, el: 'polygon', points: `${px / 2},1.5 ${px - 1.5},${px - 1.5} 1.5,${px - 1.5}`, fill: '#be1e2d' }
  }
  return k.shape === 'zero'
    ? { px: 12, el: 'circle', r: 4.5, fill: '#1f5ea0', dashed: false }
    : { px: 14, el: 'circle', r: 5, fill: 'none', dashed: true }
}

export type Bounds = [[west: number, south: number], [east: number, north: number]]
/** Texas, west to east and south to north, with a little room on every side. */
export const TEXAS: Bounds = [[-106.7, 25.8], [-93.5, 36.55]]

/**
 * What the map frames: all of Texas (key null; widened if a monitor sits outside it), or one region's monitors with
 * room around them. A key no monitor has frames Texas.
 */
export function viewBounds(sites: readonly CoverageSite[], key: string | null, pad = 0.08): Bounds {
  const pick = key === null ? sites : sites.filter((s) => s.region_key === key)
  if (key !== null && !pick.length) return viewBounds(sites, null)
  const [[w0, s0], [e0, n0]] = key === null ? TEXAS : [[Infinity, Infinity], [-Infinity, -Infinity]]
  let w = w0, s = s0, e = e0, n = n0
  for (const p of pick) {
    w = Math.min(w, p.lon - (key ? pad : 0)); e = Math.max(e, p.lon + (key ? pad : 0))
    s = Math.min(s, p.lat - (key ? pad : 0)); n = Math.max(n, p.lat + (key ? pad : 0))
  }
  return [[w, s], [e, n]]
}
