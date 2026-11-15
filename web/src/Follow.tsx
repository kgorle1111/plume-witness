import { feedUrl } from './feeds'
import { useT } from './useT'

/** RSS links for one monitor and/or all spikes. Static files: nothing to sign up for, nothing sent anywhere. */
export function Follow({ siteId }: { siteId?: string }) {
  const t = useT()
  const mine = siteId ? feedUrl(import.meta.env.BASE_URL, window.location.origin, siteId) : null
  const all = feedUrl(import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="follow">
      <p className="follow-links">
        {mine && <a href={mine} type="application/rss+xml">{t('follow.monitor')}</a>}
        {all && <a href={all} type="application/rss+xml">{t('follow.all')}</a>}
      </p>
      <p className="muted small">{t('follow.help')}</p>
    </div>
  )
}
