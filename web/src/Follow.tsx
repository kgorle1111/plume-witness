import { FOLLOW_HELP, feedUrl } from './feeds'

/** RSS links for one monitor and/or all spikes. Static files: nothing to sign up for, nothing sent anywhere. */
export function Follow({ siteId }: { siteId?: string }) {
  const mine = siteId ? feedUrl(import.meta.env.BASE_URL, window.location.origin, siteId) : null
  const all = feedUrl(import.meta.env.BASE_URL, window.location.origin)
  return (
    <div className="follow">
      <p className="follow-links">
        {mine && <a href={mine} type="application/rss+xml">Follow this monitor (RSS)</a>}
        {all && <a href={all} type="application/rss+xml">All spikes (RSS)</a>}
      </p>
      <p className="muted small">{FOLLOW_HELP}</p>
    </div>
  )
}
