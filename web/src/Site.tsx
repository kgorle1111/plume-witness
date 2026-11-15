import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent } from 'react'
// Import order is stylesheet order. App.css holds rules the other pages share (.btn, .seg, .state-msg, .skip-link), so
// it stays in the entry stylesheet now that the replay's code is lazy, in the place it had before: after the footer,
// header and language-switch styles, before the landing's.
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import './App.css'
import { AtlasLanding } from './AtlasLanding'
import { focusMainHeading } from './focusMain'
import { LoadBoundary } from './LoadBoundary'
import { pageFromLocation, strayViewSearch, type Page } from './routes'
import { DEFAULT_REGION, regionFrom, regionUnknown } from './region'
import { UpdateNotice } from './UpdateNotice'
import { useLang, useT } from './useT'
import type { StringKey } from './i18n'

// Each page's code (and the replay's) loads only when that page opens; the landing and Past spikes no longer
// download and run the replay. The landing fetches it while idle so "Enter the replay" still crossfades at once.
const loadApp = () => import('./App')
const App = lazy(loadApp)
const SpikeLog = lazy(() => import('./SpikeLog'))
const SpikeRain = lazy(() => import('./SpikeRain'))
const Brief = lazy(() => import('./Brief'))
const FacilityViews = lazy(() => import('./FacilityViews'))

const LOADING = {
  spikes: 'spikes.loading', timeline: 'rn.loading', brief: 'brief.loading', facility: 'fx.loadingOne', facilities: 'fx.loadingList',
} as const satisfies Record<Exclude<Page, 'landing' | 'replay'>, StringKey>

export default function Site() {
  const t = useT()
  const lang = useLang()
  const [page, setPage] = useState(() => pageFromLocation(window.location))
  const [leaving, setLeaving] = useState(false)
  const replayEntry = useRef<HTMLDivElement>(null)
  const focusAfterEntry = useRef(false)
  const focusHeading = useRef(false)

  useEffect(() => {
    const stray = strayViewSearch(window.location)
    if (stray !== null) history.replaceState(history.state, '', `${window.location.pathname}${stray}${window.location.hash}`)
    const followLocation = () => {
      const next = pageFromLocation(window.location)
      focusAfterEntry.current = false
      setLeaving(false)
      // Back/Forward to another page: start focus there. A step change inside the replay (hashchange) keeps focus.
      setPage((prev) => {
        if (prev !== next) {
          if (next === 'replay') focusAfterEntry.current = true
          else focusHeading.current = true
        }
        return next
      })
    }
    window.addEventListener('popstate', followLocation)
    window.addEventListener('hashchange', followLocation)
    return () => {
      window.removeEventListener('popstate', followLocation)
      window.removeEventListener('hashchange', followLocation)
    }
  }, [])

  useEffect(() => {
    if (!focusHeading.current) return
    focusHeading.current = false
    return focusMainHeading()
  }, [page])

  useEffect(() => {
    if (page !== 'landing') return
    const warm = () => { void loadApp().catch(() => { /* opening the replay retries; LoadBoundary reports a failure */ }) }
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(warm, { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(warm, 1500)
    return () => clearTimeout(id)
  }, [page])

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

  if (page !== 'replay' && page !== 'landing') {
    const loading = t(LOADING[page])
    const region = regionFrom(window.location.search)
    const unknown = regionUnknown(window.location.search)
    const houstonOnly = page !== 'spikes' && page !== 'brief' && region.key !== DEFAULT_REGION
    return (
      <div className="site-shell">
        <SiteHeader current={page} skipTo="main" />
        {/* Inside a landmark (axe "region"), so a reader moving by landmarks still meets the note. */}
        {(unknown || houstonOnly) && (
          <aside className="site-notes" aria-label={t('shell.notesLabel')}>
            {unknown && <p className="site-region-note" role="note">{t('region.unknown')}</p>}
            {houstonOnly && <p className="site-region-note" role="note">{t('shell.houstonOnly', { region: region.name[lang] })}</p>}
          </aside>
        )}
        {/* The header and footer paint at once; only main waits for the page's code and data. The wrapper is the skip
            link's target, since each page draws its own <main>. */}
        <div className="site-main" id="main">
          <LoadBoundary key={page}>
            <Suspense fallback={<main className="state-msg" aria-busy="true"><p>{loading}</p></main>}>
              {page === 'spikes' && <SpikeLog />}
              {page === 'timeline' && <SpikeRain />}
              {page === 'brief' && <Brief />}
              {(page === 'facility' || page === 'facilities') && <FacilityViews view={page} />}
            </Suspense>
          </LoadBoundary>
        </div>
        <SiteFooter />
        <UpdateNotice />
      </div>
    )
  }

  return (
    <>
      {page === 'replay' && (
        <div className="replay-entry" ref={replayEntry} tabIndex={-1} inert={leaving}>
          <LoadBoundary key="replay" shell="full">
            {/* The text App itself shows while its event loads, so the chunk and the data read as one wait. */}
            <Suspense fallback={<main className="state-msg" aria-busy="true"><p>{t('app.loadingEvent')}</p></main>}>
              <App />
            </Suspense>
          </LoadBoundary>
        </div>
      )}
      {(page === 'landing' || leaving) && (
        <LoadBoundary key="landing" shell="header">
          <AtlasLanding leaving={leaving} onEnter={enter} onExit={() => setLeaving(false)} />
        </LoadBoundary>
      )}
      {page === 'landing' && <SiteFooter />}
      <UpdateNotice />
    </>
  )
}
