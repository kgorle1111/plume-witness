import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react'
import { animate } from 'motion/mini'
import { parseEvent, type PlumeEvent } from './types'
import { MapSlot } from './MapSlot'
import { Timeline } from './Timeline'
import { Check, Detect, Packet, Trace } from './Steps'
import { initialPacketReview, useAiDraft, type Lang, type PacketReview } from './packet'
import { cannotSayEs } from './format'
import { LangSwitch } from './LangSwitch'
import { useLang, useT } from './useT'
import { translate, type StringKey } from './i18n'
import type { Place } from './PlaceSearch'
import { DEMO_REPLAY_HREF } from './demoHref'
import { SiteFooter } from './SiteFooter'
import { EmbedButton, EmbedReplay } from './EmbedView'
import { isEmbed } from './embed'
import { DEFAULT_REGION, compoundLabel, eventTitle, regionByKey, regionFrom, regionQuery, regionUnknown } from './region'
import { NIGHT_ID, navHref, regionStartNight } from './routes'
import { SiteHeader } from './SiteHeader'
import { LoadError, classifyLoadError, responseError, type LoadErrorKind } from './loadError'
import { decodeReview, encodeReview, packetKey } from './packetStore'
import { shouldScrollToSteps, stepIndex } from './stepScroll'
import './App.css'

const BASE = import.meta.env.BASE_URL

const STEPS = [
  { id: 'detect', label: 'step.detect', title: 'step.detect.title' },
  { id: 'trace', label: 'step.trace', title: 'step.trace.title' },
  { id: 'check', label: 'step.check', title: 'step.check.title' },
  { id: 'packet', label: 'step.packet', title: 'step.packet.title' },
] as const satisfies readonly { id: string; label: StringKey; title: StringKey }[]
type StepId = (typeof STEPS)[number]['id']
const STEP_IDS = STEPS.map((s) => s.id)

// The hash doubles as a deep link (QR code on the table can open a specific step).
const stepFromHash = (): number => Math.max(0, stepIndex(window.location.hash, STEP_IDS))

// Drafts survive a reload or Back in this tab; storage can be blocked (private mode), and then they simply don't.
const readStored = (key: string): string | null => {
  try { return sessionStorage.getItem(key) } catch { return null }
}
const writeStored = (key: string, value: string) => {
  try { sessionStorage.setItem(key, value) } catch { /* storage blocked or full: the draft still works in memory */ }
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
      <summary lang={lang}>{t('cannot.title')} ({items.length + 1})</summary>
      <ul>
        {items.map((t) => {
          // Lines without a Spanish match stay in English and say so through lang.
          const es = lang === 'es' ? cannotSayEs(t) : null
          return <li key={t} lang={es ? 'es' : 'en'}>{es ?? t}</li>
        })}
        {/* Every night's record search has the same reach, so the line lives here, not in each event.json. */}
        <li lang={lang}>{translate(lang, 'cannot.searchScope')}</li>
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
  const storeKey = packetKey(ev.event_id)
  const [packetReview, setPacketReview] = useState<PacketReview>(() => decodeReview(readStored(storeKey), initialPacketReview(ev)))
  useEffect(() => writeStored(storeKey, encodeReview(packetReview)), [storeKey, packetReview])
  const ai = useAiDraft()
  const [langNotice, setLangNotice] = useState('')
  // Any change made in Packet (an edit, a new approval) supersedes the header switch's notice.
  const reviewFromPacket = (u: SetStateAction<PacketReview>) => {
    setLangNotice('')
    setPacketReview(u)
  }
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
    // An unknown hash shows Detect; the URL says so too, since Embed and share copy it.
    if (window.location.hash && stepIndex(window.location.hash, STEP_IDS) < 0) history.replaceState(history.state, '', `#${STEPS[0].id}`)
    const onHash = () => setActive(stepFromHash())
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  const go = (i: number, focus = false) => {
    // Each step is a history entry, so Back from Packet returns to Check (a typed hash already worked that way).
    if (i !== active) history.pushState(history.state, '', `#${STEPS[i].id}`)
    setActive(i)
    const panel = document.getElementById('steps')
    if (panel && panel.scrollHeight > panel.clientHeight) {
      // A new step starts at its top: "Next" at the end of the long Trace list used to open Check half scrolled.
      panel.scrollTop = 0
    } else if (panel) {
      // The page scrolls (phones): bring the steps to the top when a tap would otherwise change only text below the fold.
      const top = panel.getBoundingClientRect().top
      if (shouldScrollToSteps(top, window.innerHeight)) window.scrollBy({ top })
    }
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
            aria-controls={i === active ? `panel-${s.id}` : undefined}
            tabIndex={i === active ? 0 : -1}
            className="step-tab"
            onClick={() => go(i)}
          >
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <span>{t(s.label)}</span>
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">{langNotice}</p>

      <section ref={panel} role="tabpanel" id={`panel-${step}`} aria-labelledby={`tab-${step}`} className="step-panel">
        <h2 key={step}>{t(STEPS[active].title)}</h2>
        {/* The step's own title comes first; its limits follow it, at the rank of a note rather than above the title. */}
        <div className="limits-bar">
          <CannotSay items={ev.cannot_say} lang={packetReview.lang} />
        </div>
        {step === 'detect' && <Detect ev={ev} hour={hour} />}
        {step === 'trace' && <Trace ev={ev} corridor={corridor} outside={outside} onHighlight={onHighlight} place={place} onPlace={onPlace} />}
        {step === 'check' && <Check ev={ev} lang={packetReview.lang} />}
        {step === 'packet' && <Packet ev={ev} ai={ai} review={packetReview} setReview={reviewFromPacket} />}
        {/* The live region above is for screen readers; this is the same notice for everyone, right under Approve and File. */}
        {step === 'packet' && langNotice && <p className="lang-notice" aria-hidden="true">{langNotice}</p>}
        <nav className="step-nav" aria-label={t('nav.stepNav')}>
          {active > 0 && <button type="button" className="btn" onClick={() => go(active - 1, true)}>{t('nav.back', { step: t(STEPS[active - 1].label) })}</button>}
          {active < STEPS.length - 1 && <button type="button" className="btn btn-primary" onClick={() => go(active + 1, true)}>{t('nav.next', { step: t(STEPS[active + 1].label) })}</button>}
        </nav>
      </section>
    </>
  )
}

