// Pure helpers for the timeline page (SpikeRain.tsx, RainMap.tsx): its links, its shareable URL and its hover text.
// Imports only .ts files, so `node --test test/rainLinks.test.ts` loads it without a bundler.
import { hourLabel, statusLabel } from './format.ts'
import { dateLabel, type Lang } from './i18n.ts'
import { compoundLabel } from './region.ts'
import type { SpikeRow } from './spikes.ts'

/** A night's replay, straight to the flat map: the globe fly-in costs ~9 MB of tiles on every list click. */
export const nightHref = (base: string, id: string) => `${base}?night=${encodeURIComponent(id)}&intro=0`

/** The page's query string with `at` set to the date the reader stopped on (or removed), every other parameter kept. */
export function withAt(search: string, iso: string | null): string {
  const q = new URLSearchParams(search)
  if (iso) q.set('at', iso)
  else q.delete('at')
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** What a dot is, for the hover label: monitor, compound, when, and its record check in the "(a question)" wording. */
export function spikeTip(row: SpikeRow, lang: Lang): string {
  return [row.site, compoundLabel(lang, row.compound), `${dateLabel(row.date, lang)}, ${hourLabel(row.hour_cst)}`, statusLabel(row.status, lang)].join(' · ')
}
