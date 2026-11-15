// The link to share for a night: its preview page (share/stubs.ts), which unfurls with the night's own title and
// description and then opens the replay. Pure so `node --test` can load it.
import { STUB_ID, STUB_STEPS, stubPath } from '../share/stubs.ts'

/**
 * `${origin}${base}s/<id>.html`, plus `#<step>` for any step but Detect. Every night the site lists has a stub (the
 * build writes one per index row); null for anything else (the demo night served from event.json, a malformed id),
 * where the caller keeps sharing the page URL.
 */
export function shareUrl(base: string, origin: string, nightId: string | null | undefined, step?: string): string | null {
  if (!nightId || !STUB_ID.test(nightId)) return null
  const hash = step && step !== 'detect' && (STUB_STEPS as readonly string[]).includes(step) ? `#${step}` : ''
  return `${origin}${base}${stubPath(nightId)}${hash}`
}

/**
 * The link the copied incident note carries: the preview page of the night this replay shows (its `?night=`; App
 * writes it into the URL even when a region opened its first night), on the Check step. Null on the demo night,
 * which has no `?night=`, so the caller keeps the replay URL there.
 */
export function noteShareUrl(base: string, href: string): string | null {
  const u = new URL(href)
  return shareUrl(base, u.origin, u.searchParams.get('night'), 'check')
}
