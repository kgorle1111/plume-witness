import type { RecordCheck } from './types.ts'
import { dateLabel, monthShort, translate, type Lang } from './i18n.ts'

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
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Null when there is nothing honest to draw: no report, a status that is not a report match, or no usable times. */
export function reportBand(rc: RecordCheck, eventDay: string, lang: Lang = 'en'): ReportBand | null {
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
  const lt = (x: string) => {
    const t = x.slice(11)
    return x.slice(0, 10) === eventDay ? t : `${monthShort(+x.slice(5, 7) - 1, lang)} ${+x.slice(8, 10)} ${t}`
  }
  const sameDay = r.start_local.slice(0, 10) === eventDay && r.end_local.slice(0, 10) === eventDay
  return {
    from: from / 60, to: to / 60, startsBefore: s < 0, endsAfter: e > MIN_PER_DAY, matched: rc.status !== 'reported_mismatch',
    localText: `${lt(r.start_local)} ${translate(lang, 'rw.to')} ${lt(r.end_local)} ${tzLabel}`,
    cstText: sameDay && off ? `${hm(s)} ${translate(lang, 'rw.to')} ${hm(e)} CST` : null, tzLabel,
  }
}

export interface ArrivalTick {
  hourCst: number
  text: string
}

/** The pipeline's own travel estimate, drawn only when all of its fields exist. */
export function arrivalTick(rc: RecordCheck, eventDay: string, lang: Lang = 'en'): ArrivalTick | null {
  const r = rc.reported
  if (!r || r.travel_h == null || !r.arrival_local || r.travel_speed_mph == null || r.travel_distance_km == null) return null
  const off = localOffsetH(r.tz)
  if (off === null) return null
  const min = localToCstMinutes(r.arrival_local, eventDay, off)
  if (min === null || min < 0 || min >= MIN_PER_DAY) return null
  const label = off ? 'CDT' : 'CST'
  return {
    hourCst: min / 60,
    text: translate(lang, 'rw.arrival', { time: r.arrival_local.slice(11), tz: label, mph: r.travel_speed_mph, km: r.travel_distance_km }),
  }
}

/** Whole days from the event's reported start to a revision date ('YYYY-MM-DD'). */
export function daysAfterEvent(startLocal: string, revisionDate: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(startLocal), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(revisionDate)
  if (!a || !b) return null
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000)
}

// The pipeline writes one fixed sentence; only the time zone in brackets varies. A sentence that doesn't match
// is shown as published (marked English) rather than guessed at.
const TIME_NOTE = /^Monitor hours are CST as TCEQ publishes them; the company report uses local time \(([^)]+)\)\. TCEQ labels AutoGC data provisional and subject to change\.$/

/** The event's time note in the reader's language, or null when only the published English text is available.
 *  With no company report on the night (`hasReport` false), the clause about the report's clock is left out. */
export function timeNote(note: string, lang: Lang, hasReport = true): string | null {
  const m = TIME_NOTE.exec(note.trim())
  if (!m) return lang === 'en' ? note : null
  return hasReport ? translate(lang, 'det.timeNote', { tz: m[1] }) : translate(lang, 'det.timeNoteNoReport')
}

// pipeline/build.py's resolution forms are rebuilt in the reader's language; any other form stays as written (English).
const RES_OUT = /^outside the corridor \(([\d.]+) km, (\d+)° off the wind\)$/
const RES_CALM = /^not traced: wind too light to trace \(([\d.]+) mph\)$/
const RES_AMBIGUOUS = /^unresolved: ambiguous, (\d+) ECHO sites at the address$/

/** A day-report resolution in the reader's language; `lang` is the language the returned text is actually in. */
export function resolutionText(res: string, lang: Lang): { text: string; lang: Lang } {
  if (res === 'in the upwind corridor') return { text: translate(lang, 'chk.resIn'), lang }
  if (res === 'unresolved: facility not located') return { text: translate(lang, 'chk.resUnlocated'), lang }
  let m = RES_OUT.exec(res)
  if (m) return { text: translate(lang, 'chk.resOut', { km: m[1], deg: m[2] }), lang }
  m = RES_CALM.exec(res)
  if (m) return { text: translate(lang, 'chk.resCalm', { mph: m[1] }), lang }
  m = RES_AMBIGUOUS.exec(res)
  return m ? { text: translate(lang, 'chk.resAmbiguous', { n: m[1] }), lang } : { text: res, lang: 'en' }
}

// record_check.checks[].note forms (pipeline/build.py). A filing date in the note means the record exists, so a
// check that still says "not yet reported" was filed after its window.
const NOTE_NOTICE = /^initial notice filed (\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}) local, (-?[\d.]+) h after the reported discovery \S+$/
const NOTE_FINAL = /^final report dated (\d{4}-\d{2}-\d{2}), (\d+) days? after the event ended$/
const NOTE_CALM = /^wind too light to trace \(([\d.]+) mph\)$/
const NOTE_PENDING = /^final report pending: the cached report is type (.+), with no final report date$/

export interface CheckNote { text: string; lang: Lang; filed: boolean }

