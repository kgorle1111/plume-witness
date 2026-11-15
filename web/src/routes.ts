import { REGIONS, regionFrom, regionQuery, type Regions } from './region.ts'

export type Page = 'landing' | 'replay' | 'spikes' | 'brief' | 'facility' | 'facilities' | 'timeline'

const VIEWS = new Set<Page>(['spikes', 'brief', 'facility', 'facilities', 'timeline'])

/** Existing replay links keep their original query parameters and step hashes; only a bare URL opens the landing page. */
export function pageFromLocation({ search, hash }: Pick<Location, 'search' | 'hash'>): Page {
  const params = new URLSearchParams(search)
  const view = params.get('view') as Page | null
  if (view && VIEWS.has(view)) return view
  if (view === 'replay' || ['intro', 'night', 'region', 'embed'].some((k) => params.has(k)) || hash) return 'replay'
  return 'landing'
}

/** The site header's pages, in order (SiteHeader.tsx). */
export const NAV_ITEMS = ['spikes', 'timeline', 'facilities', 'brief'] as const
export type NavView = (typeof NAV_ITEMS)[number]

/** Region-carrying page link: a Beaumont reader who opens Timeline and comes back to Past spikes is still in Beaumont. */
export function navHref(base: string, view: NavView, search: string, regions: Regions = REGIONS): string {
  return `${base}${regionQuery(regionFrom(search, regions), { view })}`
}

/** The replay for the reader's region: Houston keeps the demo-night link; any other region opens its own first night. */
export function replayHref(base: string, search: string, regions: Regions = REGIONS): string {
  return `${base}${regionQuery(regionFrom(search, regions), { intro: '0' })}#detect`
}

export const NIGHT_ID = /^\d{4}-\d{2}-\d{2}_\d{5}_[\d_]+$/

/**
 * A region replay without ?night= has no demo night of its own (event.json is Houston's): open the region's first
 * listed night instead of silently showing Houston. Null when the index lists no usable night.
 */
export function regionStartNight(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null
  for (const r of rows) {
    const id = (r as { id?: unknown } | null)?.id
    if (typeof id === 'string' && NIGHT_ID.test(id)) return id
  }
  return null
}
