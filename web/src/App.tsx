import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { animate } from 'motion/mini'
import { parseEvent, type PlumeEvent } from './types'
import { MapSlot } from './MapSlot'
import { Timeline } from './Timeline'
import { Check, Detect, Packet, Trace } from './Steps'
import { initialPacketReview, useAiDraft, type Lang, type PacketReview } from './packet'
import { cannotSayEs } from './format'
import { LangSwitch, ReviewNote } from './LangSwitch'
import { useLang, useT } from './useT'
import type { StringKey } from './i18n'
import type { Place } from './PlaceSearch'
import { DEMO_REPLAY_HREF } from './demoHref'
import { SiteFooter } from './SiteFooter'
import { EmbedButton, EmbedReplay } from './EmbedView'
import { isEmbed } from './embed'
import { NOT_BACKTESTED_NOTE, compoundLabel, eventTitle, regionByKey, regionFrom, regionQuery, regionUnknown } from './region'
import { NIGHT_ID, regionStartNight } from './routes'
import { SiteHeader } from './SiteHeader'
import './App.css'

const STEPS = [
  { id: 'detect', label: 'step.detect', title: 'step.detect.title' },
  { id: 'trace', label: 'step.trace', title: 'step.trace.title' },
  { id: 'check', label: 'step.check', title: 'step.check.title' },
  { id: 'packet', label: 'step.packet', title: 'step.packet.title' },
] as const satisfies readonly { id: string; label: StringKey; title: StringKey }[]
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

function CannotSay({ items, lang }: { items: string[]; lang: Lang }) {
  const t = useT()
  return (
    <details className="cannot-say">
      <summary lang={lang}>{t('cannot.title')} ({items.length})</summary>
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
  const t = useT()
  const siteLang = useLang()
  const [active, setActive] = useState(stepFromHash)
  // Keep the review when Packet unmounts so a reviewer can check the record and return (from PR #21).
  const [packetReview, setPacketReview] = useState<PacketReview>(() => initialPacketReview(ev))
  const ai = useAiDraft()
  const [langNotice, setLangNotice] = useState('')
  // One language for the whole site, set by the header switch (or Packet's draft switch); this follows it.
  // Approval covers one language's exact text, so a changed language clears it and says so.
  useEffect(() => {
    if (packetReview.lang === siteLang) return
    if (packetReview.approved) setLangNotice(t('lang.switched', { lang: t(siteLang === 'es' ? 'lang.nameEs' : 'lang.nameEn') }))
    setPacketReview((r) => ({ ...r, lang: siteLang, approved: false }))
    // Runs when the site language changes; the packet state it compares is read fresh on that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteLang])
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const { corridor, outside } = useCorridor(ev)
  const panel = useRef<HTMLElement>(null)
  const shownStep = useRef(active)
  // Each step fades in when it opens (PR #90): opacity only, so nothing shifts. The first paint and reduced motion
  // skip it. motion's mini animate is a Web Animation with no fill: if it never runs, the step is simply shown.
  useLayoutEffect(() => {
    if (shownStep.current === active) return
    shownStep.current = active
    const el = panel.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fade = animate(el, { opacity: [0, 1] }, { duration: 0.2, ease: 'easeOut' })
    return () => fade.stop()
  }, [active])

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
      <div className="stepper" role="tablist" aria-label={t('nav.steps')} onKeyDown={onKey}>
        {/* Pill nav (PR #90): one pill slides behind the selected step; the tabs carry the state. */}
        <span className="step-pill" aria-hidden="true" style={{ transform: `translateX(${active * 100}%)` }} />
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
            <span>{t(s.label)}</span>
          </button>
        ))}
      </div>

      <div className="limits-bar">
        <CannotSay items={ev.cannot_say} lang={packetReview.lang} />
      </div>
      {packetReview.lang === 'es' && <ReviewNote />}
      <p className="sr-only" aria-live="polite">{langNotice}</p>

      <section ref={panel} role="tabpanel" id={`panel-${step}`} aria-labelledby={`tab-${step}`} className="step-panel">
        <h2 key={step}>{t(STEPS[active].title)}</h2>
        {step === 'detect' && <Detect ev={ev} hour={hour} />}
        {step === 'trace' && <Trace ev={ev} corridor={corridor} outside={outside} onHighlight={onHighlight} place={place} onPlace={onPlace} />}
        {step === 'check' && <Check ev={ev} lang={packetReview.lang} />}
        {step === 'packet' && <Packet ev={ev} ai={ai} review={packetReview} setReview={setPacketReview} />}
        <nav className="step-nav" aria-label={t('nav.stepNav')}>
          {active > 0 && <button type="button" className="btn" onClick={() => go(active - 1, true)}>{t('nav.back', { step: t(STEPS[active - 1].label) })}</button>}
          {active < STEPS.length - 1 && <button type="button" className="btn btn-primary" onClick={() => go(active + 1, true)}>{t('nav.next', { step: t(STEPS[active + 1].label) })}</button>}
        </nav>
      </section>
    </>
  )
}

