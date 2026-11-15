// Which dataset a page reads: ?region=<key> picks that region's files; no or an unknown key is Houston.
// The region list is regions.generated.json, written by `uv run python -m pipeline.regions --write-web` from
// pipeline/regions.py; adding a region needs no edit here.
// Pure (imports only i18n.ts and JSON) so `node --test` can load it without a bundler.
import { translate, type Lang } from './i18n.ts'
import registry from './regions.generated.json' with { type: 'json' }

export type RegionKey = string

/** One row of regions.generated.json (pipeline/regions.py web_registry). */
export interface RegionRow {
  key: string
  label: string
  label_es: string
  /** Event-title phrase: "<compound> spike <place>". */
  place: string
  place_es: string
  dir: string
  backtested: boolean
  n_sites: number
  county: string
  /** The clock monitor hours are published in, when not Texas's CST (Los Angeles: PST). */
  tz?: string
}

export interface RegionInfo {
  key: RegionKey
  /** Label on the region switch, in English (regionLabel gives the reader's language). */
  label: string
  /** Short place name for headings. */
  place: string
  /** Folder under web/public that holds spikes.json and nights/ ('' is the root, Houston's files). */
  dir: string
  backtested: boolean
  county: string
  nSites: number
  /** Monitor-hour clock label: CST (Texas) or PST (Los Angeles). */
  tz: string
  /** Short place name and event-title phrase per language. */
  name: Record<Lang, string>
  where: Record<Lang, string>
}

export type Regions = Readonly<Record<RegionKey, RegionInfo>>

export const DEFAULT_REGION = 'houston'
const KEY = /^[a-z][a-z0-9_]*$/


/** Builds the region table from registry rows; throws on a row the app could not load, so a bad file fails the tests. */
export function buildRegions(rows: readonly RegionRow[]): Regions {
  const out: Record<string, RegionInfo> = {}
  for (const r of rows) {
    if (!KEY.test(r.key) || Object.hasOwn(out, r.key)) throw new Error(`regions.generated.json: bad or repeated key ${r.key}`)
    if (r.dir !== (r.key === DEFAULT_REGION ? '' : `regions/${r.key}/`)) throw new Error(`regions.generated.json: bad dir for ${r.key}`)
    const name = { en: r.label, es: r.label_es }
    out[r.key] = {
      key: r.key, label: name.en, place: r.label, dir: r.dir, backtested: r.backtested,
      county: r.county, nSites: r.n_sites, tz: r.tz ?? 'CST', name, where: { en: r.place, es: r.place_es },
    }
  }
  if (!Object.hasOwn(out, DEFAULT_REGION)) throw new Error('regions.generated.json: Houston is missing')
  return out
}

export const REGIONS: Regions = buildRegions(registry as RegionRow[])

/** The region for a key, or Houston when the key is missing or unknown (own keys only: never "toString"). */
export function regionByKey(key: string | null | undefined, regions: Regions = REGIONS): RegionInfo {
  return key != null && Object.hasOwn(regions, key) ? regions[key] : regions[DEFAULT_REGION]
}

export function regionFrom(search: string, regions: Regions = REGIONS): RegionInfo {
  return regionByKey(new URLSearchParams(search).get('region'), regions)
}

/** True when ?region= names no known region: the page still shows Houston (regionFrom) but must say so. */
export function regionUnknown(search: string, regions: Regions = REGIONS): boolean {
  const r = new URLSearchParams(search).get('region')
  return r !== null && !Object.hasOwn(regions, r)
}

/** Query string for a page in a region; Houston keeps its old URLs (no region param). */
export function regionQuery(r: RegionInfo, params: Record<string, string>): string {
  const q = new URLSearchParams(params)
  if (r.key !== DEFAULT_REGION) q.set('region', r.key)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** The region switch label in the reader's language: the place name only (backtest results live in the docs). */
export function regionLabel(lang: Lang, r: RegionInfo): string {
  return r.name[lang]
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
export function eventTitle(lang: Lang, title: string, compound: string, region: RegionKey, regions: Regions = REGIONS): { text: string; lang: Lang } {
  const c = COMPOUND_KEY[compound]
  if (!c) return { text: title, lang: 'en' }
  const where = regionByKey(region, regions).where
  const build = (l: Lang) => translate(l, `app.title.${c}`, { where: where[l] })
  return build('en') === title ? { text: build(lang), lang } : { text: title, lang: 'en' }
}
