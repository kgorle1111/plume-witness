import { isEmbed } from './embed.ts'

/**
 * Production-only service worker (public/sw.js). Failing to register must never break the app.
 * Not in the embed: a news page's readers would each pay the ~1 MB precache for an iframe with no offline use.
 * Registered once the page is idle after load, so the precache does not compete with the map chunk and tiles.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || isEmbed(location.search)) return
  if (!('serviceWorker' in navigator)) {
    console.info('Offline mode unavailable: this browser has no service workers.')
    return
  }
  const base = import.meta.env.BASE_URL
  watchForUpdate(base)
  const register = () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err: unknown) => {
      console.info('Offline mode unavailable: service worker did not register.', err)
    })
  }
  window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) requestIdleCallback(register, { timeout: 10_000 })
    else setTimeout(register, 3000)
  })
}

/**
 * True when the page's own entry script is not in the new build's precache list: the page runs an old build whose
 * lazy chunks may be gone from the server, so it should be reloaded. `entrySrc` is the absolute script URL.
 */
export function pageIsStale(entrySrc: string, scopeUrl: string, urls: readonly string[]): boolean {
  const scope = new URL(scopeUrl)
  const entry = new URL(entrySrc, scope)
  if (entry.origin !== scope.origin || !entry.pathname.startsWith(scope.pathname)) return false
  return !urls.includes(entry.pathname.slice(scope.pathname.length))
}

let updateReady = false
const listeners = new Set<() => void>()
export const getUpdateReady = (): boolean => updateReady
export const subscribeUpdate = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// A new worker takes control (sw.js skips waiting) while this page is open. The first install also fires
// controllerchange, so a page that had no controller is never told to reload; a page that already runs the new
// build (its navigation was fetched fresh) is not told either.
function watchForUpdate(base: string): void {
  if (!navigator.serviceWorker.controller) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src
    if (!entry) return
    const scope = new URL(base, location.href).href
    fetch(`${scope}precache.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ urls?: unknown }>) : null))
      .then((p) => {
        if (!p || !Array.isArray(p.urls) || !pageIsStale(entry, scope, p.urls as string[])) return
        updateReady = true
        for (const fn of listeners) fn()
      })
      .catch((err: unknown) => console.info('Could not check for a new version.', err))
  }, { once: true })
}