// Phones (and landscape phones, where the header took 56% of a 375px screen): the night picker and Embed move below
// the steps so the step heading makes the first screen. App.css uses the same query.
const PHONE = '(max-width: 640px), (max-height: 500px)'
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
      <SiteHeader className="top" lang={<LangSwitch />}>
        {/* The "·" separators are drawn by App.css before each item, so a wrapped line never ends on a dangling one. */}
        <p className="eyebrow">
          <span>{ev.date_local}</span> <span>{compoundLabel(lang, ev.compound.name)}</span>{' '}
          {ev.region && <><span>{ev.region.label}</span>{' '}</>}
          <span className={ev.label === 'real' ? 'data-tag' : 'data-tag is-fixture'}>{ev.label === 'real' ? t('app.dataReal') : t('app.dataFixture')}</span>
        </p>
        <h1 className="event-title" lang={title.lang === lang ? undefined : title.lang}>{title.text}</h1>
        {!phone && <div className="top-tools">{tools}</div>}
      </SiteHeader>
      {/* The notes sit inside main: outside every landmark, a screen reader's landmark jump skipped them (axe region). */}
      <main className="replay-main">
      {ev.label === 'fixture' && (
        <p className="fixture-banner" role="note"><strong>{t('app.fixtureLead')}</strong> {t('app.fixtureBody')}</p>
      )}
      {regionUnknown(window.location.search) && <p className="site-region-note" role="note">{t('region.unknown')}</p>}
      <div className="layout">
        <div className="stage">
        <section className="map-wrap" aria-labelledby="map-label" aria-describedby="map-note">
          <h2 id="map-label" className="sr-only">{t('app.mapLabel')}</h2>
          <p id="map-note" className="sr-only">{t('app.mapNote')}</p>
          <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={hour} place={place} />
        </section>
        <Timeline ev={ev} hour={hour} onHour={setHour} />
        </div>
        <aside className="panel" id="steps" tabIndex={-1} aria-label={t('nav.eventSteps')}>
          <Stepper ev={ev} hour={hour} onHighlight={setHighlightId} place={place} onPlace={setPlace} />
          {phone && (
            <details className="more-nights">
              <summary>{t('app.moreNights')}</summary>
              <div className="more-nights-body">
                {tools}
                {/* The phone header keeps only Past spikes; the other pages stay one tap away here (WCAG 1.4.10). */}
                <nav className="more-pages" aria-label={t('app.morePages')}>
                  <a href={navHref(BASE, 'timeline', window.location.search)}>{t('app.linkTimeline')}</a>
                  <a href={navHref(BASE, 'facilities', window.location.search)}>{t('common.facilities')}</a>
                  <a href={navHref(BASE, 'brief', window.location.search)}>{t('app.linkBrief')}</a>
                </nav>
              </div>
            </details>
          )}
        </aside>
      </div>
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
  const lang = useLang()
  // null while nights/index.json loads: the picker renders disabled at its full width, so the header doesn't jump.
  const [rows, setRows] = useState<NightRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [choice, setChoice] = useState(current ?? '')
  const region = regionFrom(window.location.search)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${BASE}${region.dir}nights/index.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: unknown) => {
        if (!Array.isArray(j)) throw new Error('nights/index.json is not a list')
        setRows(j as NightRow[])
      })
      .catch(() => { if (!ctrl.signal.aborted) setFailed(true) })
    return () => ctrl.abort()
  }, [region.dir])
  // Said, not silently dropped: a reader can't otherwise tell whether other nights exist.
  if (failed) return <p className="night-picker night-picker-msg">{t('night.unavailable')}</p>
  if (rows && !rows.length) return null
  const go = (id: string) => {
    // With the atlas landing page, an empty query would open the landing page, so "back to the demo" goes to the replay.
    // intro=0: a night picked from here skips the globe fly-in (about 9 MB of tiles at 1440px).
    if (id) window.location.search = regionQuery(region, { night: id, intro: '0' })
    else window.location.assign(DEMO_REPLAY_HREF)
  }
  const same = choice === (current ?? '')
  // Choosing does not navigate; the button does. Arrow keys on a closed select fire change on Windows, which
  // used to load a new night on the first key press (WCAG 3.2.2 On Input).
  return (
    <form className="night-picker" onSubmit={(e) => { e.preventDefault(); if (!same) go(choice) }}>
      <label htmlFor="night-select">{t('night.label')}</label>
      <div className="night-picker-row">
        <select id="night-select" value={choice} disabled={!rows} onChange={(e) => setChoice(e.target.value)}>
          <option value="">{region.key === DEFAULT_REGION ? t('night.demo') : t('night.demoHouston')}</option>
          {rows?.map((r) => <option key={r.id} value={r.id}>{r.date} · {compoundLabel(lang, r.compound)} · {r.site_name} · {r.value} ppb</option>)}
        </select>
        {/* Disabled until the choice differs: "Open" on the night already shown did nothing and said nothing. */}
        <button type="submit" className="btn" disabled={!rows || same}>{t('night.open')}</button>
      </div>
    </form>
  )
}

