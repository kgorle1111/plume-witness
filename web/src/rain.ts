// Pure helpers for the spike-rain view (SpikeRain.tsx). Self-contained, with .ts imports, so
// `node --test test/rain.test.ts` can load it without a bundler.
import { statusInfo } from './format.ts'
import { monthYearLabel, translate, type Lang } from './i18n.ts'
import type { SpikeRow } from './spikes.ts'

const DAY_MS = 86_400_000
const EPOCH = Date.UTC(2024, 0, 1)
/** The timeline runs 2024-01-01 00:00 .. 2025-12-31 24:00 (2024 is a leap year: 366 + 365 days). */
export const TOTAL_DAYS = 731
export const MONTHS_TOTAL = 24

export const SPEEDS = [
  { key: 'week', label: '1 week/s', daysPerSec: 7 },
  { key: 'month', label: '1 month/s', daysPerSec: 30.4375 },
] as const
export type SpeedKey = (typeof SPEEDS)[number]['key']

/** A spike fades over this much animated time, whatever the speed. */
export const FADE_SECONDS = 2

export const fadeDaysFor = (daysPerSec: number) => FADE_SECONDS * daysPerSec

/** Whole days since 2024-01-01 for an ISO date; avoids Date() parsing a date as UTC midnight local-shifted. */
export function dayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS)
}

/** ISO date for a day index (0 = 2024-01-01), clamped to the timeline. */
export function isoFromDay(day: number): string {
  const d = new Date(EPOCH + Math.min(Math.max(Math.floor(day), 0), TOTAL_DAYS - 1) * DAY_MS)
  return d.toISOString().slice(0, 10)
}

export interface Timed {
  row: SpikeRow
  /** Days since 2024-01-01 00:00 (hour_cst/24 added; the hour is CST, shown as published). */
  at: number
  month: number
}

export const monthOfDate = (iso: string) => (Number(iso.slice(0, 4)) - 2024) * 12 + Number(iso.slice(5, 7)) - 1

/** Spikes in time order. Rows outside 2024-01-01..2025-12-31 are dropped rather than drawn off the scrubber. */
export function timeSpikes(rows: SpikeRow[]): Timed[] {
  return rows
    .map((row) => ({ row, at: dayIndex(row.date) + row.hour_cst / 24, month: monthOfDate(row.date) }))
    .filter((s) => s.at >= 0 && s.at < TOTAL_DAYS)
    .sort((a, b) => a.at - b.at || a.row.night_id.localeCompare(b.row.night_id))
}

export interface Visible {
  /** Index into the sorted spikes. */
  i: number
  /** 0 at the spike's hour, rising to 1 when it has faded out. */
  age: number
}

/** Spikes visible at day-time t, fading over fadeDays. A spike is visible on [at, at + fadeDays). */
export function visibleAt(spikes: readonly Timed[], t: number, fadeDays: number): Visible[] {
  const out: Visible[] = []
  if (!(fadeDays > 0)) return out
  // Sorted by time: find the first spike that could still be visible, stop at the first in the future.
  let lo = 0, hi = spikes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spikes[mid].at > t - fadeDays) hi = mid
    else lo = mid + 1
  }
  for (let i = lo; i < spikes.length && spikes[i].at <= t; i++) out.push({ i, age: (t - spikes[i].at) / fadeDays })
  return out
}

/** Opacity for a spike at `age` (0..1): full at the hour, easing out to nothing. */
export const fadeAlpha = (age: number) => (age <= 0 ? 1 : age >= 1 ? 0 : (1 - age) ** 1.6)

/** Dot radius in px: log scale on times-baseline (10x -> 5 px, 100x -> 9, 1000x -> 13, capped at 15). */
export function radiusPx(ratio: number | null): number {
  const r = ratio && ratio > 10 ? ratio : 10
  return Math.min(15, 5 + 4 * Math.log10(r / 10))
}

export type Counts = Record<string, number>

/** prefix[n] = status counts of the first n spikes, so a running count is one lookup. */
export function prefixCounts(spikes: readonly Timed[]): Counts[] {
  const out: Counts[] = [{}]
  for (const s of spikes) {
    const next = { ...out[out.length - 1] }
    next[s.row.status] = (next[s.row.status] ?? 0) + 1
    out.push(next)
  }
  return out
}

/** How many spikes have happened by day-time t. */
export function countAt(spikes: readonly Timed[], t: number): number {
  let lo = 0, hi = spikes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spikes[mid].at <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function monthStartDay(m: number): number {
  const y = 2024 + Math.floor(m / 12)
  return Math.round((Date.UTC(y, m % 12, 1) - EPOCH) / DAY_MS)
}

export function monthOfDay(day: number): number {
  const iso = isoFromDay(day)
  return monthOfDate(iso)
}

/** Screen-reader sentence for one month: counts only, in the record-check wording the rest of the site uses. */
export function monthSummary(spikes: readonly Timed[], m: number, lang: Lang = 'en'): string {
  const month = monthYearLabel(m, lang)
  const rows = spikes.filter((s) => s.month === m).map((s) => s.row)
  if (!rows.length) return translate(lang, 'rn.sumNone', { month })
  const by: Counts = {}
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1
  const monitors = new Set(rows.map((r) => r.site_id)).size
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${statusInfo(s)[lang].toLowerCase()}`).join(', ')
  return translate(lang, rows.length === 1 ? 'rn.sumOne' : 'rn.sumMany', {
    month, n: rows.length, m: monitors, monitors: translate(lang, monitors === 1 ? 'rn.monitorOne' : 'rn.monitorMany'), parts,
  })
}

/** Clamp a day-time to the scrubber's range. */
export const clampDay = (t: number) => Math.min(Math.max(t, 0), TOTAL_DAYS)

/** `?at=2024-06-15` -> day index, or null when absent or outside the timeline. */
export function dayFromParam(v: string | null): number | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = dayIndex(v)
  return d >= 0 && d < TOTAL_DAYS ? d : null
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
