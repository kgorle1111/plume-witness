// Run: npm test. When deck.gl starts loading on the replay and timeline maps (deckGate.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterBaseMap, DECK_FALLBACK_MS, type BaseMapEvents } from '../src/deckGate.ts'

// A MapLibre stand-in: records listeners so a test can fire `load` / `error` and check what was left attached.
function fakeMap(styleLoaded = false) {
  const once = new Map<string, Set<() => void>>(), on = new Map<string, Set<() => void>>()
  const add = (m: Map<string, Set<() => void>>, t: string, fn: () => void) => (m.get(t) ?? m.set(t, new Set()).get(t)!).add(fn)
  const map: BaseMapEvents & { emit(t: string): void; listeners(): number; styleLoaded: boolean } = {
    styleLoaded,
    once: (t, fn) => add(once, t, fn),
    on: (t, fn) => add(on, t, fn),
    off: (t, fn) => { once.get(t)?.delete(fn); on.get(t)?.delete(fn) },
    isStyleLoaded: () => map.styleLoaded,
    emit(t) {
      const o = [...(once.get(t) ?? [])]
      once.get(t)?.clear()
      ;[...o, ...(on.get(t) ?? [])].forEach((fn) => fn())
    },
    listeners: () => [...once.values(), ...on.values()].reduce((n, s) => n + s.size, 0),
  }
  return map
}

function fakeTimers() {
  const live = new Map<number, { fn: () => void; ms: number }>()
  let id = 0
  return {
    set: (fn: () => void, ms: number) => (live.set(++id, { fn, ms }), id),
    clear: (i: unknown) => { live.delete(i as number) },
    fire: () => [...live.entries()].forEach(([i, t]) => { live.delete(i); t.fn() }),
    live,
  }
}

test('deck.gl waits for the basemap: nothing starts until the first load', () => {
  const map = fakeMap(), timers = fakeTimers()
  let started = 0
  afterBaseMap(map, () => started++, 5000, timers)
  assert.equal(started, 0)
  map.emit('load')
  assert.equal(started, 1)
  // Later loads, errors and the fallback timer never start it twice, and nothing is left listening.
  map.emit('load')
  map.emit('error')
  timers.fire()
  assert.equal(started, 1)
  assert.equal(map.listeners(), 0)
  assert.equal(timers.live.size, 0)
})

test('a basemap that fails before its style loads still gets the dots (drawn on a blank map)', () => {
  const map = fakeMap(false), timers = fakeTimers()
  let started = 0
  afterBaseMap(map, () => started++, 5000, timers)
  map.emit('error')
  assert.equal(started, 1)
  assert.equal(map.listeners(), 0)
})

test('a tile error after the style loaded waits for load (errored tiles still end in load)', () => {
  const map = fakeMap(true), timers = fakeTimers()
  let started = 0
  afterBaseMap(map, () => started++, 5000, timers)
  map.emit('error')
  assert.equal(started, 0)
  map.emit('load')
  assert.equal(started, 1)
})

test('a basemap that never finishes falls back to the timer', () => {
  const map = fakeMap(), timers = fakeTimers()
  let started = 0
  afterBaseMap(map, () => started++, 5000, timers)
  assert.equal([...timers.live.values()][0].ms, 5000)
  timers.fire()
  assert.equal(started, 1)
  assert.equal(map.listeners(), 0)
})

test('the default fallback leaves the throttled phone profile room to finish its basemap', () => {
  const map = fakeMap(), timers = fakeTimers()
  afterBaseMap(map, () => {}, undefined, timers)
  assert.equal([...timers.live.values()][0].ms, DECK_FALLBACK_MS)
  assert.ok(DECK_FALLBACK_MS >= 8000, 'measured: ~4.4 s from map creation to load at 4x CPU + Slow 4G')
})

test('cancel (the map unmounted) means deck.gl never starts', () => {
  const map = fakeMap(), timers = fakeTimers()
  let started = 0
  const cancel = afterBaseMap(map, () => started++, 5000, timers)
  cancel()
  map.emit('load')
  timers.fire()
  assert.equal(started, 0)
  assert.equal(map.listeners(), 0)
})