type Problem = { kind: LoadErrorKind | 'invalid'; detail: string }

/** Loading and error states keep the site header and footer (language switch, way back), as every other view does.
 *  Inside an embed there is no site chrome: the host page is the shell. */
function Shell({ children }: { children: ReactNode }) {
  if (isEmbed(window.location.search)) return <>{children}</>
  return <div className="site-shell"><SiteHeader />{children}<SiteFooter /></div>
}

function LoadProblem({ problem, night, onRetry }: { problem: Problem; night: string | null; onRetry: () => void }) {
  const t = useT()
  const lang = useLang()
  const region = regionFrom(window.location.search)
  const embed = isEmbed(window.location.search)
  const empty = problem.kind === 'noNights'
  const title = t(empty ? 'app.err.emptyTitle' : 'app.err.title')
  useEffect(() => { document.title = `${title} · Plume Witness` }, [title])
  const text = {
    invalid: () => t('app.notNight', { night: night ?? '' }),
    offline: () => t('app.err.offline'),
    network: () => t('app.err.network'),
    notFound: () => t('app.err.notFound'),
    damaged: () => t('app.err.damaged'),
    noNights: () => t('app.err.noNights', { region: region.name[lang] }),
  }[problem.kind]()
  // Retrying helps only when the next attempt can differ: a connection or a half-written file, not a missing night.
  const canRetry = problem.kind === 'offline' || problem.kind === 'network' || problem.kind === 'damaged'
  // On the demo night itself, "back to the demo night" pointed at the URL that just failed.
  const onDemo = night === null && region.key === DEFAULT_REGION
  const full = new URL(window.location.href)
  full.searchParams.delete('embed')
  return (
    <main className="state-msg">
      <div className="state-body" role={empty ? undefined : 'alert'}>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <div className="row">
        {canRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>{t('app.err.retry')}</button>}
        {embed
          ? <a className="btn" href={full.href} target="_blank" rel="noopener">{t('embed.openFull')}</a>
          : <>
              <a className="btn" href={navHref(BASE, 'spikes', window.location.search)}>{t('common.pastSpikes')}</a>
              {!onDemo && <a className="btn" href={DEMO_REPLAY_HREF}>{t('app.backDemo')}</a>}
            </>}
      </div>
      {problem.detail && (
        <details className="state-detail">
          <summary>{t('app.err.detail')}</summary>
          <code lang="en">{problem.detail}</code>
        </details>
      )}
    </main>
  )
}

