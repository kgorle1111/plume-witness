export type Page = 'landing' | 'replay' | 'spikes' | 'brief' | 'facility' | 'facilities'

const VIEWS = new Set<Page>(['spikes', 'brief', 'facility', 'facilities'])

/** Existing replay links keep their original query parameters and step hashes; only a bare URL opens the landing page. */
export function pageFromLocation({ search, hash }: Pick<Location, 'search' | 'hash'>): Page {
  const params = new URLSearchParams(search)
  const view = params.get('view') as Page | null
  if (view && VIEWS.has(view)) return view
  if (view === 'replay' || ['intro', 'night', 'region', 'embed'].some((k) => params.has(k)) || hash) return 'replay'
  return 'landing'
}

