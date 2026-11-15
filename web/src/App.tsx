import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { parseEvent, type PlumeEvent } from './types'
import { MapSlot } from './MapSlot'
import { Timeline } from './Timeline'
import { Check, Detect, Packet, Trace } from './Steps'
import { initialPacketReview, useAiDraft, type Lang, type PacketReview } from './packet'
import { cannotSayEs } from './format'
import type { Place } from './PlaceSearch'
import './App.css'

const STEPS = [
  { id: 'detect', label: 'Detect', title: 'Detect: what the monitor saw' },
  { id: 'trace', label: 'Trace', title: 'Trace: in the upwind corridor' },
  { id: 'check', label: 'Check', title: 'Check: the state record' },
  { id: 'packet', label: 'Packet', title: 'Packet: review and file' },
] as const
type StepId = (typeof STEPS)[number]['id']

// The hash doubles as a deep link (QR code on the table can open a specific step).
const stepFromHash = (): number => {
  const i = STEPS.findIndex((s) => `#${s.id}` === window.location.hash)
  return i < 0 ? 0 : i
}

/** Corridor facilities nearest first (geometry only; the pipeline's `rank` is not shown as a ranking). */
function useCorridor(ev: PlumeEvent) {
  return useMemo(() => {
    const byDistance = [...ev.facilities].sort((a, b) => a.distance_km - b.distance_km)
    return { corridor: byDistance.filter((f) => f.in_corridor), outside: byDistance.filter((f) => !f.in_corridor) }
  }, [ev])
}

/** Monitor dot with the upwind wedge it reads from; the same shapes the map uses. */
function BrandMark() {
  return (
    <svg className="brand-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 18 L21 6.5 A16 16 0 0 1 22.5 15.5 Z" fill="rgb(190 30 45 / 0.16)" stroke="#be1e2d" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="4.2" fill="#be1e2d" stroke="#fff" strokeWidth="1.6" />
    </svg>
  )
}

function CannotSay({ items, lang }: { items: string[]; lang: Lang }) {
  return (
    <details className="cannot-say">
      <summary lang={lang}>{lang === 'es' ? 'Lo que esto no puede decir' : "What this can't say"} ({items.length})</summary>
      <ul>
        {items.map((t) => {
          // Lines without a Spanish match stay in English and say so through lang.
          const es = lang === 'es' ? cannotSayEs(t) : null
          return <li key={t} lang={es ? 'es' : 'en'}>{es ?? t}</li>
        })}
      </ul>
    </details>
  )
}

interface StepperProps {
  ev: PlumeEvent
  hour: number
  onHighlight: (id: string | null) => void
  place: Place | null
  onPlace: (p: Place | null) => void
}

