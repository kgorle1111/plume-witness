import { useEffect, useMemo, useState } from 'react'
import { MapSlot } from './MapSlot'
import { EMBED_STEPS, embedUrl, fullUrl, iframeHtml, stepFromHash, stepLine, type EmbedStep } from './embed'
import type { PlumeEvent } from './types'
import './Embed.css'

/** ?embed=1: map, the current step in a sentence or two, and a link out. No header, picker, stepper or footer,
 *  so it fits an <iframe> on a newsroom page. The step lives in the hash, like the full app. */
export function EmbedReplay({ ev }: { ev: PlumeEvent }) {
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
  return (
    <div className="embed">
      <h1 className="sr-only">{ev.title}, {ev.date_local}</h1>
      <section className="embed-map" aria-label="Map of the monitor, wind and facilities">
        <MapSlot ev={ev} corridor={corridor} highlightId={null} hour={ev.detection.hour_cst} place={null} />
      </section>
      <section className="embed-step" aria-label="Current step">
        <div className="embed-tabs" role="group" aria-label="Step">
          {EMBED_STEPS.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.id === step} onClick={() => pick(s.id)}>{s.label}</button>
          ))}
        </div>
        <p className="embed-line" aria-live="polite">{stepLine(ev, step)}</p>
        <p className="embed-foot">
          <span>Plume Witness · {ev.date_local} · real public data, replayed</span>
          <a href={openUrl} target="_blank" rel="noopener">Open in Plume Witness</a>
        </p>
      </section>
    </div>
  )
}

/** "Embed this night": shows the <iframe> HTML for the page being viewed, with a copy button. */
export function EmbedButton({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const html = useMemo(
    () => iframeHtml(embedUrl(window.location.origin, window.location.pathname, window.location.search), `Plume Witness: ${title}`),
    [title],
  )
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(html)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }
  return (
    <div className="embed-share">
      <button type="button" className="btn embed-open" aria-expanded={open} aria-controls="embed-code" onClick={() => setOpen((o) => !o)}>
        Embed this night
      </button>
      {open && (
        <div id="embed-code" className="embed-code">
          <label htmlFor="embed-html">Paste this into your page</label>
          <textarea id="embed-html" readOnly rows={4} value={html} onFocus={(e) => e.currentTarget.select()} />
          <div className="embed-code-row">
            <button type="button" className="btn btn-primary" onClick={copy}>Copy iframe HTML</button>
            <span role="status">{copied === 'yes' ? 'Copied.' : copied === 'no' ? 'Copy failed. Select the text and copy it.' : ''}</span>
          </div>
          <p className="muted small">Shows the map and three steps. It links back to the full replay and carries the same limits.</p>
        </div>
      )}
    </div>
  )
}
