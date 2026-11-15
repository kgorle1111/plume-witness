import type { ReactNode } from 'react'
import { LangSwitch } from './LangSwitch'
import { NAV_ITEMS, navHref, type NavView } from './routes'
import { useT } from './useT'
import './SiteHeader.css'

const BASE = import.meta.env.BASE_URL

/** Monitor dot with the upwind wedge it reads from; the same shapes the map uses. */
export function BrandMark() {
  return (
    <svg className="brand-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 18 L21 6.5 A16 16 0 0 1 22.5 15.5 Z" fill="rgb(190 30 45 / 0.16)" stroke="#be1e2d" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="4.2" fill="#be1e2d" stroke="#fff" strokeWidth="1.6" />
    </svg>
  )
}

const LABEL = { spikes: 'common.pastSpikes', timeline: 'app.linkTimeline', facilities: 'common.facilities', brief: 'app.linkBrief' } as const

/**
 * The one site header: brand (home), then Past spikes · Timeline · Facilities · Brief with the current page marked,
 * then the language switch. The replay passes its eyebrow and title as children, laid out by App.css's .top grid.
 * Links keep ?region= so a reader in any region stays in it.
 */
export function SiteHeader({ current, className = '', lang, children }: {
  /** The page in the nav this view is, or belongs to (one facility's page belongs to Facilities). */
  current?: NavView | 'facility'
  className?: string
  /** Replaces the default language switch (the replay hides the review note here; its panel shows it). */
  lang?: ReactNode
  children?: ReactNode
}) {
  const t = useT()
  const search = window.location.search
  const mark = current === 'facility' ? 'facilities' : current
  return (
    <header className={`site-head ${className}`.trim()}>
      <div className="brand-row">
        <a className="brand" href={BASE}>
          <BrandMark />
          <span className="brand-name">Plume Witness</span>
        </a>
        <nav className="site-nav" aria-label={t('app.siteLinks')}>
          {NAV_ITEMS.map((v) => (
            <a
              key={v}
              className={v === 'spikes' ? 'spikes-link' : 'top-link-more'}
              href={navHref(BASE, v, search)}
              // A facility's own page is inside Facilities: "true" marks the section without claiming it is that page.
              aria-current={v === mark ? (current === v ? 'page' : 'true') : undefined}
            >
              {t(LABEL[v])}
            </a>
          ))}
        </nav>
      </div>
      {children}
      {lang ?? <LangSwitch />}
    </header>
  )
}
