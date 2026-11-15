import { useEffect, useState } from 'react'
import { useT } from './useT'
import './Pwa.css'

// Chrome-only event, not in lib.dom.
type InstallEvent = Event & { prompt: () => Promise<void> }

/** Footer note plus an install button that exists only where the browser says the app is installable. */
export function InstallHint() {
  const t = useT()
  const [ev, setEv] = useState<InstallEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEv(e as InstallEvent) }
    const onInstalled = () => setEv(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return (
    <>
      <small className="pwa-note">{t('foot.offline')}</small>
      {ev && (
        <button type="button" className="pwa-install" onClick={() => { void ev.prompt(); setEv(null) }}>
          {t('foot.install')}
        </button>
      )}
    </>
  )
}
