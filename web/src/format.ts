import type { Status } from './types'
import { translate, type Lang } from './i18n.ts'

// Status words are fixed by the contract's STATUSES; never add a verdict word here (in either language).
// kn: the Spanish has had no community reader's review; the UI names English as the reference next to it.
// `full` is the label where space allows ("a question" is the product's rule: a missing match is not a finding).
export type StatusIconKind = 'check' | 'clock' | 'alert' | 'mismatch' | 'question' | 'partial' | 'late'
type StatusLabel = { en: string; es: string; icon: StatusIconKind; full?: { en: string; es: string } }
export const STATUS_TEXT: Record<Status, StatusLabel> = {
  reported: { en: 'Reported', es: 'Reportado', icon: 'check' },
  reported_late: { en: 'Filed after the window', es: 'Presentado después del plazo', icon: 'late' },
  not_yet_reported: { en: 'Not yet reported', es: 'Todavía sin reporte', icon: 'clock' },
  no_report_after_deadline: {
    en: 'No matching report', es: 'Sin reporte que coincida', icon: 'question',
    full: { en: 'No matching report (a question)', es: 'Sin reporte que coincida (una pregunta)' },
  },
  reported_mismatch: { en: "Reported, but doesn't match", es: 'Reportado, pero no coincide', icon: 'mismatch' },
  search_incomplete: { en: 'Search incomplete', es: 'Búsqueda incompleta', icon: 'partial' },
}

// Status colours. Text on white needs 4.5:1 and marks 3:1 (test/statusColour.test.ts checks both). The open-question
// amber is the only amber here; red (--trigger) is reserved for the monitor spike and never a status.
// index.css repeats the amber and slate values as --q-* / --pending-*; the same test keeps them equal.
export const STATUS_FILL: Record<string, string> = {
  no_report_after_deadline: '#b45309',
  reported_mismatch: '#7a3fb0',
  search_incomplete: '#8a8a94',
  not_yet_reported: '#3d5a80',
  reported_late: '#2f6f73',
  reported: '#1f7a45',
}

/** The label to show where there is room for it (falls back to the short chip text). */
export function statusLabel(s: string, lang: 'en' | 'es'): string {
  const i = statusInfo(s)
  return i.full?.[lang] ?? i[lang]
}

export function statusInfo(s: string) {
  return (STATUS_TEXT as Record<string, StatusLabel>)[s]
    ?? { en: `Unknown status (${s})`, es: `Estado desconocido (${s})`, icon: 'alert' as const, full: undefined }
}

