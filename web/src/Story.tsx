import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MapSlot } from './MapSlot'
import { SiteHeader } from './SiteHeader'
import { parseEvent, type PlumeEvent } from './types'
import { compass, distanceText } from './format'
import { compoundLabel } from './region'
import { LANDING_METRICS as M } from './landingMetrics'
import { STORY_COPY, STORY_STEPS, storyStepIndex } from './storyCopy'
import { useLang } from './useT'
import type { Lang } from './i18n'
// The map's box, legend and Key button are styled by the replay's stylesheet; Story.css lays out the rest.
import './App.css'
import './Story.css'

const BASE = import.meta.env.BASE_URL
/** The story's one night: Galena Park, 2024-03-29, 11 p.m. CST. Every number on screen is read from this file. */
export const STORY_NIGHT = '2024-03-29_45201_48_201_0057'
const KM_PER_MILE = 1.609344

/** people.json's ring for the trigger monitor (3 km): the share speaking Spanish at home. Optional: the story stands without it. */
type Ring = { km: number; pct: number }
function spanishRing(raw: unknown, siteId: string): Ring | null {
  const monitors = (raw as { monitors?: unknown })?.monitors
  if (!Array.isArray(monitors)) return null
  const m = monitors.find((x) => (x as { site_id?: unknown })?.site_id === siteId) as { radii_km?: Record<string, { pct_spanish_at_home?: unknown }> } | undefined
  const pct = m?.radii_km?.['3']?.pct_spanish_at_home
  return typeof pct === 'number' ? { km: 3, pct: Math.round(pct) } : null
}

const hourText = (h: number, lang: Lang): string => {
  const h12 = h % 12 === 0 ? 12 : h % 12
  if (lang === 'es') return `${h12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`
  return `${h12} ${h < 12 ? 'a.m.' : 'p.m.'}`
}
const dateText = (iso: string, lang: Lang): string =>
  new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))

