import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react'
import type { EventMap as EventMapType } from './EventMap'
import { Radar } from './fx'

// MapLibre + deck.gl are ~90% of the JS. Loading them lazily lets the header, stepper and Detect numbers
// (the text that carries the event) render first on a slow phone connection.
const loadMap = () => import('./EventMap').then((m) => ({ default: m.EventMap }))
// The download starts when this module loads, alongside the event.json fetch, instead of after it: on a phone
// the map chunks were the last step of html -> app -> event.json -> map. The catch only silences an early
// failure before React attaches; the lazy component below still sees the rejection and shows the fallback.
const firstLoad = loadMap()
firstLoad.catch(() => {})
// React.lazy caches a rejected import, so a retry swaps in a fresh lazy component.
let LazyMap = lazy(() => firstLoad)

type MapProps = ComponentProps<typeof EventMapType>

class MapErrorBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // A failed chunk download on cellular is the expected case; keep it visible in the console.
    console.warn('Map failed to load:', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="map-skeleton is-error" role="status">
        <p>The map couldn't load. Every facility is listed as text in the Trace step.</p>
        <button type="button" className="btn" onClick={this.props.onRetry}>Try loading the map again</button>
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
      <Suspense fallback={<div className="map-skeleton is-loading" role="status"><Radar /><p>Loading map…</p></div>}>
        <LazyMap {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}
