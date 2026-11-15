import { InstallHint } from './InstallHint'
import { useT } from './useT'

const BASE = import.meta.env.BASE_URL

/** One line on every page: where the data comes from, the license, and the open-data docs. */
export function SiteFooter() {
  const t = useT()
  return (
    <footer className="site-foot">
      <span>{t('foot.license')}</span>
      <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('foot.docs')}</a>
      <a href={`${BASE}?view=facilities`}>{t('common.facilities')}</a>
      <a href={`${BASE}?view=spikes`}>{t('common.pastSpikes')}</a>
      <InstallHint />
    </footer>
  )
}
