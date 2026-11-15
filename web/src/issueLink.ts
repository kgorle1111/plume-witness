const NEW_ISSUE = 'https://github.com/kgorle1111/plume-witness/issues/new'

/** Only the page address and a blank template go into the link: nothing about the reader, their place or their language settings. */
export function issueHref(title: string, body: string): string {
  return `${NEW_ISSUE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

/** The current page as path + query + hash, without the origin. */
export const pageRef = (loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string => loc.pathname + loc.search + loc.hash
