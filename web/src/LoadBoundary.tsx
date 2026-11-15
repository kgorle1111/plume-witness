import { Component, type ReactNode } from 'react'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'
import { useT } from './useT'

/**
 * A lazy view whose chunk fails (dropped venue Wi-Fi, or a deploy that removed it) used to blank the whole page,
 * header and footer included. This keeps the rest of the page and offers a reload. Key it by page so moving to
 * another page tries again. `shell` adds the site header (and footer) where the failed part was what drew them.
 */
export class LoadBoundary extends Component<{ children: ReactNode; shell?: 'header' | 'full' }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.error('Part of the page failed to load.', err) }
  render() {
    if (!this.state.failed) return this.props.children
    const { shell } = this.props
    return (
      <>
        {shell && <SiteHeader />}
        <LoadFailed />
        {shell === 'full' && <SiteFooter />}
      </>
    )
  }
}

function LoadFailed() {
  const t = useT()
  return (
    <main className="state-msg" role="alert">
      <p>{t('load.failed')}</p>
      <p><button type="button" className="btn" onClick={() => location.reload()}>{t('load.reload')}</button></p>
    </main>
  )
}
