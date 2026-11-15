import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
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
import { REGIONS, regionFrom, regionQuery } from './region'
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

      <section role="tabpanel" id={`panel-${step}`} aria-labelledby={`tab-${step}`} className="step-panel">
        <h2>{t(STEPS[active].title)}</h2>
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
  const phone = usePhone()
  // The phone map hides its legend behind a "Key" toggle; the legend is visual only (aria-hidden in EventMap).
  const [keyOpen, setKeyOpen] = useState(false)
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
      <header className="top">
        {/* Brand row, then the eyebrow (date · compound · data tag), then the title on its own line. */}
        <div className="brand-row">
          <p className="brand">
            <BrandMark />
            <span className="brand-name">Plume Witness</span>
          </p>
          <nav className="top-links" aria-label={t('app.siteLinks')}>
            <a className="spikes-link" href={regionQuery(ev.region?.key === 'beaumont' ? REGIONS.beaumont : REGIONS.houston, { view: 'spikes' })}>{t('common.pastSpikes')}</a>
            {/* Phones keep only Past spikes up here; the footer carries Facilities and Past spikes too. */}
            <a className="top-link-more" href={`${import.meta.env.BASE_URL}?view=timeline`}>{t('app.linkTimeline')}</a>
            <a className="top-link-more" href={`${import.meta.env.BASE_URL}?view=facilities`}>{t('common.facilities')}</a>
            <a className="top-link-more" href={`${import.meta.env.BASE_URL}?view=brief`}>{t('app.linkBrief')}</a>
          </nav>
        </div>
        <p className="eyebrow">
          <span>{ev.date_local}</span> <span aria-hidden="true">·</span> <span>{ev.compound.name}</span> <span aria-hidden="true">·</span>{' '}
          <span className={ev.label === 'real' ? 'data-tag' : 'data-tag is-fixture'}>{ev.label === 'real' ? t('app.dataReal') : t('app.dataFixture')}</span>
        </p>
        <h1 className="event-title">{ev.title}</h1>
        {!phone && <div className="top-tools">{tools}</div>}
        <LangSwitch note={false} />
      </header>
      {ev.label === 'fixture' && (
        <p className="fixture-banner" role="note"><strong>{t('app.fixtureLead')}</strong> {t('app.fixtureBody')}</p>
      )}
      {ev.region && !ev.region.backtested && (
        <p className="region-banner" role="note"><strong>{ev.region.label}. {ev.region.note}</strong></p>
      )}
      <main className="layout">
        <div className="stage">
        <section className={keyOpen ? 'map-wrap key-open' : 'map-wrap'} aria-labelledby="map-label">
          <h2 id="map-label" className="sr-only">{t('app.mapLabel')}</h2>
          <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={hour} place={place} />
          {phone && (
            <button type="button" className="map-key-btn" aria-expanded={keyOpen} onClick={() => setKeyOpen((o) => !o)}>
              {t('app.mapKey')}
            </button>
          )}
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
// ?region=beaumont&night=<id> reads web/public/regions/beaumont/nights/<id>.json instead.
const NIGHT_ID = /^\d{4}-\d{2}-\d{2}_\d{5}_[\d_]+$/
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
  const night = nightParam()
  const invalid = night !== null && !NIGHT_ID.test(night)

  useEffect(() => {
    const ctrl = new AbortController()
    if (invalid) return
    const file = night ? `${regionFrom(window.location.search).dir}nights/${night}.json` : 'event.json'
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
  // Every view shared "Plume Witness" as its title (WCAG 2.4.2); name the night being replayed.
  useEffect(() => { if (ev) document.title = `${ev.title} · Plume Witness` }, [ev])

  const shown = invalid ? t('app.notNight', { night: night ?? '' }) : error
  if (shown) return <main className="state-msg" role="alert"><h1>Plume Witness</h1><p>{shown}</p><p><a href={DEMO_REPLAY_HREF}>{t('app.backDemo')}</a></p></main>
  if (!ev) return <main className="state-msg"><p>{t('app.loadingEvent')}</p></main>
  if (isEmbed(window.location.search)) return <EmbedReplay ev={ev} />
  return <Replay ev={ev} picker={<NightPicker current={night} />} />
}
