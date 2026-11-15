import { useSyncExternalStore } from 'react'
import { getTheme, setTheme, subscribeTheme } from './theme'
import { useT } from './useT'

/** Manual dark-mode switch (aria-pressed button); no automatic dark. */
export function ThemeToggle() {
  const t = useT()
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  return (
    <button type="button" className="theme-toggle" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {t('theme.dark')}
    </button>
  )
}
