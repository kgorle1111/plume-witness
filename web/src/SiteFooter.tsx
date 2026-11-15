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
  return (
    <footer className="site-foot">
      <span title={t('foot.license')}>{t('foot.license')}</span>
      <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('foot.docs')}</a>
      <a href={navHref(BASE, 'facilities', window.location.search)}>{t('common.facilities')}</a>
      <a href={navHref(BASE, 'spikes', window.location.search)}>{t('common.pastSpikes')}</a>
      <a href={wrongHref()} target="_blank" rel="noopener" onPointerDown={refresh} onFocus={refresh}>{t('foot.wrong')}</a>
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
