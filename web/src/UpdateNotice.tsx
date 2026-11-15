import { useState, useSyncExternalStore } from 'react'
import { getUpdateReady, subscribeUpdate } from './pwa'
import { useT } from './useT'

/**
 * Shown when a deploy replaced the service worker under an open page that runs the old build (pwa.ts): the old page's
 * lazy chunks can 404 from then on. The reader chooses when to reload, so unsaved edits are never thrown away.
 */
export function UpdateNotice() {
  const t = useT()
  const ready = useSyncExternalStore(subscribeUpdate, getUpdateReady, getUpdateReady)
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="update-note" role="status">
      <p>{t('update.ready')}</p>
      <button type="button" className="btn btn-primary" onClick={() => location.reload()}>{t('load.reload')}</button>
      <button type="button" className="btn" onClick={() => setDismissed(true)}>{t('update.later')}</button>
    </div>
  )
}
