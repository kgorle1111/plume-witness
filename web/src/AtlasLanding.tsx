import { lazy, Suspense, useEffect, type MouseEventHandler } from 'react'
import { DEMO_REPLAY_HREF } from './demoHref'
import './AtlasLanding.css'

const AtlasGlobe = lazy(() => import('./AtlasGlobe'))

export function AtlasLanding({ leaving, onEnter, onExit }: {
  leaving: boolean
  onEnter: MouseEventHandler<HTMLAnchorElement>
  onExit: () => void
}) {
  // The replay renames the tab after its night; coming back with the browser's Back button resets it.
  useEffect(() => { document.title = 'Plume Witness' }, [])
  return (
    <main
      className={`atlas-landing${leaving ? ' atlas-leaving' : ''}`}
      inert={leaving}
      onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) onExit() }}
    >
      <header className="atlas-masthead">
        <div className="atlas-signature">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="11.5" /><ellipse cx="16" cy="16" rx="5.5" ry="11.5" />
            <path d="M5 12h22M5 20h22M2 16h28M16 2v28" /><circle className="atlas-logo-dot" cx="23" cy="12" r="2.8" />
          </svg>
          <span>Plume Witness</span>
        </div>
      </header>

      <section className="atlas-hero" aria-labelledby="atlas-title">
        <h1 id="atlas-title">Trace air pollution</h1>
        <div className="atlas-plate" aria-hidden="true">
          <div className="atlas-grid" />
          <svg className="atlas-survey" viewBox="0 0 650 462" fill="none">
            <circle cx="325" cy="231" r="218" strokeDasharray="1 5" />
            <circle cx="325" cy="231" r="208" />
            <path className="atlas-survey-accent" d="M142 131a208 208 0 0 1 72-76M508 331a208 208 0 0 1-72 76" />
            <path d="M325 0v29m0 404v29M94 231h29m404 0h29M168 74l13 13m288 288 13 13m0-314-13 13M181 375l-13 13" />
            <path d="M0 231h86m478 0h86" strokeDasharray="3 5" />
          </svg>
          <div className="atlas-planet"><Suspense><AtlasGlobe /></Suspense></div>
        </div>
        <p className="atlas-purpose">Follow pollution spikes upwind and check them against public emissions reports to see what matches.</p>
        <a className="atlas-enter" href={DEMO_REPLAY_HREF} onClick={onEnter}>
          Enter the replay
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <a className="atlas-also" href={`${import.meta.env.BASE_URL}?view=timeline`}>Or watch two years of spikes</a>
      </section>
    </main>
  )
}
