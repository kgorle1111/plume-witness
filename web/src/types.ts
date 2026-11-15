// Mirrors pipeline/contract.py (schema plume-witness.event/v1). The contract is owned by the pipeline;
// if it changes, change this file and `parseEvent` together.

export const SCHEMA = 'plume-witness.event/v1'

export type Status = 'reported' | 'not_yet_reported' | 'no_report_after_deadline' | 'reported_mismatch' | 'search_incomplete'

export interface HourValue {
  hour_cst: number
  value: number | null
  flag: string | null
}

export interface Monitor {
  site_id: string
  name: string
  lat: number
  lon: number
  hourly: HourValue[]
  baseline: number
  peak: { hour_cst: number; value: number }
  triggered: boolean
}

export interface WindHour {
  hour_cst: number
  from_deg: number
  speed_mph: number
}

export interface Facility {
  id: string
  name: string
  lat: number
  lon: number
  distance_km: number
  bearing_deg: number
  alignment: number
  rank: number
  in_corridor: boolean
  source: string
}

export interface RecordCheck {
  status: Status
  incident?: string | null
  source_url: string
  matched_facility_id: string | null
  search_scope: string
  checks: { at: string; status: Status }[]
  reported?: {
    compound?: string
    pounds?: number
    start_local?: string
    end_local?: string
    tz?: string
    cause?: string
    travel_h?: number | null
    travel_speed_mph?: number | null
    travel_distance_km?: number | null
    arrival_local?: string
    /** The company's own dated update lines on the report page, quoted. */
    revisions?: { date: string; text: string }[]
  } | null
  day_incidents?: DayIncident[]
}

export interface DayIncident {
  incident: string
  entity: string
  rn?: string
  start_local?: string
  compound?: string
  pounds?: number | null
  facility_id?: string | null
  distance_km?: number | null
  bearing_deg?: number | null
  /** null when the report couldn't be placed on the map (pipeline/build.py writes None). */
  in_corridor: boolean | null
  resolution: string
}

/** Wind-sector corridor: origin monitor, ±half_width_deg around each wind-from bearing, out to max_km. */
export interface Corridor {
  origin_site_id: string
  half_width_deg: number
  max_km: number
  wind_from_deg: number[]
}

/** Optional, informational (pipeline/triangulate.py): other triggering monitors' wedges intersected with the
 *  corridor. Never changes the record check or the corridor list. */
export interface Triangulation {
  half_width_deg: number
  max_km: number
  monitors_triggered: number
  monitors: { site_id: string; name: string; lat: number; lon: number; role: string; wind_from_deg: number[] }[]
  excluded: { site_id: string; name: string; reason: string }[]
  single_wedge_count: number
  intersection_count: number | null
  intersection_ids: string[]
  separation_deg: number | null
  verdict: 'narrows' | 'aligned' | 'no_narrowing' | 'no_overlap' | 'single' | 'single_wind' | 'not_traced'
  verdict_text: string
  caveat: string | null
}

export interface PlumeEvent {
  schema: string
  label: 'real' | 'fixture'
  event_id: string
  title: string
  date_local: string
  time_note: string
  compound: { name: string; aqs_param: string; units: string }
  monitors: Monitor[]
  wind: { site_id: string; hourly: WindHour[] }
  detection: { site_id: string; hour_cst: number; value: number; baseline: number; rule: string }
  facilities: Facility[]
  record_check: RecordCheck
  packet: {
    draft_en: string
    draft_es: string
    drafted_by: string | null
    guard: { passed: boolean; rejected: string[] }
  }
  corridor?: Corridor
  triangulation?: Triangulation
  /** Present only on a night from a region other than Houston (pipeline/regions.py). */
  region?: { key: string; label: string; backtested: boolean; note: string | null }
  cannot_say: string[]
  provenance: unknown[]
}

const REQUIRED_TOP = ['schema', 'label', 'event_id', 'title', 'date_local', 'time_note', 'compound', 'monitors',
  'wind', 'detection', 'facilities', 'record_check', 'packet', 'cannot_say', 'provenance'] as const

/** Shallow shape check at the fetch boundary. The pipeline's `validate` is the real gate; this only stops
 *  the UI from rendering a half-broken file as if it were fine. */
export function parseEvent(raw: unknown): PlumeEvent {
  if (typeof raw !== 'object' || raw === null) throw new Error('event.json is not a JSON object.')
  const ev = raw as Record<string, unknown>
  const missing = REQUIRED_TOP.filter((k) => !(k in ev))
  if (missing.length) throw new Error(`event.json is missing: ${missing.join(', ')}. Re-run the pipeline.`)
  if (ev.schema !== SCHEMA) throw new Error(`event.json schema is "${String(ev.schema)}", this app reads "${SCHEMA}".`)
  if (ev.label !== 'real' && ev.label !== 'fixture') throw new Error('event.json label must be "real" or "fixture".')
  const e = raw as PlumeEvent
  if (!e.monitors.some((m) => m.site_id === e.detection.site_id)) {
    throw new Error(`detection.site_id "${e.detection.site_id}" is not in monitors.`)
  }
  return e
}

/** Optional web/public/packet.ai.json, written by pipeline/claude_draft.py publish() only when the guard passed. */
export interface AiDraft {
  provider: string
  model: string
  generated_local: string
  runs_on_this_event: number
  draft_en: string
  draft_es: string
  guard: { passed: true; rejected: string[] }
}

const AI_MAX_CHARS = 4000
const isDraftText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= AI_MAX_CHARS

/** Trust boundary: the file is static, but the site shows it to the public, so check its shape before use. */
export function parseAiDraft(raw: unknown): AiDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const g = r.guard as { passed?: unknown } | undefined
  if (g?.passed !== true || !isDraftText(r.draft_en) || !isDraftText(r.draft_es)) return null
  if (typeof r.provider !== 'string' || typeof r.model !== 'string' || typeof r.generated_local !== 'string') return null
  if (typeof r.runs_on_this_event !== 'number') return null
  return raw as AiDraft
}
