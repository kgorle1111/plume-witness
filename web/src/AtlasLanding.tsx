import { Component, lazy, Suspense, useEffect, type MouseEventHandler, type ReactNode } from 'react'
import { DEMO_REPLAY_HREF } from './demoHref'
import { LANDING_METRICS as M } from './landingMetrics'
import { SiteHeader } from './SiteHeader'
import { useLang, useT } from './useT'
import './AtlasLanding.css'

const AtlasGlobe = lazy(() => import('./AtlasGlobe'))
const REPO = 'https://github.com/kgorle1111/plume-witness'

/** A globe chunk that fails to load (venue Wi-Fi) leaves an empty disc, not a blank page: the text and the button stay. */
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('Landing globe failed to load', error)
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
  const t = useT()
  const lang = useLang()
  return (
    <main
      className={`atlas-landing${leaving ? ' atlas-leaving' : ''}`}
      inert={leaving}
      onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) onExit() }}
    >
      {/* The skip link goes to the title, as on every other page (the first Tab used to land on the brand). */}
      <SiteHeader className="atlas-masthead" skipTo="atlas-title" showNeighborhood />

      <section className="atlas-hero" aria-labelledby="atlas-title">
        <h1 id="atlas-title">{t('landing.title')}</h1>
        <p className="atlas-sub">{t('landing.sub')}</p>
        <div className="atlas-plate">
          <div className="atlas-grid" aria-hidden="true" />
          <svg className="atlas-survey" viewBox="0 0 650 462" fill="none" aria-hidden="true">
            <circle cx="325" cy="231" r="218" strokeDasharray="1 5" />
            <circle cx="325" cy="231" r="208" />
            <path className="atlas-survey-accent" d="M142 131a208 208 0 0 1 72-76M508 331a208 208 0 0 1-72 76" />
            <path d="M325 0v29m0 404v29M94 231h29m404 0h29M168 74l13 13m288 288 13 13m0-314-13 13M181 375l-13 13" />
            <path d="M0 231h86m478 0h86" strokeDasharray="3 5" />
          </svg>
          <div className="atlas-planet">
            <GlobeBoundary><Suspense><AtlasGlobe /></Suspense></GlobeBoundary>
          </div>
        </div>
        <p className="atlas-purpose">{t('landing.purpose')}</p>
        <a className="atlas-enter" href={DEMO_REPLAY_HREF} onClick={onEnter}>
          {t('landing.enter')}
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        {/* After the button, not before it: above it, this line pushed the button below the fold at 320x568. */}
        <p className="atlas-reframe">{t('landing.reframe', { spikes: M.spikes, noReport: M.noReport })}</p>
        <ul className="atlas-metrics" aria-label={t('landing.metrics')}>
          <li><b>{M.spikes}</b> {t('landing.m.spikes')}</li>
          <li><b>{M.monitors}</b> {t('landing.m.monitors')}</li>
          <li><b>{M.years}</b> {t('landing.m.years')}</li>
          <li className="atlas-own-line"><b>{M.noReport}</b> {t('landing.m.questions')} <span className="atlas-m-sub">({t('landing.m.questionsSub')})</span></li>
          <li className="atlas-own-line"><b>{M.residentsNearQuestions.toLocaleString(lang === 'es' ? 'es-US' : 'en-US')}</b> {t('landing.m.residents', { m: M.questionMonitors })}</li>
          <li className="atlas-own-line atlas-health">{t('landing.m.benzene')} <a href="https://www.epa.gov/sites/default/files/2016-09/documents/benzene.pdf" rel="noopener">{t('landing.m.benzeneLink')}</a></li>
          <li className="atlas-audit">
            {t('landing.m.auditLead')} <b>{t('landing.m.auditValue', { k: M.auditMissed, n: M.auditNights })}</b>{' '}
            {t('landing.m.audit', { upper: M.auditUpperPct, u: M.auditUnclear, n: M.auditNights })}
          </li>
        </ul>
        {/* The rigor behind the numbers, one line each, with the evidence one click away. */}
        <section className="atlas-how" aria-labelledby="atlas-how-title">
          <h2 id="atlas-how-title">{t('landing.how.title')}</h2>
          <ul>
            <li>{t('landing.how.files', { date: M.rawFetchedLatest })} <a href={`${REPO}/tree/main/data/raw`} rel="noopener">{t('landing.how.link')}</a></li>
            <li>{t('landing.how.backtest', { n: M.backtestReleases, s: M.backtestSpiked, m: M.backtestMatched })} <a href={`${REPO}/blob/main/docs/backtest.md`} rel="noopener">{t('landing.how.link')}</a></li>
            <li>{t('landing.how.audit', { n: M.auditNights, k: M.auditMissed, upper: M.auditUpperPct })} <a href={`${REPO}/blob/main/docs/audit-no-report.md`} rel="noopener">{t('landing.how.link')}</a></li>
            <li>{t('landing.how.ci')} <a href={`${REPO}/actions`} rel="noopener">{t('landing.how.link')}</a></li>
          </ul>
        </section>
      </section>
    </main>
  )
}
