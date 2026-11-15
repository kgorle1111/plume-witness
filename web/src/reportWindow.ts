import type { RecordCheck } from './types.ts'

/** Offset of the company's local clock from the monitors' CST, read from the pipeline's own tz note. */
export function localOffsetH(tz?: string): number | null {
  if (!tz) return null
  if (/\bCDT\b/.test(tz)) return 1
  if (/\bCST\b/.test(tz)) return 0
  return null
}

const MIN_PER_DAY = 1440

/** Minutes after 00:00 CST on the event day for a local 'YYYY-MM-DDTHH:MM' stamp; negative = the day before. */
export function localToCstMinutes(local: string, eventDay: string, offsetH: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDay)
  if (!m || !d) return null
  const days = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+d[1], +d[2] - 1, +d[3])) / 86_400_000
  return days * MIN_PER_DAY + +m[4] * 60 + +m[5] - offsetH * 60
}

export interface ReportBand {
  /** Hours on the chart's 0-24 CST axis, clipped to the day. */
  from: number
  to: number
  startsBefore: boolean
  endsAfter: boolean
  /** The same window as the company printed it, in its own clock. */
  localText: string
  /** Same window on the chart's CST clock; null when the dates differ from the event day or CST is the local clock. */
  cstText: string | null
  tzLabel: string
  matched: boolean
}

const hm = (min: number) => {
  const t = ((Math.round(min) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** Null when there is nothing honest to draw: no report, a status that is not a report match, or no usable times. */
export function reportBand(rc: RecordCheck, eventDay: string): ReportBand | null {
  const r = rc.reported
  const matched = rc.status === 'reported' || rc.status === 'not_yet_reported'
  if (!r || !(matched || rc.status === 'reported_mismatch') || !r.start_local || !r.end_local) return null
  const off = localOffsetH(r.tz)
  if (off === null) return null
  const s = localToCstMinutes(r.start_local, eventDay, off)
  const e = localToCstMinutes(r.end_local, eventDay, off)
  if (s === null || e === null || e < s) return null
  const from = Math.max(s, 0), to = Math.min(e, MIN_PER_DAY)
  if (to <= from) return null
  const tzLabel = off ? 'CDT' : 'CST'
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const lt = (x: string) => {
    const t = x.slice(11).replace(/^0/, '')
    return x.slice(0, 10) === eventDay ? t : `${MONTHS[+x.slice(5, 7) - 1]} ${+x.slice(8, 10)} ${t}`
  }
  const sameDay = r.start_local.slice(0, 10) === eventDay && r.end_local.slice(0, 10) === eventDay
  return {
    from: from / 60, to: to / 60, startsBefore: s < 0, endsAfter: e > MIN_PER_DAY, matched: rc.status !== 'reported_mismatch',
    localText: `${lt(r.start_local)} to ${lt(r.end_local)} ${tzLabel}`,
    cstText: sameDay && off ? `${hm(s)} to ${hm(e)} CST` : null, tzLabel,
  }
}

export interface ArrivalTick {
  hourCst: number
  text: string
}

/** The pipeline's own travel estimate, drawn only when all of its fields exist. */
export function arrivalTick(rc: RecordCheck, eventDay: string): ArrivalTick | null {
  const r = rc.reported
  if (!r || r.travel_h == null || !r.arrival_local || r.travel_speed_mph == null || r.travel_distance_km == null) return null
  const off = localOffsetH(r.tz)
  if (off === null) return null
  const min = localToCstMinutes(r.arrival_local, eventDay, off)
  if (min === null || min < 0 || min >= MIN_PER_DAY) return null
  const label = off ? 'CDT' : 'CST'
  return {
    hourCst: min / 60,
    text: `air could arrive ~${r.arrival_local.slice(11).replace(/^0/, '')} ${label} (wind ${r.travel_speed_mph} mph, ${r.travel_distance_km} km)`,
  }
}

/** Whole days from the event's reported start to a revision date ('YYYY-MM-DD'). */
export function daysAfterEvent(startLocal: string, revisionDate: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(startLocal), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(revisionDate)
  if (!a || !b) return null
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000)
}
