import { InstallHint } from './InstallHint'
import { navHref } from './routes'
import { ThemeToggle } from './ThemeToggle'
import { useT } from './useT'

const BASE = import.meta.env.BASE_URL

/** One line on every page: where the data comes from, the license, the open-data docs, and "About this site". */
export function SiteFooter() {
  const t = useT()
  return (
    <footer className="site-foot">
      <span title={t('foot.license')}>{t('foot.license')}</span>
      <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('foot.docs')}</a>
      <a href={navHref(BASE, 'facilities', window.location.search)}>{t('common.facilities')}</a>
      <a href={navHref(BASE, 'spikes', window.location.search)}>{t('common.pastSpikes')}</a>
      <details className="site-about">
        <summary>{t('foot.about')}</summary>
        <div className="site-about-body">
          <InstallHint />
        </div>
      </details>
      <ThemeToggle />
    </footer>
  )
}
