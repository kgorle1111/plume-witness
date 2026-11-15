import { useId, useState } from 'react'
import { useT } from './useT'

/** "Provisional data" as a toggletip: the explanation used to live only in `title`, which keyboard, touch and most
 *  screen readers never reach (WCAG 1.3.1 / 4.1.2). The tip is a polite status region filled on open, so it is read
 *  once when asked for. */
export function ProvBadge() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button
        type="button"
        className="prov-badge"
        aria-expanded={open}
        aria-controls={id}
        title={open ? undefined : t('prov.tip')}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
      >
        {t('prov.badge')}
      </button>
      <span id={id} role="status" className="prov-tip">{open ? t('prov.tip') : ''}</span>
    </>
  )
}
