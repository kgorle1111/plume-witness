export type Page = 'landing' | 'replay' | 'spikes'

/** Existing replay links keep their original query parameters and step hashes. */
export function pageFromLocation({ search, hash }: Pick<Location, 'search' | 'hash'>): Page {
  const params = new URLSearchParams(search)
  if (params.get('view') === 'spikes') return 'spikes'
  if (params.get('view') === 'replay' || params.has('intro') || params.has('night') || hash) return 'replay'
  return 'landing'
}

export const DEMO_REPLAY_HREF = `${import.meta.env.BASE_URL}?intro=0#detect`
