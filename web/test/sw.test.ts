// Runs public/sw.js in a vm with fake caches/fetch/timers, so the fetch rules are checked without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const SCOPE = 'https://x.test/plume-witness/'

type Handler = (e: unknown) => void

function load(fetchImpl: (req: Request) => Promise<Response>, seed: Record<string, Record<string, string>> = {}) {
  const stores = new Map(Object.entries(seed).map(([k, v]) => [k, new Map(Object.entries(v))]))
  const timers: { fn: (v: unknown) => void; ms: number; arg: unknown; done: boolean }[] = []
  const calls = { skipWaiting: 0, claim: 0 }
  const handlers: Record<string, Handler> = {}
  const url = (r: Request | string) => (typeof r === 'string' ? r : r.url)
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)!
    return {
      put: async (r: Request | string, res: Response) => { m.set(url(r), await res.text()) },
      addAll: async (rs: Request[]) => { for (const r of rs) m.set(r.url, 'precached') },
    }
  }
  const caches = {
    open: async (name: string) => store(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: Request | string) => {
      for (const m of stores.values()) if (m.has(url(r))) return new Response(m.get(url(r)))
      return undefined
    },
  }
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
    skipWaiting: async () => { calls.skipWaiting++ },
    clients: { claim: async () => { calls.claim++ } },
  }
  const setTimeout = (fn: (v: unknown) => void, ms: number, arg: unknown) => { timers.push({ fn, ms, arg, done: false }); return timers.length }
  const clearTimeout = (id: number) => { if (timers[id - 1]) timers[id - 1].done = true }
  vm.runInNewContext(SRC, { self, caches, fetch: fetchImpl, setTimeout, clearTimeout, URL, Request, Response, Symbol, Promise, Error })
  const elapse = (ms: number) => { for (const t of timers) if (!t.done && t.ms <= ms) { t.done = true; t.fn(t.arg) } }
  const fire = (type: string, request?: Request) => {
    let responded: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    handlers[type]({ request, respondWith: (p: Promise<Response>) => { responded = p }, waitUntil: (p: Promise<unknown>) => { waits.push(p) } })
    return { responded, waits }
  }
  return { fire, elapse, stores, calls }
}

const flush = () => new Promise((r) => setImmediate(r))
const json = new Request(`${SCOPE}event.json`)
const hang = () => new Promise<Response>(() => {})

test('a hung event.json falls back to the cached copy after the timeout', { timeout: 2000 }, async () => {
  const sw = load(hang, { 'pw-shell-__BUILD_ID__': { [json.url]: 'cached' } })
  const { responded } = sw.fire('fetch', json)
  let settled = false
  void responded!.then(() => { settled = true })
  await flush()
  assert.equal(settled, false, 'answered before the timeout')
  sw.elapse(2999)
  await flush()
  assert.equal(settled, false, 'answered before 3 s')
  sw.elapse(3000)
  assert.equal(await (await responded!).text(), 'cached')
})

test('with no cached copy a slow event.json keeps waiting for the network', { timeout: 2000 }, async () => {
  let answer!: (r: Response) => void
  const sw = load(() => new Promise<Response>((r) => { answer = r }))
  const { responded } = sw.fire('fetch', json)
  let settled = false
  void responded!.then(() => { settled = true }, () => { settled = true })
  sw.elapse(3000)
  await flush()
  assert.equal(settled, false, 'gave up although there was nothing cached')
  answer(new Response('fresh'))
  assert.equal(await (await responded!).text(), 'fresh')
})

test('a fast network answer wins over the cache and is cached', { timeout: 2000 }, async () => {
  const sw = load(async () => new Response('fresh'), { 'pw-shell-__BUILD_ID__': { [json.url]: 'old' } })
  const { responded } = sw.fire('fetch', json)
  assert.equal(await (await responded!).text(), 'fresh')
  assert.equal(sw.stores.get('pw-shell-__BUILD_ID__')!.get(json.url), 'fresh')
})

test('install takes over at once; activate claims pages and drops old shell caches only', { timeout: 2000 }, async () => {
  const sw = load(async () => new Response(JSON.stringify({ urls: ['./', 'event.json'] })), {
    'pw-shell-old': { a: '1' }, 'pw-tiles-v1': { t: '1' },
  })
  await Promise.all(sw.fire('install').waits)
  assert.equal(sw.calls.skipWaiting, 1)
  await Promise.all(sw.fire('activate').waits)
  assert.equal(sw.calls.claim, 1)
  assert.deepEqual([...sw.stores.keys()].sort(), ['pw-shell-__BUILD_ID__', 'pw-tiles-v1'])
})
