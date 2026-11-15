// Which dataset a page reads: ?region=beaumont picks the Beaumont-Port Arthur files; anything else is Houston.
// Pure (imports only i18n.ts) so `node --test` can load it without a bundler.
import { translate, type Lang } from './i18n.ts'

export type RegionKey = 'houston' | 'beaumont'

export interface RegionInfo {
  key: RegionKey
  /** Label on the region switch. */
  label: string
  /** Short place name for headings. */
  place: string
  /** Folder under web/public that holds spikes.json and nights/ ('' is the root, Houston's files). */
  dir: string
  backtested: boolean
}

export const REGIONS: Record<RegionKey, RegionInfo> = {
  houston: { key: 'houston', label: 'Houston Ship Channel', place: 'Houston Ship Channel', dir: '', backtested: true },
  beaumont: {
    key: 'beaumont', label: 'Beaumont-Port Arthur (new, not backtested)', place: 'Beaumont-Port Arthur',
    dir: 'regions/beaumont/', backtested: false,
  },
}

/** Shown wherever Beaumont data appears; the pipeline writes the same sentence into its files. */
export const NOT_BACKTESTED_NOTE = 'New region: no backtest yet; statuses use the same rules; no claims are made from it.'

export function regionFrom(search: string): RegionInfo {
  return new URLSearchParams(search).get('region') === 'beaumont' ? REGIONS.beaumont : REGIONS.houston
}

/** Query string for a page in a region; Houston keeps its old URLs (no region param). */
export function regionQuery(r: RegionInfo, params: Record<string, string>): string {
  const q = new URLSearchParams(params)
  if (r.key !== 'houston') q.set('region', r.key)
  const s = q.toString()
  return s ? `?${s}` : ''
}

const COMPOUND_KEY: Record<string, 'benzene' | 'butadiene'> = { benzene: 'benzene', '1,3-butadiene': 'butadiene' }

/** A compound name in the reader's language; an unknown one stays as the pipeline wrote it. */
export function compoundLabel(lang: Lang, compound: string): string {
  const c = COMPOUND_KEY[compound]
  return c ? translate(lang, `app.cmp.${c}`) : compound
}

/**
 * The replay title in the reader's language. The pipeline writes English titles; one that the English template does not
 * rebuild exactly (a fixture, a new wording) is shown as written and marked English, never guessed at.
 */
export function eventTitle(lang: Lang, title: string, compound: string, region: RegionKey): { text: string; lang: Lang } {
  const c = COMPOUND_KEY[compound]
  if (!c) return { text: title, lang: 'en' }
  const build = (l: Lang) => translate(l, `app.title.${c}`, { where: translate(l, `app.where.${region}`) })
  return build('en') === title ? { text: build(lang), lang } : { text: title, lang: 'en' }
}
