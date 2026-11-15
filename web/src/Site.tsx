import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent } from 'react'
import App from './App'
import { AtlasLanding } from './AtlasLanding'
import { pageFromLocation } from './routes'

// ?view=spikes opens the past-spikes log; its code and spikes.json load only then.
const SpikeLog = lazy(() => import('./SpikeLog'))
const SpikeRain = lazy(() => import('./SpikeRain'))
const Brief = lazy(() => import('./Brief'))
const FacilityViews = lazy(() => import('./FacilityViews'))

export default function Site() {
  const [page, setPage] = useState(() => pageFromLocation(window.location))
  const [leaving, setLeaving] = useState(false)
  const replayEntry = useRef<HTMLDivElement>(null)
  const focusAfterEntry = useRef(false)

  useEffect(() => {
    const followLocation = () => {
      focusAfterEntry.current = false
      setLeaving(false)
      setPage(pageFromLocation(window.location))
    }
    window.addEventListener('popstate', followLocation)
    window.addEventListener('hashchange', followLocation)
    return () => {
      window.removeEventListener('popstate', followLocation)
      window.removeEventListener('hashchange', followLocation)
    }
  }, [])

  useEffect(() => {
    if (leaving || page !== 'replay' || !focusAfterEntry.current) return
    focusAfterEntry.current = false
    window.scrollTo(0, 0)
    replayEntry.current?.focus({ preventScroll: true })
  }, [leaving, page])

  const enter = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    // Preserve the link destination and history, while loading the replay under the fading landing page.
    history.pushState(null, '', event.currentTarget.href)
    focusAfterEntry.current = true
    setLeaving(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    setPage('replay')
  }

  if (page === 'spikes') return (
    <Suspense fallback={<main className="state-msg"><p>Loading the spike log…</p></main>}>
      <SpikeLog />
    </Suspense>
  )

  if (page === 'timeline') return (
    <Suspense fallback={<main className="state-msg"><p>Loading two years of spikes…</p></main>}>
      <SpikeRain />
    </Suspense>
  )

  if (page === 'brief') return (
    <Suspense fallback={<main className="state-msg"><p>Loading the brief…</p></main>}>
      <Brief />
    </Suspense>
  )

  if (page === 'facility' || page === 'facilities') return (
    <Suspense fallback={<main className="state-msg"><p>Loading…</p></main>}>
      <FacilityViews view={page} />
    </Suspense>
  )

  return (
    <>
      {page === 'replay' && <div className="replay-entry" ref={replayEntry} tabIndex={-1} inert={leaving}><App /></div>}
      {(page === 'landing' || leaving) && <AtlasLanding leaving={leaving} onEnter={enter} onExit={() => setLeaving(false)} />}
    </>
  )
}
