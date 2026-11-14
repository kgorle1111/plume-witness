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
