// Pure helpers for the past-spikes log (SpikeLog.tsx). Self-contained, with a .ts import, so
// `node --test test/spikes.test.ts` can load it without a bundler.
import { statusInfo, statusLabel } from './format.ts'
import { translate, type Lang, type StringKey } from './i18n.ts'
import { distanceKm, type LatLon } from './geo.ts'

// Mirrors pipeline/spikes.py (schema plume-witness.spikes/v1). Rows never carry a facility name.
export const SCHEMA = 'plume-witness.spikes/v1'

export interface SpikeRow {
  /** Null when no replay file exists for the night (e.g. a day with no wind data). */
  night_id: string | null
  date: string
  hour_cst: number
  site_id: string
  site: string
  lat: number
  lon: number
  param: string
  compound: string
  value_ppb: number
  baseline_ppb: number
  ratio: number | null
  status: string
  reports_that_day: number
  /** The pipeline's English sentence for reason_code (pipeline/spikes.py REASONS); the UI shows the code's label. */
  reason?: string
  /** Why a search_incomplete row stopped short (pipeline/spikes.py REASONS); absent on other rows and older files. */
  reason_code?: string
  matched_incident?: string
  report_url?: string
}

export interface SpikeFile {
  /** Present only on a region other than Houston; Houston's file predates regions. */
  region?: { key: string; label: string; county: string; backtested: boolean; note: string | null }
  trigger: string
  corridor: string | null
  /** The calendar years the scan covered, e.g. ['2024', '2025']. */
  years: string[]
  tceq_search_page: string
  summary: { spikes: number; spike_days: number; by_status: Record<string, number>; known_missed_reports: number | null }
  rows: SpikeRow[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/** spikes.json is pipeline output read over the network: check its shape once, fail with a fix. */
export function parseSpikes(raw: unknown): SpikeFile {
  const f = raw as Partial<SpikeFile> & { schema?: unknown }
  if (!f || f.schema !== SCHEMA || !Array.isArray(f.rows) || !Array.isArray(f.years) || !f.years.every((y) => /^\d{4}$/.test(y))) {
    throw new Error(`spikes.json is not ${SCHEMA}. Re-run \`uv run python -m pipeline.spikes\`.`)
  }
  f.rows.forEach((r, i) => {
    const ok = r && (r.night_id === null || isStr(r.night_id)) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isNum(r.hour_cst) && isStr(r.site_id)
      && isStr(r.site) && isNum(r.lat) && isNum(r.lon) && isStr(r.param) && isStr(r.compound) && isNum(r.value_ppb)
      && isNum(r.baseline_ppb) && (r.ratio === null || isNum(r.ratio)) && isStr(r.status)
      && (r.reason_code === undefined || isStr(r.reason_code))
    if (!ok) throw new Error(`spikes.json row ${i} is malformed. Re-run \`uv run python -m pipeline.spikes\`.`)
  })
  return f as SpikeFile
}

/** Stable row id, replay or not (matches pipeline/spikes.py spike_id); night_id is null where there is no replay. */
export const spikeKey = (r: SpikeRow): string => `${r.date}_${r.param}_${r.site_id}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** ISO date as text without Date(), which would read it as UTC midnight and shift it a day west of Greenwich. */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** The CSV's note: the English long form of the row's reason, so a coded row never exports the stand-in sentence. */
function noteText(r: SpikeRow): string | undefined {
  const k = reasonKey(r)
  return k ? translate('en', `${k}Long`) : r.reason
}

const CSV_COLUMNS: [string, (r: SpikeRow) => string | number | boolean | null | undefined][] = [
  ['date', (r) => r.date], ['hour_cst', (r) => r.hour_cst], ['monitor', (r) => r.site], ['site_id', (r) => r.site_id],
  ['lat', (r) => r.lat], ['lon', (r) => r.lon], ['compound', (r) => r.compound], ['param', (r) => r.param],
  ['value_ppb', (r) => r.value_ppb], ['baseline_ppb', (r) => r.baseline_ppb], ['times_baseline', (r) => r.ratio],
  ['record_check', (r) => statusInfo(r.status).en], ['status', (r) => r.status], ['note', noteText],
  ['reason_code', (r) => r.reason_code],
  ['reports_filed_that_day', (r) => r.reports_that_day],
  ['matched_incident', (r) => r.matched_incident], ['report_url', (r) => r.report_url], ['night_id', (r) => r.night_id],
]

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') return String(v)
  // A text cell starting with = + - @ runs as a formula in spreadsheet apps; a leading ' keeps it text.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: SpikeRow[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')]
  for (const r of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(','))
  return lines.join('\r\n') + '\r\n'
}


export type SortKey = 'date' | 'value' | 'ratio'
export type Dir = 'asc' | 'desc'

/** The log opens on its biggest spikes ("× baseline", highest first): newest-first led with a screen of grey "Can't
 *  say: wind too light" rows. The default is left out of the URL; any other sort is written, so a choice survives. */
export const DEFAULT_SORT: SortKey = 'ratio'
const SORT_KEYS: readonly SortKey[] = ['date', 'value', 'ratio']
export const sortFromParam = (v: string | null): SortKey => SORT_KEYS.find((k) => k === v) ?? DEFAULT_SORT
export const sortParam = (sort: SortKey): string => (sort === DEFAULT_SORT ? '' : sort)

export interface Filters { site: string; compound: string; status: string; year: string }
export const NO_FILTER: Filters = { site: '', compound: '', status: '', year: '' }

export const FILTER_KEYS = ['site', 'compound', 'status', 'year'] as const satisfies readonly (keyof Filters)[]

/** The value a row has for one filter (the year filter matches the date's first four digits). */
export const filterValue = (r: SpikeRow, k: keyof Filters): string =>
  k === 'site' ? r.site_id : k === 'compound' ? r.compound : k === 'status' ? r.status : r.date.slice(0, 4)

/** True when the row passes every set filter, skipping `except` (used to count one select's options). */
export function passes(r: SpikeRow, f: Filters, except?: keyof Filters): boolean {
  return FILTER_KEYS.every((k) => k === except || !f[k] || filterValue(r, k) === f[k])
}

/** The rows the table shows and the CSV exports: one function, so the two can never disagree. */
export function selectRows(all: SpikeRow[], f: Filters, sort: SortKey, dir: Dir): SpikeRow[] {
  const rows = all.filter((r) => passes(r, f))
  const key = (r: SpikeRow): number | string =>
    sort === 'value' ? r.value_ppb : sort === 'ratio' ? (r.ratio ?? -1) : `${r.date} ${String(r.hour_cst).padStart(2, '0')}`
  const sign = dir === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b)
    return (ka < kb ? -1 : ka > kb ? 1 : spikeKey(a).localeCompare(spikeKey(b))) * sign
  })
}

/** Rows drawn per page of the log: the table and the cards build every row as DOM, so 415 at once made the page
 *  33,000 px tall on a laptop and 99,000 px on a phone. */
/** The spike log's count line. A region with no spikes at all gets its own empty state ('spikes.none'): the
 *  filter-empty line would read as if a filter had hidden spikes that never existed. */
export type CountKey = 'spikes.none' | 'spikes.empty' | 'spikes.showingFiltered' | 'spikes.showing'
export function countKey(total: number, matching: number, filtered: boolean): CountKey {
  if (total === 0) return 'spikes.none'
  if (matching === 0) return 'spikes.empty'
  return filtered ? 'spikes.showingFiltered' : 'spikes.showing'
}

/** The scanned years as one span: ['2024', '2025'] -> "2024–2025". */
export function yearSpan(years: readonly string[]): string {
  const ys = [...years].sort()
  return ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : (ys[0] ?? '')
}

export const PAGE_SIZE = 50

export interface LogView {
  /** Every row that passes the filters, in sort order: the CSV and the calendar use these, never the page. */
  rows: SpikeRow[]
  /** The first `limit` of `rows`: what the table or cards draw. */
  shown: SpikeRow[]
  /** Rows not drawn yet. */
  remaining: number
  /** How many one "Show more" press adds: a page, or what is left when that is less. */
  next: number
}

/** Filter and sort first, page last, so a page is always the top of the filtered, sorted list. */
export function logView(all: SpikeRow[], f: Filters, sort: SortKey, dir: Dir, limit: number): LogView {
  const rows = selectRows(all, f, sort, dir)
  const n = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : PAGE_SIZE
  const shown = rows.slice(0, n)
  const remaining = rows.length - shown.length
  return { rows, shown, remaining, next: Math.min(PAGE_SIZE, remaining) }
}

/** A shared link can carry a filter value this file does not have (a renamed site id, a year with no data). Such a
 *  value would silently show 0 rows behind selects that read "All", so it is dropped and named instead. */
export function cleanFilters(all: SpikeRow[], f: Filters): { filters: Filters; dropped: (keyof Filters)[] } {
  const filters = { ...f }
  const dropped: (keyof Filters)[] = []
  for (const k of FILTER_KEYS) {
    if (f[k] && !all.some((r) => filterValue(r, k) === f[k])) {
      filters[k] = ''
      dropped.push(k)
    }
  }
  return { filters, dropped }
}

/** Option counts for one select, against the other active filters, so an option that would give 0 rows says 0. */
export function optionCounts(all: SpikeRow[], f: Filters, k: keyof Filters): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of all) m.set(filterValue(r, k), (m.get(filterValue(r, k)) ?? 0) + (passes(r, f, k) ? 1 : 0))
  return m
}

/** Why a "search incomplete" row stopped short, as a string-table key; null for a reason this table does not know
 *  (shown as the pipeline wrote it, marked English). reason_code is the real cause (pipeline/spikes.py REASONS). The
 *  `reason` sentence is only a fallback for a file without codes (an older cached spikes.json, which wrote "could not
 *  be placed on the map" for calm-wind and earlier-search rows too), so that sentence maps to "see the replay's Check
 *  step", never to a cause it may not be. */
export type ReasonKey =
  | 'spikes.reason.calm' | 'spikes.reason.placed' | 'spikes.reason.earlier' | 'spikes.reason.week' | 'spikes.reason.noWind'
  | 'spikes.reason.check'
const REASON_CODES: Record<string, ReasonKey> = {
  calm_wind: 'spikes.reason.calm',
  report_not_placed: 'spikes.reason.placed',
  earlier_search_incomplete: 'spikes.reason.earlier',
  day_search_incomplete: 'spikes.reason.week',
  no_wind: 'spikes.reason.noWind',
}
const REASONS: Record<string, ReasonKey> = {
  'A report filed that day could not be placed on the map, so absence cannot be claimed.': 'spikes.reason.check',
  "TCEQ's search for that week did not return every report, so absence cannot be claimed.": 'spikes.reason.week',
  'No wind data for that day, so no upwind area could be drawn.': 'spikes.reason.noWind',
}
/** The codes the legend explains, in the pipeline's order of checks. */
export const REASON_CODE_KEYS: readonly ReasonKey[] = Object.values(REASON_CODES)
const own = (m: Record<string, ReasonKey>, k: string | undefined): ReasonKey | null =>
  (k !== undefined && Object.hasOwn(m, k) ? m[k] : null)
export const reasonKey = (row: Pick<SpikeRow, 'reason' | 'reason_code'>): ReasonKey | null =>
  own(REASON_CODES, row.reason_code) ?? own(REASONS, row.reason)

// The short form of each cause, for the one-line "Can’t say: wind too light" label. The fallback (cause unknown:
// "see the replay's Check step") has none, so that row keeps the plain "Can’t say" and its longer reason line.
const REASON_SHORT: Partial<Record<ReasonKey, StringKey>> = {
  'spikes.reason.calm': 'spikes.reasonShort.calm',
  'spikes.reason.placed': 'spikes.reasonShort.placed',
  'spikes.reason.earlier': 'spikes.reasonShort.earlier',
  'spikes.reason.week': 'spikes.reasonShort.week',
  'spikes.reason.noWind': 'spikes.reasonShort.noWind',
}
const shortReason = (row: Pick<SpikeRow, 'status' | 'reason' | 'reason_code'>): StringKey | null => {
  const k = row.status === 'search_incomplete' ? reasonKey(row) : null
  return (k && REASON_SHORT[k]) ?? null
}
/** True when rowStatusLabel already names the row's cause, so a separate reason line would only repeat it. */
export const reasonInLabel = (row: Pick<SpikeRow, 'status' | 'reason' | 'reason_code'>): boolean => shortReason(row) !== null

/** One row's record check as a label: "Can’t say: wind too light" when its check stopped short for a known cause,
 *  otherwise the status label every page uses. */
export function rowStatusLabel(row: Pick<SpikeRow, 'status' | 'reason' | 'reason_code'>, lang: Lang): string {
  const k = shortReason(row)
  return k ? translate(lang, 'status.cantSayWhy', { why: translate(lang, k) }) : statusLabel(row.status, lang)
}

/** The monitor in the file closest to a point, with its distance; null for an empty file. */
export function nearestSite(all: SpikeRow[], p: LatLon): { site_id: string; site: string; km: number } | null {
  let best: { site_id: string; site: string; km: number } | null = null
  const seen = new Set<string>()
  for (const r of all) {
    if (seen.has(r.site_id)) continue
    seen.add(r.site_id)
    const km = distanceKm(p, r)
    if (!best || km < best.km) best = { site_id: r.site_id, site: r.site, km }
  }
  return best
}

/** Where the reader was in the list before opening a night, so Back lands on the same row (sessionStorage). */
export interface ListSpot { search: string; limit: number; y: number }
export function parseSpot(raw: string | null, search: string): ListSpot | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<ListSpot>
    if (v.search !== search || !Number.isInteger(v.limit) || !Number.isFinite(v.y)) return null
    return { search, limit: Math.min(Math.max(v.limit!, 1), 10_000), y: Math.max(0, v.y!) }
  } catch {
    return null
  }
}