export default function App() {
  const t = useT()
  const [ev, setEv] = useState<PlumeEvent | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  // Bumped by "Try again" so both loaders run once more.
  const [attempt, setAttempt] = useState(0)
  const region = regionFrom(window.location.search)
  // event.json is Houston's demo night, so a region with no ?night= first looks up its own first night.
  const [night, setNight] = useState(nightParam)
  // Keyed on Houston, not on `backtested`: a backtested region still has no event.json of its own.
  const needsStart = night === null && region.key !== DEFAULT_REGION
  const invalid = night !== null && !NIGHT_ID.test(night)
  const fail = (e: unknown) => setProblem(classifyLoadError(e, navigator.onLine))

  useEffect(() => {
    if (!needsStart) return
    const ctrl = new AbortController()
    const file = `${region.dir}nights/index.json`
    fetch(`${BASE}${file}`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        const bad = responseError(file, r.status, r.headers.get('content-type'))
        if (bad) throw bad
        return r.json()
      })
      .then((rows: unknown) => {
        const id = regionStartNight(rows)
        if (!id) throw new LoadError('noNights', `${file} lists no nights`)
        // The URL names the night it shows, so a shared link keeps opening the same one.
        const url = new URL(window.location.href)
        url.searchParams.set('night', id)
        history.replaceState(history.state, '', url)
        setNight(id)
      })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) fail(e) })
    return () => ctrl.abort()
  }, [needsStart, region.dir, attempt])

  useEffect(() => {
    const ctrl = new AbortController()
    if (invalid || needsStart) return
    const file = night ? `${region.dir}nights/${night}.json` : 'event.json'
    fetch(`${BASE}${file}`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        const bad = responseError(file, r.status, r.headers.get('content-type'))
        if (bad) throw bad
        return r.json()
      })
      .then((raw) => setEv(parseEvent(raw)))
      .catch((e: unknown) => { if (!ctrl.signal.aborted) fail(e) })
    return () => ctrl.abort()
  }, [night, invalid, needsStart, region.dir, attempt])
  // Every view shared "Plume Witness" as its title (WCAG 2.4.2); name the night being replayed, with its date so two
  // nights of the same compound can be told apart in tabs and history.
  const lang = useLang()
  useEffect(() => {
    if (ev) document.title = `${eventTitle(lang, ev.title, ev.compound.name, regionByKey(ev.region?.key).key).text} · ${ev.date_local} · Plume Witness`
  }, [ev, lang])

  const shown: Problem | null = invalid ? { kind: 'invalid', detail: '' } : problem
  if (shown) {
    const retry = () => { setProblem(null); setAttempt((a) => a + 1) }
    return <Shell><LoadProblem problem={shown} night={night} onRetry={retry} /></Shell>
  }
  if (!ev) return <Shell><main className="state-msg" aria-busy="true"><p>{t('app.loadingEvent')}</p></main></Shell>
  if (isEmbed(window.location.search)) return <EmbedReplay ev={ev} />
  return <Replay ev={ev} picker={<NightPicker current={night} />} />
}
