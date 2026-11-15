// Which dataset a page reads: ?region=beaumont picks the Beaumont-Port Arthur files; anything else is Houston.
// Pure and self-contained so `node --test` can load it without a bundler.

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