// Spanish for event.json's cannot_say lines, keyed by the English text. A line that isn't here (for example
// after the pipeline rewords it) falls back to English instead of showing a stale translation. A trailing
// citation such as "(30 TAC 101.201)" is matched separately and carried over unchanged.
const CANNOT_SAY_ES: Record<string, string> = {
  'A matching report is not proof the facility caused every reading; other sources can add to a spike':
    'Un reporte que coincide no prueba que la instalación causó cada lectura; otras fuentes pueden sumarse a un pico',
  'The upwind corridor comes from wind direction at one monitor (geometry only), not a dispersion model; it cannot tell facilities along the same bearing apart':
    'El corredor viento arriba sale de la dirección del viento en un monitor (solo geometría), no de un modelo de dispersión; no puede distinguir entre instalaciones en la misma dirección',
  'Facility coordinates are as published by EPA ECHO and may be approximate':
    'Las coordenadas de las instalaciones son las que publica EPA ECHO y pueden ser aproximadas',
  'Only regulator-grade monitors whose data the state publishes are used (including two industry-funded Houston Regional Monitoring sites), never low-cost sensors':
    'Solo se usan monitores de grado regulatorio cuyos datos publica el estado (incluidos dos sitios de Houston Regional Monitoring financiados por la industria), nunca sensores de bajo costo',
  'Only regulator-grade monitors whose data the state publishes are used, never low-cost sensors':
    'Solo se usan monitores de grado regulatorio cuyos datos publica el estado, nunca sensores de bajo costo',
  "'Not yet reported' is not a finding about any facility: Texas requires a report only at or above a reportable quantity, and air readings cannot measure how much was released":
    '«Todavía sin reporte» no es una conclusión sobre ninguna instalación: Texas exige un reporte solo cuando se alcanza o se supera una cantidad reportable, y las lecturas del aire no pueden medir cuánto se liberó',
  // pipeline/build.py BORROWED_WIND_CAVEAT: only on nights whose wind was measured at another monitor.
  'The wind used here was measured at a nearby monitor, not at the monitor that flagged the spike, so the upwind direction there may differ':
    'El viento usado aquí se midió en un monitor cercano, no en el monitor que marcó el pico, así que la dirección viento arriba allí puede ser distinta',
  // Same sentence as region.notBacktested (i18n.ts); Beaumont nights carry it as a cannot_say line.
  'Outside the backtest: statuses use the same rules, but how well they work in this region is not measured':
    'Fuera de la prueba retrospectiva: los estados usan las mismas reglas, pero no se ha medido qué tan bien funcionan en esta región',
  // pipeline/regions.py BACKTESTED_NOTE; the "(n = 81, 2024-2025)" part is carried over as written.
  'Backtested against company-reported releases':
    'Probado retrospectivamente con liberaciones reportadas por las empresas',
  // Earlier pipeline wordings, kept so a cached older event.json still reads in Spanish.
  'Only regulator-grade state monitors are used; many neighborhoods have none':
    'Solo se usan monitores estatales de grado regulatorio; muchos vecindarios no tienen ninguno',
  "A missing report is not a finding about any facility: Texas requires a report only above a reportable quantity, and air readings can't measure how much was released":
    'La falta de un reporte no es una conclusión sobre ninguna instalación: Texas exige un reporte solo por encima de una cantidad reportable, y las lecturas del aire no pueden medir cuánto se liberó',
}

const normKey = (t: string) => t.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().replace(/\.$/, '')
const CANNOT_SAY_ES_NORM = new Map(Object.entries(CANNOT_SAY_ES).map(([k, v]) => [normKey(k), v]))