// Phones: the night picker and Embed move below the steps so the step heading makes the first screen.
const PHONE = '(max-width: 640px)'
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(PHONE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const isPhone = () => window.matchMedia(PHONE).matches
const usePhone = () => useSyncExternalStore(subscribePhone, isPhone, isPhone)

function Replay({ ev, picker }: { ev: PlumeEvent; picker: ReactNode }) {
  const t = useT()
  const lang = useLang()
  const title = eventTitle(lang, ev.title, ev.compound.name, regionByKey(ev.region?.key).key)
  const phone = usePhone()
  // The phone map hides its legend behind a "Key" toggle; the legend is visual only (aria-hidden in EventMap).
  // Rendered in one place at a time: the picker and the Embed box carry element ids.
  const tools = <>{picker}<EmbedButton title={ev.title} /></>
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
        {t('nav.skip')}
      </a>
      {/* The shared site header (brand row; phones keep only Past spikes), then the eyebrow (date · compound · data
          tag) and the title on its own line. */}
      <SiteHeader className="top" lang={<LangSwitch note={false} />}>
        <p className="eyebrow">
          <span>{ev.date_local}</span> <span aria-hidden="true">·</span> <span>{compoundLabel(lang, ev.compound.name)}</span> <span aria-hidden="true">·</span>{' '}
          {ev.region && <><span>{ev.region.label}</span> <span aria-hidden="true">·</span>{' '}</>}
          <span className={ev.label === 'real' ? 'data-tag' : 'data-tag is-fixture'}>{ev.label === 'real' ? t('app.dataReal') : t('app.dataFixture')}</span>
        </p>
        <h1 className="event-title" lang={title.lang === lang ? undefined : title.lang}>{title.text}</h1>
        {!phone && <div className="top-tools">{tools}</div>}
      </SiteHeader>
      {ev.label === 'fixture' && (
        <p className="fixture-banner" role="note"><strong>{t('app.fixtureLead')}</strong> {t('app.fixtureBody')}</p>
      )}
      {regionUnknown(window.location.search) && <p className="site-region-note" role="note">{t('region.unknown')}</p>}
      {ev.region && !ev.region.backtested && (
        <p className="region-banner" role="note"><strong>{ev.region.label}. {ev.region.note === NOT_BACKTESTED_NOTE ? t('region.notBacktested') : ev.region.note}</strong></p>
      )}
      <main className="layout">
        <div className="stage">
        <section className="map-wrap" aria-labelledby="map-label">
          <h2 id="map-label" className="sr-only">{t('app.mapLabel')}</h2>
          <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={hour} place={place} />
        </section>
        <Timeline ev={ev} hour={hour} onHour={setHour} />
        </div>
        <aside className="panel" id="steps" tabIndex={-1} aria-label={t('nav.eventSteps')}>
          <Stepper ev={ev} hour={hour} onHighlight={setHighlightId} place={place} onPlace={setPlace} />
          {phone && (
            <details className="more-nights">
              <summary>{t('app.moreNights')}</summary>
              <div className="more-nights-body">{tools}</div>
            </details>
          )}
        </aside>
      </main>
      <SiteFooter />
    </div>
  )
}

