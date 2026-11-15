import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { parseEvent, type PlumeEvent } from './types'
import { MapSlot } from './MapSlot'
import { Timeline } from './Timeline'
import { Check, Detect, Packet, Trace, type PacketReview } from './Steps'
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

function CannotSay({ items }: { items: string[] }) {
  return (
    <details className="cannot-say">
      <summary>What this can't say ({items.length})</summary>
      <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </details>
  )
}

function Stepper({ ev, hour, onHighlight }: { ev: PlumeEvent; hour: number; onHighlight: (id: string | null) => void }) {
  const [active, setActive] = useState(stepFromHash)
  // Keep the review when Packet unmounts so a reviewer can check the record and return.
  const [packetReview, setPacketReview] = useState<PacketReview>(() => ({
    lang: 'en',
    drafts: { en: ev.packet.draft_en, es: ev.packet.draft_es },
    approved: false,
  }))
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const { corridor, outside } = useCorridor(ev)

  useEffect(() => {
    const onHash = () => setActive(stepFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go =(i: number, focus = false) => {
    setActive(i)
    history.replaceState(null, '', `#${STEPS[i].id}`)
    if (focus) tabs.current[i]?.focus()
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

      <CannotSay items={ev.cannot_say} />

      <section role="tabpanel" id={`panel-${step}`} aria-labelledby={`tab-${step}`} className="step-panel">
        <h2>{STEPS[active].title}</h2>
        {step === 'detect' && <Detect ev={ev} hour={hour} />}
        {step === 'trace' && <Trace ev={ev} corridor={corridor} outside={outside} onHighlight={onHighlight} />}
        {step === 'check' && <Check ev={ev} />}
        {step === 'packet' && <Packet ev={ev} review={packetReview} setReview={setPacketReview} />}
        <nav className="step-nav" aria-label="Step navigation">
          {active > 0 && <button type="button" className="btn" onClick={() => go(active - 1, true)}>Back: {STEPS[active - 1].label}</button>}
          {active < STEPS.length - 1 && <button type="button" className="btn btn-primary" onClick={() => go(active + 1, true)}>Next: {STEPS[active + 1].label}</button>}
        </nav>
      </section>
    </>
  )
}

function Replay({ ev }: { ev: PlumeEvent }) {
  const { corridor } = useCorridor(ev)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // The replay opens on the detection hour so the spike is the first thing on screen.
  const [hour, setHour] = useState(ev.detection.hour_cst)
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
        <p className="brand">Plume Witness <span className="event-meta">· {ev.date_local} · {ev.compound.name} · {ev.label === 'real' ? 'Real public data' : 'Fixture'}</span></p>
        <h1 className="event-title">{ev.title}</h1>
      </header>
      {ev.label === 'fixture' && (
        <p className="fixture-banner" role="note"><strong>Fixture data, not a real event.</strong> Every value on this page is invented for building the app.</p>
      )}
      <main className="layout">
        <div className="stage">
        <section className="map-wrap" aria-labelledby="map-label">
          <h2 id="map-label" className="sr-only">Map of monitors and facilities. The same facilities are listed as text in the Trace step.</h2>
          <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={hour} />
        </section>
        <Timeline ev={ev} hour={hour} onHour={setHour} />
        </div>
        <aside className="panel" id="steps" tabIndex={-1} aria-label="Event steps">
          <Stepper ev={ev} hour={hour} onHighlight={setHighlightId} />
        </aside>
      </main>
    </div>
  )
}

export default function App() {
  const [ev, setEv] = useState<PlumeEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}event.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load event.json (HTTP ${r.status}). Check that web/public/event.json exists.`)
        return r.json()
      })
      .then((raw) => setEv(parseEvent(raw)))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [])

  if (error) return <main className="state-msg" role="alert"><h1>Plume Witness</h1><p>{error}</p></main>
  if (!ev) return <main className="state-msg"><p>Loading event…</p></main>
  return <Replay ev={ev} />
}
