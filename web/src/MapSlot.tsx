import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react'
import type { EventMap as EventMapType } from './EventMap'
import { getLang, translate } from './i18n'
import { chunkUrl } from './loadError'

// MapLibre + deck.gl are ~90% of the JS. Loading them lazily lets the header, stepper and Detect numbers
// (the text that carries the event) render first on a slow phone connection. deck.gl comes later still, after the
// basemap's first render (EventMap.tsx, deckGate.ts); a failure there lands in this same boundary.
const loadMap = () => import('./EventMap').then((m) => ({ default: m.EventMap }))
// React.lazy caches a rejected import, so a retry swaps in a fresh lazy component.
let LazyMap = lazy(loadMap)

type MapProps = ComponentProps<typeof EventMapType>

/** A deploy while the page was open deletes the old hashed chunk, so retrying that URL 404s every time: only a reload
 *  gets the new one. HEAD skips the service worker (it answers GET only), so this asks the host itself. Offline or
 *  any other answer keeps the in-place retry.
 *  kn: checks the chunk the failed import names (EventMap, or deckKit for deck.gl's own import); a deploy that drops
 *  only the MapLibre chunk still loops on retry. */
async function chunkGone(error: unknown): Promise<boolean> {
  const url = chunkUrl(error)
  if (!url) return false
  try {
    return (await fetch(url, { method: 'HEAD', cache: 'no-store' })).status === 404
  } catch {
    return false
  }
}

class MapErrorBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean; gone: boolean }> {
  state = { failed: false, gone: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // A failed chunk download on cellular is the expected case; keep it visible in the console.
    console.warn('Map failed to load:', error)
    void chunkGone(error).then((gone) => { if (gone) this.setState({ gone: true }) })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const lang = getLang()
    return (
      <div className="map-skeleton" role="status">
        <p>{translate(lang, this.state.gone ? 'map.updated' : 'map.loadFailed')}</p>
        {this.state.gone
          ? <button type="button" className="btn" onClick={() => window.location.reload()}>{translate(lang, 'map.reload')}</button>
          : <button type="button" className="btn" onClick={this.props.onRetry}>{translate(lang, 'map.retry')}</button>}
      </div>
    )
  }
}

export function MapSlot(props: MapProps) {
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    LazyMap = lazy(loadMap)
    setAttempt((a) => a + 1)
  }
  return (
    <MapErrorBoundary key={attempt} onRetry={retry}>
      <Suspense fallback={<div className="map-skeleton" role="status"><p>{translate(getLang(), 'map.loadingMap')}</p></div>}>
        <LazyMap {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}
