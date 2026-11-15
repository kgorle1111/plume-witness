// Pure helpers for the service-worker precache list; no dependencies so the node tests and vite.config.ts can both import it.
import { createHash } from 'node:crypto'

/**
 * Public files offline use needs, besides the built shell: the demo replay, Past spikes and Timeline, the night picker,
 * the Facilities list, the second night the demo opens (?night=2024-03-29_45201_48_201_0057#check), and each region's
 * small spike log and night index. Narration mp3s are left out (2 MB, at most one plays per visit): sw.js keeps a clip
 * once it has been played. Only audio/manifest.json (which clips exist) is precached.
 */
const PUBLIC_EXACT = new Set([
  'event.json', 'packet.ai.json', 'spikes.json', 'rose.json', 'audio/manifest.json',
  'nights/index.json', 'facilities/index.json', 'nights/2024-03-29_45201_48_201_0057.json',
  'favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
])
const PUBLIC_PATTERNS = [/^regions\/[a-z][a-z0-9_]*\/(spikes\.json|nights\/index\.json)$/]

/**
 * `distFiles` are paths relative to dist/ with forward slashes. Returns scope-relative URLs:
 * './' stands for index.html (navigations are served from it), everything else is its own path.
 */
export function precacheList(distFiles: string[]): string[] {
  const out = new Set<string>(['./'])
  for (const f of distFiles) {
    if (f === 'index.html') continue
    if (f.startsWith('assets/') && !f.endsWith('.map')) out.add(f)
    else if (PUBLIC_EXACT.has(f) || PUBLIC_PATTERNS.some((p) => p.test(f))) out.add(f)
  }
  return [...out].sort()
}

/** Changes whenever any precached byte changes, so sw.js changes and the browser installs the new worker. */
export function buildId(entries: [path: string, bytes: Uint8Array][]): string {
  const h = createHash('sha256')
  for (const [p, b] of [...entries].sort((a, c) => (a[0] < c[0] ? -1 : 1))) h.update(p).update('\0').update(b).update('\0')
  return h.digest('hex').slice(0, 12)
}
