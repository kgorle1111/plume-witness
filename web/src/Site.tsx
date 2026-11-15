import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent } from 'react'
import App from './App'
import { AtlasLanding } from './AtlasLanding'
import { pageFromLocation, type Page } from './routes'
import { DEFAULT_REGION, regionFrom, regionUnknown } from './region'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { useLang, useT } from './useT'
import type { StringKey } from './i18n'

// ?view=spikes opens the past-spikes log; its code and spikes.json load only then.
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

  if (page !== 'replay' && page !== 'landing') {
    const loading = t(LOADING[page])
    const region = regionFrom(window.location.search)
    return (
      <div className="site-shell">
        <SiteHeader current={page} />
        {regionUnknown(window.location.search) && <p className="site-region-note" role="note">{t('region.unknown')}</p>}
        {page !== 'spikes' && page !== 'brief' && region.key !== DEFAULT_REGION && (
          <p className="site-region-note" role="note">{t('shell.houstonOnly', { region: region.name[lang] })}</p>
        )}
        {/* The header and footer paint at once; only main waits for the page's code and data. */}
        <Suspense fallback={<main className="state-msg" aria-busy="true"><p>{loading}</p></main>}>
          {page === 'spikes' && <SpikeLog />}
          {page === 'timeline' && <SpikeRain />}
          {page === 'brief' && <Brief />}
          {(page === 'facility' || page === 'facilities') && <FacilityViews view={page} />}
        </Suspense>
        <SiteFooter />
      </div>
    )
  }

  return (
    <>
      {page === 'replay' && <div className="replay-entry" ref={replayEntry} tabIndex={-1} inert={leaving}><App /></div>}
      {(page === 'landing' || leaving) && <AtlasLanding leaving={leaving} onEnter={enter} onExit={() => setLeaving(false)} />}
      {page === 'landing' && <SiteFooter />}
    </>
  )
}
