/** Production-only service worker (public/sw.js). Failing to register must never break the app. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) {
    console.info('Offline mode unavailable: this browser has no service workers.')
    return
  }
  const base = import.meta.env.BASE_URL
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err: unknown) => {
      console.info('Offline mode unavailable: service worker did not register.', err)
    })
  })
}
