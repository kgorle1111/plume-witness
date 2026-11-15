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
  // rules) in place. kn: a page left open across a deploy that then lazy-loads a chunk can 404 (old chunk gone from
  // cache and server); a reload fixes it. Reload-on-controllerchange if that bites.
  event.waitUntil((async () => {
    const res = await fetch(new URL('precache.json', scope), { cache: 'reload' })
    if (!res.ok) throw new Error(`precache.json: HTTP ${res.status}`)
    const { urls } = await res.json()
    const cache = await caches.open(SHELL)
    await cache.addAll(urls.map((u) => new Request(new URL(u, scope), { cache: 'reload' })))
    await self.skipWaiting()
  })())
})

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
  if (req.mode === 'navigate') return void event.respondWith(navigation(req))
  if (req.headers.has('range')) return void event.respondWith(ranged(req))
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

async function cacheFirst(req) {
  const hit = await caches.match(req)
  if (hit) return hit
  return put(req, await fetch(req))
}

// App links carry ?night=, ?view=, #hash; they are all the one SPA shell.
async function navigation(req) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('nav timeout')), NAV_TIMEOUT_MS)),
    ])
    if (res.ok) await (await caches.open(SHELL)).put(INDEX, res.clone())
    return res
  } catch {
    return (await caches.match(INDEX)) ?? Response.error()
  }
}

// <audio> asks for byte ranges; Safari rejects a 200 answer to one, so cut the cached body into a 206.
async function ranged(req) {
  const plain = new Request(req.url)
  const hit = await caches.match(plain)
  if (!hit) return fetch(req)
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
