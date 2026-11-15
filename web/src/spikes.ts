// Pure helpers for the past-spikes log (SpikeLog.tsx). Self-contained, with a .ts import, so
// `node --test test/spikes.test.ts` can load it without a bundler.
import { statusInfo } from './format.ts'

// Mirrors pipeline/spikes.py (schema plume-witness.spikes/v1). Rows never carry a facility name.
export const SCHEMA = 'plume-witness.spikes/v1'

export interface SpikeRow {
  night_id: string
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
  reason?: string
  matched_incident?: string
  report_url?: string
}

export interface SpikeFile {
  trigger: string
  corridor: string | null
  tceq_search_page: string
  summary: { spikes: number; spike_days: number; by_status: Record<string, number>; known_missed_reports: number | null }
  rows: SpikeRow[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/** spikes.json is pipeline output read over the network: check its shape once, fail with a fix. */
export function parseSpikes(raw: unknown): SpikeFile {
  const f = raw as Partial<SpikeFile> & { schema?: unknown }
  if (!f || f.schema !== SCHEMA || !Array.isArray(f.rows)) {
    throw new Error(`spikes.json is not ${SCHEMA}. Re-run \`uv run python -m pipeline.spikes\`.`)
  }
  f.rows.forEach((r, i) => {
    const ok = r && isStr(r.night_id) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isNum(r.hour_cst) && isStr(r.site_id)
      && isStr(r.site) && isNum(r.lat) && isNum(r.lon) && isStr(r.param) && isStr(r.compound) && isNum(r.value_ppb)
      && isNum(r.baseline_ppb) && (r.ratio === null || isNum(r.ratio)) && isStr(r.status)
    if (!ok) throw new Error(`spikes.json row ${i} is malformed. Re-run \`uv run python -m pipeline.spikes\`.`)
  })
  return f as SpikeFile
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** ISO date as text without Date(), which would read it as UTC midnight and shift it a day west of Greenwich. */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

const CSV_COLUMNS: [string, (r: SpikeRow) => string | number | boolean | null | undefined][] = [
  ['date', (r) => r.date], ['hour_cst', (r) => r.hour_cst], ['monitor', (r) => r.site], ['site_id', (r) => r.site_id],
  ['lat', (r) => r.lat], ['lon', (r) => r.lon], ['compound', (r) => r.compound], ['param', (r) => r.param],
  ['value_ppb', (r) => r.value_ppb], ['baseline_ppb', (r) => r.baseline_ppb], ['times_baseline', (r) => r.ratio],
  ['record_check', (r) => statusInfo(r.status).en], ['status', (r) => r.status], ['note', (r) => r.reason],
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
export interface Filters { site: string; compound: string; status: string; year: string }
export const NO_FILTER: Filters = { site: '', compound: '', status: '', year: '' }

/** The rows the table shows and the CSV exports: one function, so the two can never disagree. */
export function selectRows(all: SpikeRow[], f: Filters, sort: SortKey, dir: Dir): SpikeRow[] {
  const rows = all.filter((r) => (!f.site || r.site_id === f.site) && (!f.compound || r.compound === f.compound)
    && (!f.status || r.status === f.status) && (!f.year || r.date.startsWith(f.year)))
  const key = (r: SpikeRow): number | string =>
    sort === 'value' ? r.value_ppb : sort === 'ratio' ? (r.ratio ?? -1) : `${r.date} ${String(r.hour_cst).padStart(2, '0')}`
  const sign = dir === 'asc' ? 1 : -1
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b)
    return (ka < kb ? -1 : ka > kb ? 1 : a.night_id.localeCompare(b.night_id)) * sign
  })
}