// ?night=<id> replays one of the generated spike nights (web/public/nights/<id>.json); no param is the demo night.
// ?region=<key>&night=<id> reads web/public/regions/<key>/nights/<id>.json instead (keys: regions.generated.json).
const nightParam = (): string | null => new URLSearchParams(window.location.search).get('night')

interface NightRow { id: string; date: string; site_name: string; compound: string; value: number; status: string }

function NightPicker({ current }: { current: string | null }) {
  const t = useT()
  const [rows, setRows] = useState<NightRow[]>([])
  const [choice, setChoice] = useState(current ?? '')
  const region = regionFrom(window.location.search)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}${region.dir}nights/index.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (Array.isArray(j)) setRows(j as NightRow[]) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [region.dir])
  if (!rows.length) return null
  const go = (id: string) => {
    // With the atlas landing page, an empty query would open the landing page, so "back to the demo" goes to the replay.
    if (id) window.location.search = regionQuery(region, { night: id })
    else window.location.assign(DEMO_REPLAY_HREF)
  }
  // Choosing does not navigate; the button does. Arrow keys on a closed select fire change on Windows, which
  // used to load a new night on the first key press (WCAG 3.2.2 On Input).
  return (
    <form className="night-picker" onSubmit={(e) => { e.preventDefault(); if (choice !== (current ?? '')) go(choice) }}>
      <label htmlFor="night-select">{t('night.label')}</label>
      <div className="night-picker-row">
        <select id="night-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">{region.backtested ? t('night.demo') : t('night.demoHouston')}</option>
          {rows.map((r) => <option key={r.id} value={r.id}>{r.date} · {r.compound} · {r.site_name} · {r.value} ppb</option>)}
        </select>
        <button type="submit" className="btn">{t('night.open')}</button>
      </div>
    </form>
  )
}

export default function App() {
  const t = useT()
  const [ev, setEv] = useState<PlumeEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const region = regionFrom(window.location.search)
  // event.json is Houston's demo night, so a region with no ?night= first looks up its own first night.
  const [night, setNight] = useState(nightParam)
  const needsStart = night === null && !region.backtested
  const invalid = night !== null && !NIGHT_ID.test(night)

  useEffect(() => {
    if (!needsStart) return
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}${region.dir}nights/index.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${region.dir}nights/index.json (HTTP ${r.status}).`)
        return r.json()
      })
      .then((rows: unknown) => {
        const id = regionStartNight(rows)
        if (!id) throw new Error(`${region.place} has no nights to replay yet.`)
        // The URL names the night it shows, so a shared link keeps opening the same one.
        const url = new URL(window.location.href)
        url.searchParams.set('night', id)
        history.replaceState(history.state, '', url)
        setNight(id)
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [needsStart, region.dir, region.place])

  useEffect(() => {
    const ctrl = new AbortController()
    if (invalid || needsStart) return
    const file = night ? `${region.dir}nights/${night}.json` : 'event.json'
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
  }, [night, invalid, needsStart, region.dir])
  // Every view shared "Plume Witness" as its title (WCAG 2.4.2); name the night being replayed.
  const lang = useLang()
  useEffect(() => {
    if (ev) document.title = `${eventTitle(lang, ev.title, ev.compound.name, regionByKey(ev.region?.key).key).text} · Plume Witness`
  }, [ev, lang])

  const shown = invalid ? t('app.notNight', { night: night ?? '' }) : error
  if (shown) return <main className="state-msg" role="alert"><h1>Plume Witness</h1><p>{shown}</p><p><a href={DEMO_REPLAY_HREF}>{t('app.backDemo')}</a></p></main>
  if (!ev) return <main className="state-msg"><p>{t('app.loadingEvent')}</p></main>
  if (isEmbed(window.location.search)) return <EmbedReplay ev={ev} />
  return <Replay ev={ev} picker={<NightPicker current={night} />} />
}
