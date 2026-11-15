// The replay's deck.gl (with luma.gl, ~250 kB gzip) waits for its basemap: on a throttled phone it competed with
// MapLibre and the tiles for the network and the main thread, and the basemap's first full render came ~4.5 s after
// the dots. EventMap.tsx imports deckKit.ts when this says so. No imports here, so node:test runs it directly.

/** The slice of a MapLibre map the gate listens to. */
export interface BaseMapEvents {
  once(type: 'load', fn: () => void): unknown
  on(type: 'error', fn: () => void): unknown
  off(type: 'load' | 'error', fn: () => void): unknown
  isStyleLoaded(): boolean | void
}

/** Past this, deck.gl loads even if the basemap has not finished (a tile request that never answers). At 4x CPU and
 *  Slow 4G the basemap's first full render came ~4.4 s after the map was created. */
export const DECK_FALLBACK_MS = 10_000

/**
 * Calls `start` once, at the first of: the map's first full render (`load`), a basemap failure before its style
 * loaded (the dots still draw, on a blank map), or `fallbackMs`. Returns a cancel for the component's cleanup.
 */
export function afterBaseMap(
  map: BaseMapEvents,
  start: () => void,
  fallbackMs = DECK_FALLBACK_MS,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): () => void {
  let done = false
  const stop = () => {
    done = true
    map.off('load', fire)
    map.off('error', onError)
    timers.clear(timer)
  }
  function fire() {
    if (done) return
    stop()
    start()
  }
  // A tile error after the style loaded still ends in `load` (errored tiles count as settled), so only an error
  // before the style loads means `load` may never come.
  function onError() {
    if (!map.isStyleLoaded()) fire()
  }
  map.once('load', fire)
  map.on('error', onError)
  const timer = timers.set(fire, fallbackMs)
  return stop
}