/** One check's note in the reader's language; null for an empty note. An unknown form stays as written (English). */
export function checkNoteText(note: string | undefined, lang: Lang): CheckNote | null {
  const s = (note ?? '').trim()
  if (!s) return null
  let m = NOTE_NOTICE.exec(s)
  if (m) return { text: translate(lang, 'chk.noteNotice', { date: dateLabel(m[1], lang), time: m[2], h: m[3] }), lang, filed: true }
  m = NOTE_FINAL.exec(s)
  if (m) return { text: translate(lang, m[2] === '1' ? 'chk.noteFinalOne' : 'chk.noteFinal', { date: dateLabel(m[1], lang), n: m[2] }), lang, filed: true }
  m = NOTE_CALM.exec(s)
  if (m) return { text: translate(lang, 'chk.noteCalm', { mph: m[1] }), lang, filed: false }
  m = NOTE_PENDING.exec(s)
  if (m) return { text: translate(lang, 'chk.noteFinalPending', { type: m[1] }), lang, filed: false }
  return { text: s, lang: 'en', filed: false }
}

/** Wind speed (mph) behind a calm-wind abstention, read from the first check's note; null when the wind was traceable. */
export function calmMph(rc: RecordCheck): number | null {
  // kn: types.ts does not declare checks[].note yet; read it as optional until it does.
  const first = rc.checks[0] as { note?: string } | undefined
  const m = NOTE_CALM.exec((first?.note ?? '').trim())
  return m ? Number(m[1]) : null
}

// record_check.search_scope is a run of fixed sentences (pipeline/build.py, backtest.py). Each must match one known form
// exactly (anchored patterns); if any sentence is unknown the whole paragraph stays as published (marked English)
// rather than half-translated.
// The county phrase is pipeline/build.py county_en: "Harris County", or "Ector and Midland counties" / "Bexar, Comal and
// Wilson counties" for a region searched in several.
const SCOPE_DAY = /^Searched every STEERS emissions event starting (\d{2})\/(\d{2})\/(\d{4}) in (?:([^,()]+) County|((?:[^,()]+, )*[^,()]+) and ([^,()]+) counties) \((\d+) found; search (complete|incomplete)\)\.$/
const SCOPE_EARLIER = /^Also searched reports that started in the (\d+) days before and were still running \((\d+) open that day; earlier search (complete|incomplete)\)\.$/
const SCOPE_MIDNIGHT = /^The match window runs past midnight, so reports that started (\d{2})\/(\d{2})\/(\d{4}) by (\d{2}:\d{2}) local were also searched \((\d+) found; search (complete|incomplete)\)\.$/
const SCOPE_CALM = /^Wind too light to trace \(([\d.]+) mph\): no corridor drawn, so the search is incomplete\.$/
const SCOPE_FIXED = {
  'Events that started on earlier days were not searched.': 'scope.notEarlier',
  'No matching report found in a complete search.': 'scope.none',
  'A report open at that time could not be located, so the search is incomplete.': 'scope.unlocated',
  // kn: quotes pipeline/nrc.py SCOPE_SENTENCE; change both together.
  'Also searched National Response Center (NRC) reports for the county: one in the upwind corridor, in the match window, lists the compound.': 'scope.nrc',
} as const

function scopeSentence(s: string, lang: Lang): string | null {
  const state = (x: string) => translate(lang, x === 'complete' ? 'scope.complete' : 'scope.incomplete')
  const fixed = SCOPE_FIXED[s as keyof typeof SCOPE_FIXED]
  if (fixed) return translate(lang, fixed)
  let m = SCOPE_DAY.exec(s)
  if (m) {
    const key = m[7] === '1' ? 'scope.dayOne' : 'scope.day'
    const place = m[4] ? translate(lang, 'scope.countyOne', { county: m[4] }) : translate(lang, 'scope.countyMany', { rest: m[5], last: m[6] })
    return translate(lang, key, { date: dateLabel(`${m[3]}-${m[1]}-${m[2]}`, lang), place, n: m[7], state: state(m[8]) })
  }
  m = SCOPE_EARLIER.exec(s)
  if (m) {
    const key = m[2] === '1' ? 'scope.earlierOne' : 'scope.earlier'
    return translate(lang, key, { days: m[1], n: m[2], state: state(m[3]) })
  }
  m = SCOPE_MIDNIGHT.exec(s)
  if (m) {
    return translate(lang, 'scope.midnight', { date: dateLabel(`${m[3]}-${m[1]}-${m[2]}`, lang), time: m[4], n: m[5], state: state(m[6]) })
  }
  m = SCOPE_CALM.exec(s)
  return m ? translate(lang, 'scope.calm', { mph: m[1] }) : null
}

/** The Check step's search-scope paragraph in the reader's language; `lang` is the language the text is actually in.
 *  English is rebuilt from the same sentences too, so its dates read like the rest of the page and STEERS is glossed. */
export function searchScopeText(scope: string, lang: Lang): { text: string; lang: Lang } {
  const parts = scope.trim().split(/(?<=\.) +(?=[A-Z])/)
  const out = parts.map((p) => scopeSentence(p, lang))
  return out.every((p): p is string => p !== null) ? { text: out.join(' '), lang } : { text: scope, lang: 'en' }
}
