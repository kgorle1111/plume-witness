// Feed addresses for the Follow controls. Self-contained, so `node --test` can load it without a bundler.
// The feeds are static files written by pipeline/feeds.py into public/feeds/.

/** site_ids are TCEQ ids like 48_201_0069; anything else gets no link rather than a broken one. */
const SITE_ID = /^\d{2}_\d{3}_\d{4}$/

export function feedPath(siteId?: string): string | null {
  if (siteId === undefined) return 'feeds/all.xml'
  return SITE_ID.test(siteId) ? `feeds/${siteId}.xml` : null
}

/** Absolute URL, because a feed reader needs the full address (a relative href would copy as a path). */
export function feedUrl(base: string, origin: string, siteId?: string): string | null {
  const p = feedPath(siteId)
  return p && new URL(`${base}${p}`, origin).href
}

export const FOLLOW_HELP = 'Paste this link into any feed reader (e.g. Feedly, NetNewsWire) to get new spikes.'
