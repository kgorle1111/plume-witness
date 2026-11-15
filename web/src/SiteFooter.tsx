import { InstallHint } from './InstallHint'
import { issueHref, pageRef } from './issueLink'
import { navHref } from './routes'
import { ThemeToggle } from './ThemeToggle'
import { useT } from './useT'

const BASE = import.meta.env.BASE_URL

/** One line on every page: where the data comes from, the license, the open-data docs, and "About this site". */
export function SiteFooter() {
  const t = useT()
  const wrongHref = () => { const page = pageRef(window.location); return issueHref(t('foot.wrongTitle', { page }), t('foot.wrongBody', { page })) }
  // The hash changes without re-rendering the footer, so the link is rebuilt just before it is followed.
  const refresh = (e: { currentTarget: HTMLAnchorElement }) => { e.currentTarget.href = wrongHref() }
  const search = window.location.search
  return (
    <footer className="site-foot">
      <span>{t('foot.license')}</span>
      <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('foot.docs')}</a>
      <a href={navHref(BASE, 'facilities', search)}>{t('common.facilities')}</a>
      <a className="foot-spikes" href={navHref(BASE, 'spikes', search)}>{t('common.pastSpikes')}</a>
      {/* The phone replay header keeps only Past spikes (App.css); index.css shows these two there and only there. */}
      <a className="foot-phone-replay" href={navHref(BASE, 'timeline', search)}>{t('app.linkTimeline')}</a>
      <a className="foot-phone-replay" href={navHref(BASE, 'brief', search)}>{t('app.linkBrief')}</a>
      <a href={wrongHref()} target="_blank" rel="noopener" onPointerDown={refresh} onFocus={refresh}>
        {t('foot.wrong')}<span className="sr-only">{t('chk.newTab')}</span>
      </a>
      <details className="site-about">
        <summary>{t('foot.about')}</summary>
        <div className="site-about-body">
          <p className="site-corrections">{t('foot.corrections')}</p>
          <InstallHint />
        </div>
      </details>
      <ThemeToggle />
    </footer>
  )
}
