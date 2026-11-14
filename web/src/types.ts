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
  } | null
}

/** Wind-sector corridor: origin monitor, ±half_width_deg around each wind-from bearing, out to max_km. */
export interface Corridor {
  origin_site_id: string
  half_width_deg: number
  max_km: number
  wind_from_deg: number[]
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
