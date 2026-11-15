export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'pw-theme'

/** Light unless the visitor chose dark here. prefers-color-scheme is deliberately not read. */
function stored(): Theme {
  try { if (localStorage.getItem(STORAGE_KEY) === 'dark') return 'dark' } catch { /* storage can throw; light */ }
  return 'light'
}

function paint(t: Theme): void {
  try {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
  } catch { /* no document (tests) */ }
}

let current: Theme = 'light'
const listeners = new Set<() => void>()

/** Call once before first render. The embed iframe never themes itself: the host page owns its look. */
export function initTheme(): void {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('embed')) return
  current = stored()
  paint(current)
}

export const getTheme = (): Theme => current
export const subscribeTheme = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setTheme(t: Theme): void {
  if (t === current) return
  current = t
  try { localStorage.setItem(STORAGE_KEY, t) } catch { /* a choice that cannot be saved still applies this visit */ }
  paint(t)
  for (const fn of listeners) fn()
}
