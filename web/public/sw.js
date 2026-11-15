// Plume Witness service worker. Hand-written, no dependencies. The build id below is stamped at build time by
// the plugin in vite.config.ts (dev never registers this file); dist/precache.json lists what to cache.
const BUILD = '__BUILD_ID__'
const SHELL = `pw-shell-${BUILD}`
const TILES = 'pw-tiles-v1' // survives deploys; bounded below
const TILE_HOST = 'tiles.openfreemap.org'
const TILE_MAX = 150
const NAV_TIMEOUT_MS = 4000
const JSON_TIMEOUT_MS = 3000
const TIMED_OUT = Symbol('timeout')

const scope = new URL(self.registration.scope)
const INDEX = scope.href

self.addEventListener('install', (event) => {
  // Take over at once: phones keep tabs open for days, so a waiting worker would leave the old build (and old fetch
  // rules) in place. A page left open across a deploy can then ask for a chunk the new build dropped; pwa.ts sees the
  // new worker take control and offers a reload.
  event.waitUntil((async () => {
    const res = await fetch(new URL('precache.json', scope), { cache: 'reload' })
    if (!res.ok) throw new Error(`precache.json: HTTP ${res.status}`)
    const { urls } = await res.json()
    const old = await previousShells()
    // Everything is fetched before anything is stored, so a failed install leaves no half-filled cache behind.
    const entries = await Promise.all(urls.map(async (u) => {
      const url = new URL(u, scope)
      if (!IMMUTABLE(u)) return [url, await precacheFetch(url, 'reload')]
      // A hashed file never changes under its name: a returning phone keeps last build's copy instead of fetching
      // it again, and a first visit lets the HTTP cache answer for what the page itself just loaded.
      for (const c of old) {
        const hit = await c.match(url)
        if (hit) return [url, hit]
      }
      return [url, await precacheFetch(url, 'default')]
    }))
    const cache = await caches.open(SHELL)
    for (const [url, r] of entries) await cache.put(url, r)
    await self.skipWaiting()
  })())
})

// Vite's hashed build output; the shell (./), JSON and icons keep their names across builds, so they are re-read.
const IMMUTABLE = (u) => u.startsWith('assets/')

async function precacheFetch(url, mode) {
  const r = await fetch(new Request(url, { cache: mode }))
  if (!r.ok) throw new Error(`precache ${url.pathname}: HTTP ${r.status}`)
  return r
}

async function previousShells() {
  const keys = (await caches.keys()).filter((k) => k.startsWith('pw-shell-') && k !== SHELL)
  return Promise.all(keys.map((k) => caches.open(k)))
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('pw-shell-') && k !== SHELL) await caches.delete(k)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.hostname === TILE_HOST) return void event.respondWith(tile(req))
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  const rel = url.pathname.slice(scope.pathname.length)
  if (req.mode === 'navigate') return void event.respondWith(navigation(req, rel))
  if (req.headers.has('range')) return void event.respondWith(ranged(req, event))
  if (rel.endsWith('.json')) return void event.respondWith(networkFirst(req, event))
  event.respondWith(cacheFirst(req)) // hashed /assets/*, audio, icons, manifest
})

async function put(req, res) {
  if (res.ok) await (await caches.open(SHELL)).put(req, res.clone())
  return res
}

// Fresh data when the network answers; on lossy venue Wi-Fi a hung request would leave the page spinning, so after
// JSON_TIMEOUT_MS a cached copy wins (the network answer still lands in the cache for next time). With no cached
// copy there is nothing better to show, so it keeps waiting for the network.
async function networkFirst(req, event) {
  const net = fetch(req).then((res) => put(req, res))
  let timer
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, JSON_TIMEOUT_MS, TIMED_OUT) })
  try {
    const first = await Promise.race([net, slow])
    if (first !== TIMED_OUT) return first
  } catch (err) {
    const hit = await caches.match(req, { ignoreVary: true })
    if (hit) return hit
    throw err
  } finally {
    clearTimeout(timer)
  }
  const hit = await caches.match(req, { ignoreVary: true })
  if (!hit) return net
  event.waitUntil(net.catch(() => {}))
  return hit
}

// ignoreVary: a module script request carries Origin and some hosts answer "Vary: Origin" (vite preview does), so the
// precached copy, stored without one, never matched and the shell failed offline. Same-origin build files do not vary.
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true })
  if (hit) return hit
  return put(req, await fetch(req))
}

// App links carry ?night=, ?view=, #hash; they are all the one SPA shell. Only a navigation to the shell itself
// refreshes the cached shell: a night's link-preview page (s/<id>.html) or a feed opened in a tab is another document,
// and storing it as the shell would break the app offline.
async function navigation(req, rel) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('nav timeout')), NAV_TIMEOUT_MS)),
    ])
    if (res.ok && (rel === '' || rel === 'index.html')) await (await caches.open(SHELL)).put(INDEX, res.clone())
    return res
  } catch {
    return (await caches.match(INDEX)) ?? Response.error()
  }
}

// <audio> asks for byte ranges; Safari rejects a 200 answer to one, so cut the cached body into a 206.
// The narration clips are not precached (2 MB, and a visit plays at most one): the first play streams from the
// network and the whole clip is kept in the background, so it plays offline from then on.
async function ranged(req, event) {
  const plain = new Request(req.url)
  const hit = await caches.match(plain)
  if (!hit) {
    if (/^bytes=0-$/.test(req.headers.get('range') ?? '')) event.waitUntil(fetch(plain).then((res) => put(plain, res)).catch(() => {}))
    return fetch(req)
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (!m) return hit
  const buf = await hit.arrayBuffer()
  const start = m[1] === '' ? Math.max(0, buf.byteLength - Number(m[2])) : Number(m[1])
  const end = m[1] === '' || m[2] === '' ? buf.byteLength - 1 : Math.min(Number(m[2]), buf.byteLength - 1)
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.byteLength}` } })
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
    },
  })
}

// Offline the map may be blank; the Trace list works without it. Keep only the most recent TILE_MAX tiles.
async function tile(req) {
  const cache = await caches.open(TILES)
  try {
    const res = await fetch(req)
    if (res.ok) {
      await cache.put(req, res.clone())
      const keys = await cache.keys()
      for (const k of keys.slice(0, Math.max(0, keys.length - TILE_MAX))) await cache.delete(k)
    }
    return res
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}
