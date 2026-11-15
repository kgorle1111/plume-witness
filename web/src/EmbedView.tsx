import { useEffect, useMemo, useRef, useState } from 'react'
import { MapSlot } from './MapSlot'
import { EMBED_STEPS, embedUrl, fullUrl, iframeHtml, stepFromHash, stepLine, type EmbedStep } from './embed'
import { eventTitle, regionByKey } from './region'
import type { PlumeEvent } from './types'
import { useLang, useT } from './useT'
import './Embed.css'

/** The step sentence with the ISO date kept on one line (it broke at its hyphen: "2024-06-" / "21"). */
function DateSafe({ text, date }: { text: string; date: string }) {
  const parts = text.split(date)
  return <>{parts.map((p, i) => (i === 0 ? p : <span key={i}><span className="nowrap">{date}</span>{p}</span>))}</>
}

/** ?embed=1: map, the current step in a sentence or two, and a link out. No header, picker, stepper or footer,
 *  so it fits an <iframe> on a newsroom page. The step lives in the hash, like the full app. */
export function EmbedReplay({ ev }: { ev: PlumeEvent }) {
  const t = useT()
  const lang = useLang()
  const [step, setStep] = useState<EmbedStep>(() => stepFromHash(window.location.hash))
  const corridor = useMemo(() => ev.facilities.filter((f) => f.in_corridor).sort((a, b) => a.distance_km - b.distance_km), [ev])
  useEffect(() => {
    const onHash = () => setStep(stepFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const pick = (s: EmbedStep) => {
    setStep(s)
    history.replaceState(null, '', `#${s}`)
  }
  const openUrl = fullUrl(window.location.origin, window.location.pathname, window.location.search)
  // The pipeline's English title, rebuilt in the reader's language; one the template can't rebuild stays English and says so.
  const title = eventTitle(lang, ev.title, ev.compound.name, regionByKey(ev.region?.key).key)
  return (
    <main className="embed">
      <h1 className="sr-only" lang={title.lang}>{title.text}, {ev.date_local}</h1>
      <section className="embed-map" aria-label={t('embed.mapLabel')}>
        <MapSlot ev={ev} corridor={corridor} highlightId={null} hour={ev.detection.hour_cst} place={null} />
      </section>
      <section className="embed-step" aria-label={t('embed.stepLabel')}>
        <div className="embed-tabs" role="group" aria-label={t('embed.stepGroup')}>
          {EMBED_STEPS.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === step} onClick={() => pick(s.id)}>{t(s.label)}</button>
          ))}
        </div>
        <p className="embed-line" aria-live="polite"><DateSafe text={stepLine(ev, step, lang)} date={ev.date_local} /></p>
        <p className="embed-foot">
          <span>Plume Witness · {ev.date_local} · {t('embed.foot')}</span>
          <a href={openUrl} target="_blank" rel="noopener">{t('embed.openFull')}</a>
        </p>
      </section>
    </main>
  )
}

/** "Embed this night": shows the <iframe> HTML for the page being viewed, with a copy button. On desktop the box
 *  drops over the step tabs (App.css), so Escape and a click anywhere outside close it. */
export function EmbedButton({ title }: { title: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const openBtn = useRef<HTMLButtonElement>(null)
  const clearTimer = useRef(0)
  const html = useMemo(
    () => iframeHtml(embedUrl(window.location.origin, window.location.pathname, window.location.search), `Plume Witness: ${title}`),
    [title],
  )
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const inside = root.current?.contains(document.activeElement)
      setOpen(false)
      if (inside) openBtn.current?.focus()
    }
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  useEffect(() => () => window.clearTimeout(clearTimer.current), [])
  const say = (v: 'yes' | 'no') => {
    // Blank first, so a second copy is announced again. "Copied." then clears itself instead of going stale; the
    // failure note stays, since it tells the reader what to do instead.
    window.clearTimeout(clearTimer.current)
    setCopied(null)
    window.requestAnimationFrame(() => setCopied(v))
    if (v === 'yes') clearTimer.current = window.setTimeout(() => setCopied(null), 4000)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(html)
      say('yes')
    } catch {
      say('no')
    }
  }
  return (
    <div ref={root} className="embed-share">
      <button ref={openBtn} type="button" className="btn embed-open" aria-expanded={open} aria-controls={open ? 'embed-code' : undefined} onClick={() => setOpen((o) => !o)}>
        {t('embed.open')}
      </button>
      {open && (
        <div id="embed-code" className="embed-code">
          <label htmlFor="embed-html">{t('embed.paste')}</label>
          <textarea id="embed-html" readOnly rows={4} value={html} onFocus={(e) => e.currentTarget.select()} />
          <div className="embed-code-row">
            <button type="button" className="btn btn-primary" onClick={copy}>{t('embed.copy')}</button>
            <span role="status">{copied === 'yes' ? t('embed.copied') : copied === 'no' ? t('embed.copyFailed') : ''}</span>
          </div>
          <p className="muted small">{t('embed.note')}</p>
        </div>
      )}
    </div>
  )
}