/** Spanish for one cannot_say line, or null when there is no reviewed-for-meaning match (caller shows English). */
export function cannotSayEs(en: string): string | null {
  const m = /^(.*?)\s*(\([^()]*\))\.?\s*$/.exec(en)
  const direct = CANNOT_SAY_ES_NORM.get(normKey(en))
  if (direct) return `${direct}.`
  if (m) {
    const base = CANNOT_SAY_ES_NORM.get(normKey(m[1]))
    if (base) return `${base} ${m[2]}.`
  }
  return null
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00 CST`
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export function compass(deg: number, lang: 'en' | 'es' = 'en'): string {
  const c = COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
  // West is Oeste in Spanish; the other letters are the same.
  return lang === 'es' ? c.replaceAll('W', 'O') : c
}

/** Great-circle destination from (lat, lon) along `bearingDeg` for `km`. Returns [lon, lat]. */
export function destination(lat: number, lon: number, bearingDeg: number, km: number): [number, number] {
  const R = 6371.0088
  const d = km / R
  const b = (bearingDeg * Math.PI) / 180
  const p1 = (lat * Math.PI) / 180
  const l1 = (lon * Math.PI) / 180
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [(l2 * 180) / Math.PI, (p2 * 180) / Math.PI]
}

/** event.json is pipeline output, but a link target is still a trust boundary: only http(s) is rendered. */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** Merge ±halfWidth arcs around each bearing into non-overlapping [start, end] arcs (degrees, end > start,
 *  start in [0, 360)). Overlapping wind sectors become one wedge instead of stacked translucent fills. */
export function mergeArcs(bearings: number[], halfWidth: number): [number, number][] {
  if (!bearings.length || halfWidth <= 0) return []
  if (halfWidth >= 180) return [[0, 360]]
  const norm = (d: number) => ((d % 360) + 360) % 360
  const arcs = bearings.map((b) => [norm(b - halfWidth), norm(b - halfWidth) + 2 * halfWidth] as [number, number])
  arcs.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const a of arcs) {
    const last = merged[merged.length - 1]
    if (last && a[0] <= last[1]) last[1] = Math.max(last[1], a[1])
    else merged.push([...a])
  }
  // An arc that runs past 360° can join the first arc on the far side of north.
  if (merged.length > 1) {
    const first = merged[0], last = merged[merged.length - 1]
    if (last[1] - 360 >= first[0]) {
      last[1] = Math.max(last[1], first[1] + 360)
      merged.shift()
    }
  }
  const total = merged.reduce((n, [s, e]) => n + (e - s), 0)
  return total >= 360 ? [[0, 360]] : merged
}

/** Closed ring [lon, lat][] for a circular sector from (lat, lon) between bearings start..end, out to km. */
export function sectorRing(lat: number, lon: number, start: number, end: number, km: number): [number, number][] {
  const steps = Math.max(2, Math.ceil((end - start) / 2))
  const arc = Array.from({ length: steps + 1 }, (_, i) => destination(lat, lon, start + ((end - start) * i) / steps, km))
  return end - start >= 360 ? arc : [[lon, lat], ...arc, [lon, lat]]
}

/** A reading as text. Missing hours say so with their flag; a value is never filled in. */
export function readingText(value: number | null, flag: string | null, units: string): string {
  if (value === null) return flag ? `no data (${flag})` : 'no data'
  return `${value} ${units}`
}

// event.json gives concentrations as "ppb-v" (parts per billion by volume, as the state publishes them). Pages show
// "ppb", spell it out on the first mention, and explain the "-v" in a tooltip (Unit.tsx). Numbers are never touched.
const PPB = /^ppb(-?v)?$/i

/** Display form of a concentration unit: "ppb-v" reads as "ppb"; any other unit is shown as given. */
export function unitShort(units: string): string {
  return PPB.test(units.trim()) ? 'ppb' : units
}

/** The unit spelled out: "parts per billion", or "parts per billion by volume" when the data says "ppb-v", so the
 *  "-v" is explained in the text and not only in a tooltip a touch screen cannot open. Null for any other unit. */
export function unitLong(units: string, lang: Lang = 'en'): string | null {
  const m = PPB.exec(units.trim())
  if (!m) return null
  return translate(lang, m[1] ? 'unit.ppbvLong' : 'unit.ppbLong')
}

/** First-mention form, e.g. "parts per billion by volume (ppb)"; a unit that isn't ppb is shown as given. */
export function unitFirst(units: string, lang: Lang = 'en'): string {
  const long = unitLong(units, lang)
  return long ? `${long} (ppb)` : units
}

/** Tooltip for a ppb unit: what the "-v" means when the data says "ppb-v"; null for any other unit. */
export function unitTitle(units: string, lang: Lang = 'en'): string | null {
  const m = PPB.exec(units.trim())
  if (!m) return null
  return m[1] ? translate(lang, 'unit.ppbvTitle') : translate(lang, 'unit.ppbLong')
}

/** "HH:00" for the hourly table, whose column header already says CST. */
export function hourShort(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

/** Pounds as published by STEERS can carry three decimals ("8469.743"); whole pounds read better, and a small
 *  release keeps enough digits that it never shows as 0. */
export function poundsText(lb: number, lang: Lang = 'en'): string {
  const digits = lb >= 10 ? 0 : lb >= 1 ? 1 : 2
  return `${lb.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: digits })} lb`
}

/** STEERS spells the two tracked compounds several ways ("Benzene", "1,3-BUTADIENE", "1,3 Butadiene"). Those map
 *  to the monitor's own spelling; any other compound is returned as written. */
export function normCompound(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (s === 'benzene') return 'benzene'
  if (/^1,3[- ]?butadiene$/.test(s)) return '1,3-butadiene'
  return raw
}

/** The pipeline's alignment is a mean of cos(angle off the wind); as an angle it says how far off upwind a
 *  facility sits, which a number between 0 and 1 does not. */
export function offWindDeg(alignment: number): number {
  return Math.round((Math.acos(Math.max(0, Math.min(1, alignment))) * 180) / Math.PI)
}