/** The search text says how far past midnight it looked ("started 03/30/2024 by 02:00 local … (0 found"). */
function afterMidnight(scope: string): { until: string; found: number } | null {
  const m = /by (\d{1,2}:\d{2}) local were also searched \((\d+) found/.exec(scope)
  return m ? { until: m[1], found: Number(m[2]) } : null
}

function useStoryStep(): [number, (i: number) => void] {
  const [step, setStep] = useState(() => storyStepIndex(window.location.hash))
  useEffect(() => {
    const onHash = () => setStep(storyStepIndex(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // Each step is a history entry, so the browser's Back goes to the previous step.
  const go = (i: number) => { window.location.hash = STORY_STEPS[i] }
  return [step, go]
}

export default function Story() {
  const lang = useLang()
  const c = STORY_COPY[lang]
  const [ev, setEv] = useState<PlumeEvent | null>(null)
  const [ring, setRing] = useState<Ring | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [step, go] = useStoryStep()

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${BASE}nights/${STORY_NIGHT}.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`night ${r.status}`); return r.json() })
      .then((raw) => setEv(parseEvent(raw)))
      .catch((e: unknown) => { if (!ctrl.signal.aborted) { console.warn('Story night failed to load', e); setFailed(true) } })
    fetch(`${BASE}people.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setRing(spanishRing(raw, STORY_NIGHT.split('_').slice(2).join('_'))))
      .catch(() => { /* the Spanish-at-home line is left out */ })
    return () => ctrl.abort()
  }, [attempt])

  useEffect(() => { document.title = `${c.enter} · Plume Witness` }, [c.enter])

  if (failed) {
    return (
      <div className="story">
        <SiteHeader skipTo="story-main" />
        <main className="state-msg" id="story-main">
          <p>{c.failed}</p>
          <button type="button" className="btn" onClick={() => { setFailed(false); setAttempt((a) => a + 1) }}>{c.retry}</button>
        </main>
      </div>
    )
  }
  if (!ev) {
    return (
      <div className="story">
        <SiteHeader skipTo="story-main" />
        <main className="state-msg" id="story-main" aria-busy="true"><p>{c.loading}</p></main>
      </div>
    )
  }
  return <StoryView ev={ev} ring={ring} step={step} go={go} lang={lang} />
}

function StoryView({ ev, ring, step, go, lang }: { ev: PlumeEvent; ring: Ring | null; step: number; go: (i: number) => void; lang: Lang }) {
  const c = STORY_COPY[lang]
  const id = STORY_STEPS[step]
  const trigger = ev.monitors.find((m) => m.site_id === ev.detection.site_id)
  const place = trigger?.name ?? ev.detection.site_id
  const corridor = useMemo(() => [...ev.facilities].filter((f) => f.in_corridor).sort((a, b) => a.distance_km - b.distance_km), [ev])
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  // A step change moves focus to the new heading, so a keyboard or screen-reader user starts reading there.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    window.scrollTo(0, 0)
    heading.current?.focus({ preventScroll: true })
  }, [step])

  const back = step === 0
    ? <a className="story-btn story-btn-quiet" href={BASE}>{c.back}</a>
    : <button type="button" className="story-btn story-btn-quiet" onClick={() => go(step - 1)}>{c.back}</button>
  const next = (label: string) => (
    <button type="button" className="story-btn story-btn-go" onClick={() => go(step + 1)}>
      {label}
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
    </button>
  )
  const eyebrow = <p className={`story-eyebrow story-eyebrow-${id}`}>{c.progress(step + 1, STORY_STEPS.length)} · {c.eyebrow[id]}</p>
  const title = (text: string) => <h1 className="story-title" ref={heading} tabIndex={-1}>{text}</h1>

  return (
    <div className="story">
      <SiteHeader skipTo="story-main" />
      <div className="story-bar">
        <p className="story-bar-label">{c.bar(place, dateText(ev.date_local, lang))}</p>
        <ol className="story-progress" aria-label={c.progress(step + 1, STORY_STEPS.length)}>
          {STORY_STEPS.map((s, i) => (
            <li key={s} className={i <= step ? 'is-done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">{c.eyebrow[s]}</span>
            </li>
          ))}
        </ol>
        <a className="story-exit" href={BASE}>{c.exit}</a>
      </div>

      {step <= 1 ? (
        // Steps 1 and 2 share one map, so moving between them keeps it loaded and in place.
        <main className="story-main story-split" id="story-main">
          <section className="map-wrap story-map" aria-label={place}>
            <MapSlot ev={ev} corridor={corridor} highlightId={highlightId} hour={ev.detection.hour_cst} place={null} />
          </section>
          <aside className="story-panel">
            {eyebrow}
            {step === 0 ? <SpikeStep ev={ev} place={place} ring={ring} lang={lang} title={title} /> : <UpwindStep ev={ev} corridor={corridor} lang={lang} title={title} onHighlight={setHighlightId} />}
            <div className="story-nav">{back}{next(step === 0 ? c.spikeNext : c.upwindNext)}</div>
          </aside>
        </main>
      ) : (
        <main className="story-main story-wide" id="story-main">
          {step === 2
            ? <RecordStep ev={ev} lang={lang} title={title} eyebrow={eyebrow} nav={<div className="story-nav">{back}{next(c.recordNext)}</div>} />
            : <QuestionStep key={lang} ev={ev} lang={lang} title={title} eyebrow={eyebrow} back={back} onAgain={() => go(0)} />}
        </main>
      )}
    </div>
  )
}

type Title = (text: string) => ReactNode

function SpikeStep({ ev, place, ring, lang, title }: { ev: PlumeEvent; place: string; ring: Ring | null; lang: Lang; title: Title }) {
  const c = STORY_COPY[lang]
  const { value, baseline, hour_cst } = ev.detection
  const unit = 'ppb'
  return (
    <>
      {title(c.spikeTitle(hourText(hour_cst, lang), place))}
      <div className="story-reading">
        <span className="story-reading-value">{value} <small>{unit}</small></span>
        <span className="story-reading-sub">{c.spikeOf(compoundLabel(lang, ev.compound.name), Math.round(value / baseline), `${baseline} ${unit}`)}</span>
      </div>
      <p className="story-body">{c.spikeBody}</p>
      {ring && <p className="story-body">{c.spanish(ring.pct, `${(ring.km / KM_PER_MILE).toFixed(1)} mi (${ring.km} km)`)}</p>}
    </>
  )
}

function UpwindStep({ ev, corridor, lang, title, onHighlight }: {
  ev: PlumeEvent; corridor: PlumePlace[]; lang: Lang; title: Title; onHighlight: (id: string | null) => void
}) {
  const c = STORY_COPY[lang]
  const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)
  const row = (f: PlumePlace, i: number) => (
    <li key={f.id} tabIndex={0} onMouseEnter={() => onHighlight(f.id)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(f.id)} onBlur={() => onHighlight(null)}>
      <span className="story-num" aria-hidden="true">{i + 1}</span>
      <span className="story-fac">{f.name}</span>
      <span className="story-dist">{distanceText(f.distance_km)}</span>
    </li>
  )
  return (
    <>
      {title(c.upwindTitle(corridor.length))}
      {wind && wind.from_deg != null && wind.speed_mph != null && (
        <p className="story-wind">{c.wind(compass(wind.from_deg, lang), wind.from_deg, wind.speed_mph)}</p>
      )}
      <ol className="story-facs">{corridor.slice(0, 3).map(row)}</ol>
      {corridor.length > 3 && (
        <details className="story-more">
          <summary>{c.more(corridor.length - 3)}</summary>
          <ol className="story-facs" start={4}>{corridor.slice(3).map((f, i) => row(f, i + 3))}</ol>
        </details>
      )}
      <p className="story-note">{c.noSource}</p>
    </>
  )
}
type PlumePlace = PlumeEvent['facilities'][number]

function RecordStep({ ev, lang, title, eyebrow, nav }: { ev: PlumeEvent; lang: Lang; title: Title; eyebrow: ReactNode; nav: ReactNode }) {
  const c = STORY_COPY[lang]
  const rc = ev.record_check
  const ongoing = (rc as { ongoing_incidents?: unknown[] }).ongoing_incidents
  const after = afterMidnight(rc.search_scope)
  const day = new Date(`${ev.date_local}T12:00:00Z`)
  const short = (d: Date) => new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
  const nextDay = new Date(day.getTime() + 86_400_000)
  const matched = rc.status.startsWith('reported')
  const status = (s: string) => (s.startsWith('reported') ? c.reported : s === 'no_report_after_deadline' ? c.noReport : c.pending)
  return (
    <>
      <section className="story-col">
        {eyebrow}
        {title(c.recordTitle)}
        <table className="story-search">
          <tbody>
            <tr><th scope="row">{short(day)}</th><td>{c.rowDay}</td><td>{rc.day_incidents?.length ?? 0}</td></tr>
            {ongoing && <tr><th scope="row">{c.before30}</th><td>{c.rowOngoing}</td><td>{ongoing.length}</td></tr>}
            {after && <tr><th scope="row">{short(nextDay)}</th><td>{c.rowAfter(after.until)}</td><td>{after.found}</td></tr>}
          </tbody>
        </table>
        <p className="story-small">{c.handWork(M.spikes)}</p>
        <details className="story-more">
          <summary>{c.howSearched}</summary>
          <p lang="en">{rc.search_scope} <a href={rc.source_url} rel="noopener">TCEQ</a></p>
        </details>
      </section>
      <section className="story-side">
        <div className={`story-result${matched ? ' is-matched' : ''}`}>
          <p className="story-result-label">{c.result}</p>
          <p className="story-result-value">{matched ? c.matched : c.noMatch}</p>
          <dl>
            {rc.checks.map((k) => (
              <div key={k.at}><dt>{k.at.replace('h', ' h').replace('d', ' d')}</dt><dd>{status(k.status)}</dd></div>
            ))}
          </dl>
        </div>
        {!matched && <p className="story-caveat"><b>{c.caveatLead}</b> {c.caveat}</p>}
        {nav}
      </section>
    </>
  )
}

function QuestionStep({ ev, lang, title, eyebrow, back, onAgain }: { ev: PlumeEvent; lang: Lang; title: Title; eyebrow: ReactNode; back: ReactNode; onAgain: () => void }) {
  const c = STORY_COPY[lang]
  // The question's language starts as the site's (StoryView keys this step on it) and can be switched here alone.
  const [shown, setShown] = useState<Lang>(lang)
  const draft = shown === 'es' ? ev.packet.draft_es : ev.packet.draft_en
  const replay = `${BASE}?night=${STORY_NIGHT}&intro=0#packet`
  return (
    <>
      <section className="story-col">
        {eyebrow}
        {title(c.questionTitle)}
        <div className="story-seg" role="group" aria-label={c.showIn}>
          <button type="button" aria-pressed={shown === 'en'} onClick={() => setShown('en')} lang="en">English</button>
          <button type="button" aria-pressed={shown === 'es'} onClick={() => setShown('es')} lang="es">Español</button>
        </div>
        <blockquote className="story-draft" lang={shown}>{draft}</blockquote>
        <div className="story-act">
          <a className="story-btn story-btn-go" href={replay}>{c.openReplay}</a>
          <p className="story-small">{c.person}</p>
        </div>
      </section>
      <section className="story-side">
        <div className="story-big">
          <span className="story-big-n">{M.noReport}</span>
          <span className="story-big-text">{c.bigNumber}</span>
          <span className="story-big-sub">{c.outOf(M.spikes, M.monitors)}</span>
        </div>
        <a className="story-btn story-btn-coral" href={`${BASE}?view=spikes`}>{c.seeAll(M.noReport)}</a>
        <button type="button" className="story-btn story-btn-quiet" onClick={onAgain}>{c.again}</button>
        <div className="story-nav story-nav-end">{back}</div>
      </section>
    </>
  )
}
