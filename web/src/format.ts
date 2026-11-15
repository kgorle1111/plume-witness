import type { Status } from './types'

// Status words are fixed by the contract's STATUSES; never add a verdict word here.
export const STATUS_TEXT: Record<Status, { en: string; icon: 'check' | 'clock' | 'alert' | 'mismatch' | 'question' }> = {
  reported: { en: 'Reported', icon: 'check' },
  not_yet_reported: { en: 'Not yet reported', icon: 'clock' },
  no_report_after_deadline: { en: 'No report after the deadline', icon: 'alert' },
  reported_mismatch: { en: "Reported, but doesn't match", icon: 'mismatch' },
  search_incomplete: { en: 'Search incomplete', icon: 'question' },
}

export function statusInfo(s: string) {
  return (STATUS_TEXT as Record<string, (typeof STATUS_TEXT)[Status]>)[s] ?? { en: `Unknown status (${s})`, icon: 'alert' as const }
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00 CST`
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
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
