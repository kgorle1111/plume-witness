import { Component, lazy, Suspense, useEffect, useState, type MouseEventHandler, type ReactNode } from 'react'
import { DEMO_REPLAY_HREF } from './demoHref'
import { LANDING_METRICS as M } from './landingMetrics'
import { SiteHeader } from './SiteHeader'
import { useT } from './useT'
import './AtlasLanding.css'

const AtlasGlobe = lazy(() => import('./AtlasGlobe'))
const BASE = import.meta.env.BASE_URL

/** A globe chunk that fails to load (venue Wi-Fi) leaves an empty disc, not a blank page: the text and the button stay. */
class GlobeBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('Landing globe failed to load', error)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function AtlasLanding({ leaving, onEnter, onExit }: {
  leaving: boolean
  onEnter: MouseEventHandler<HTMLAnchorElement>
  onExit: () => void
}) {
  // The replay renames the tab after its night; coming back with the browser's Back button resets it.
  useEffect(() => { document.title = 'Plume Witness' }, [])
  const [paused, setPaused] = useState(false)
  const [globeFailed, setGlobeFailed] = useState(false)
  const t = useT()
  return (
    <main
      className={`atlas-landing${leaving ? ' atlas-leaving' : ''}`}
      inert={leaving}
      onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) onExit() }}
    >
      <SiteHeader className="atlas-masthead" />

      <section className="atlas-hero" aria-labelledby="atlas-title">
        <h1 id="atlas-title">{t('landing.title')}</h1>
        <p className="atlas-sub">{t('landing.sub')}</p>
        <div className="atlas-plate" aria-hidden="true">
          <div className="atlas-grid" />
          <svg className="atlas-survey" viewBox="0 0 650 462" fill="none">
            <circle cx="325" cy="231" r="218" strokeDasharray="1 5" />
            <circle cx="325" cy="231" r="208" />
            <path className="atlas-survey-accent" d="M142 131a208 208 0 0 1 72-76M508 331a208 208 0 0 1-72 76" />
            <path d="M325 0v29m0 404v29M94 231h29m404 0h29M168 74l13 13m288 288 13 13m0-314-13 13M181 375l-13 13" />
            <path d="M0 231h86m478 0h86" strokeDasharray="3 5" />
          </svg>
          <div className="atlas-planet">
            <GlobeBoundary onFail={() => setGlobeFailed(true)}><Suspense><AtlasGlobe paused={paused} /></Suspense></GlobeBoundary>
          </div>
        </div>
        {/* Outside the aria-hidden plate so it stays reachable; hidden by CSS when reduced motion already stops the spin,
            and gone when the globe could not load. */}
        {!globeFailed && (
          <button type="button" className="atlas-pause" onClick={() => setPaused((p) => !p)}>
            {paused ? t('landing.spin') : t('landing.pause')}
          </button>
        )}
        <p className="atlas-purpose">{t('landing.purpose')}</p>
        <a className="atlas-enter" href={DEMO_REPLAY_HREF} onClick={onEnter}>
          {t('landing.enter')}
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <ul className="atlas-metrics" aria-label={t('landing.metrics')}>
          <li><b>{M.spikes}</b> {t('landing.m.spikes')}</li>
          <li><b>{M.monitors}</b> {t('landing.m.monitors')}</li>
          <li><b>{M.years}</b> {t('landing.m.years')}</li>
          <li className="atlas-own-line"><b>{M.noReport}</b> {t('landing.m.questions')} <span className="atlas-m-sub">({t('landing.m.questionsSub')})</span></li>
          <li className="atlas-audit"><b>{t('landing.m.auditValue', { k: M.auditMissed, n: M.auditNights })}</b> {t('landing.m.audit')}</li>
        </ul>
        <nav className="atlas-links" aria-label={t('landing.more')}>
          <a href={`${BASE}?view=spikes`}>{t('common.pastSpikes')}</a>
          <a href={`${BASE}?view=timeline`}>{t('landing.timeline')}</a>
          <a href={`${BASE}?view=facilities`}>{t('common.facilities')}</a>
          <a href={`${BASE}?view=brief`}>{t('landing.brief')}</a>
        </nav>
      </section>
    </main>
  )
}
