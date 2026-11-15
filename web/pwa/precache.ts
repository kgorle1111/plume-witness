// Pure helpers for the service-worker precache list; no dependencies so the node tests and vite.config.ts can both import it.
import { createHash } from 'node:crypto'

/** Public files the offline demo replay needs, besides the built shell. */
const PUBLIC_EXACT = new Set([
  'event.json', 'packet.ai.json', 'spikes.json', 'rose.json',
  'favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
])
const PUBLIC_PREFIXES = ['audio/']

/**
 * `distFiles` are paths relative to dist/ with forward slashes. Returns scope-relative URLs:
 * './' stands for index.html (navigations are served from it), everything else is its own path.
 */
export function precacheList(distFiles: string[]): string[] {
  const out = new Set<string>(['./'])
  for (const f of distFiles) {
    if (f === 'index.html') continue
    if (f.startsWith('assets/') && !f.endsWith('.map')) out.add(f)
    else if (PUBLIC_EXACT.has(f) || PUBLIC_PREFIXES.some((p) => f.startsWith(p))) out.add(f)
  }
  return [...out].sort()
}

/** Changes whenever any precached byte changes, so sw.js changes and the browser installs the new worker. */
export function buildId(entries: [path: string, bytes: Uint8Array][]): string {
  const h = createHash('sha256')
  for (const [p, b] of [...entries].sort((a, c) => (a[0] < c[0] ? -1 : 1))) h.update(p).update('\0').update(b).update('\0')
  return h.digest('hex').slice(0, 12)
}