function Stepper({ ev, hour, onHighlight, place, onPlace }: StepperProps) {
  const [active, setActive] = useState(stepFromHash)
  // Keep the review when Packet unmounts so a reviewer can check the record and return (from PR #21).
  const [packetReview, setPacketReview] = useState<PacketReview>(() => initialPacketReview(ev))
  const ai = useAiDraft()
  const [langNotice, setLangNotice] = useState('')
  // Approval covers one language's exact text, so switching here clears it, as the Packet switch does.
  const setLang = (l: Lang) => {
    if (l === packetReview.lang) return
    setLangNotice(packetReview.approved ? `Switched to ${l === 'es' ? 'Spanish' : 'English'}. Approve that draft before filing.` : '')
    setPacketReview((r) => ({ ...r, lang: l, approved: false }))
  }
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const { corridor, outside } = useCorridor(ev)

  useEffect(() => {
    const onHash = () => setActive(stepFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (i: number, focus = false) => {
    setActive(i)
    history.replaceState(null, '', `#${STEPS[i].id}`)
    // A new step starts at its top: "Next" at the end of the long Trace list used to open Check half scrolled.
    const panel = document.getElementById('steps')
    if (panel && panel.scrollHeight > panel.clientHeight) panel.scrollTop = 0
    else if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' })
    if (focus) tabs.current[i]?.focus({ preventScroll: true })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = STEPS.length - 1
    const keys: Record<string, number> = { ArrowRight: active + 1, ArrowDown: active + 1, ArrowLeft: active - 1, ArrowUp: active - 1, Home: 0, End: last }
    const next = keys[e.key]
    if (next === undefined) return
    e.preventDefault()
    go(Math.max(0, Math.min(last, next)), true)
  }

  const step: StepId = STEPS[active].id
  return (
    <>
      <div className="stepper" role="tablist" aria-label="Steps" onKeyDown={onKey}>
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => { tabs.current[i] = el }}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${s.id}`}
            tabIndex={i === active ? 0 : -1}
            className="step-tab"
            onClick={() => go(i)}
          >
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="limits-bar">
        <CannotSay items={ev.cannot_say} lang={packetReview.lang} />
        {/* Same state as the Packet language switch: one language choice for the draft, statuses and limits. */}
        <div className="seg seg-compact" role="group" aria-label="Language for statuses, limits and the draft">
          <button type="button" aria-pressed={packetReview.lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" aria-pressed={packetReview.lang === 'es'} onClick={() => setLang('es')} lang="es">Español</button>
        </div>
      </div>
      {packetReview.lang === 'es' && (
        <p className="muted small es-note">Traducción aún no revisada por un lector de la comunidad. <span lang="en">(Spanish not yet reviewed by a community reader.)</span></p>
      )}
      <p className="sr-only" aria-live="polite">{langNotice}</p>

      <section role="tabpanel" id={`panel-${step}`} aria-labelledby={`tab-${step}`} className="step-panel">
        <h2>{STEPS[active].title}</h2>
        {step === 'detect' && <Detect ev={ev} hour={hour} />}
        {step === 'trace' && <Trace ev={ev} corridor={corridor} outside={outside} onHighlight={onHighlight} place={place} onPlace={onPlace} />}
        {step === 'check' && <Check ev={ev} lang={packetReview.lang} />}
        {step === 'packet' && <Packet ev={ev} ai={ai} review={packetReview} setReview={setPacketReview} />}
        <nav className="step-nav" aria-label="Step navigation">
          {active > 0 && <button type="button" className="btn" onClick={() => go(active - 1, true)}>Back: {STEPS[active - 1].label}</button>}
          {active < STEPS.length - 1 && <button type="button" className="btn btn-primary" onClick={() => go(active + 1, true)}>Next: {STEPS[active + 1].label}</button>}
        </nav>
      </section>
    </>
  )
}

function Replay({ ev, picker }: { ev: PlumeEvent; picker: ReactNode }) {
  const { corridor } = useCorridor(ev)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // The replay opens on the detection hour so the spike is the first thing on screen.
  const [hour, setHour] = useState(ev.detection.hour_cst)
  // A searched or picked place stays on the map across steps until cleared.
  const [place, setPlace] = useState<Place | null>(null)
  return (
    <div className="app">
      {/* The map, its canvas and the attribution links come before the steps in tab order. The step state lives
          in location.hash, so the link moves focus itself instead of navigating to #steps. */}
      <a
        className="skip-link"
        href="#steps"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('steps')?.focus()
        }}
      >
        Skip to steps
      </a>
      <header className="top">
        <p className="brand">
          <BrandMark />
          <span className="brand-name">Plume Witness</span>
          <span className="event-meta">
            <span className="meta-sep" aria-hidden="true">·</span> {ev.date_local} <span aria-hidden="true">·</span> {ev.compound.name}
          </span>
          <span className={ev.label === 'real' ? 'data-tag' : 'data-tag is-fixture'}>{ev.label === 'real' ? 'Real public data' : 'Fixture'}</span>
          <a className="spikes-link" href="?view=spikes">Past spikes</a>
        </p>
        <h1 className="event-title">{ev.title}</h1>
        {picker}
      </header>
      {ev.label === 'fixture' && (
        <p className="fixture-banner" role="note"><strong>Fixture data, not a real event.</strong> Every value on this page is invented for building the app.</p>
      )}
      <main className="layout">
        <div className="stage">
        <section className="map-wrap" aria-labelledby="map-label">
          <h2 id="map-label" className="sr-only">Map of monitors and facilities. The same facilities are listed as text in the Trace step.</h2>
          <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={hour} place={place} />
        </section>
        <Timeline ev={ev} hour={hour} onHour={setHour} />
        </div>
        <aside className="panel" id="steps" tabIndex={-1} aria-label="Event steps">
          <Stepper ev={ev} hour={hour} onHighlight={setHighlightId} place={place} onPlace={setPlace} />
        </aside>
      </main>
    </div>
  )
}

// ?night=<id> replays one of the generated spike nights (web/public/nights/<id>.json); no param is the demo night.
const NIGHT_ID = /^\d{4}-\d{2}-\d{2}_\d{5}_[\d_]+$/
const nightParam = (): string | null => new URLSearchParams(window.location.search).get('night')

interface NightRow { id: string; date: string; site_name: string; compound: string; value: number; status: string }

function NightPicker({ current }: { current: string | null }) {
  const [rows, setRows] = useState<NightRow[]>([])
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}nights/index.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (Array.isArray(j)) setRows(j as NightRow[]) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])
  if (!rows.length) return null
  const go = (id: string) => {
    window.location.search = id ? `?night=${encodeURIComponent(id)}` : ''
  }
  return (
    <label className="night-picker">
      Replay another night{' '}
      <select value={current ?? ''} onChange={(e) => go(e.target.value)}>
        <option value="">Demo night</option>
        {rows.map((r) => <option key={r.id} value={r.id}>{r.date} · {r.compound} · {r.site_name} · {r.value} ppb</option>)}
      </select>
    </label>
  )
}

export default function App() {
  const [ev, setEv] = useState<PlumeEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const night = nightParam()
  const invalid = night !== null && !NIGHT_ID.test(night)

  useEffect(() => {
    const ctrl = new AbortController()
    if (invalid) return
    const file = night ? `nights/${night}.json` : 'event.json'
    fetch(`${import.meta.env.BASE_URL}${file}`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${file} (HTTP ${r.status}).`)
        return r.json()
      })
      .then((raw) => setEv(parseEvent(raw)))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [night, invalid])

  const shown = invalid ? `"${night}" is not a night id.` : error
  if (shown) return <main className="state-msg" role="alert"><h1>Plume Witness</h1><p>{shown}</p><p><a href={import.meta.env.BASE_URL}>Back to the demo night</a></p></main>
  if (!ev) return <main className="state-msg"><p>Loading event…</p></main>
  return <Replay ev={ev} picker={<NightPicker current={night} />} />
}
