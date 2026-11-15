import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUS_FILL, hourLabel, statusInfo } from './format'
import { dateText, parseSpikes } from './spikes'
import {
  MONTHS_TOTAL, SPEEDS, TOTAL_DAYS, clampDay, countAt, dayFromParam, fadeDaysFor, isoFromDay, monthLabel, monthOfDay,
  monthStartDay, monthSummary, prefixCounts, timeSpikes, visibleAt, type SpeedKey, type Timed,
} from './rain'
import type { RainMapApi } from './RainMap'
import { DEMO_REPLAY_HREF } from './demoHref'
import './SpikeRain.css'

// MapLibre + deck.gl load after the controls and text have rendered.
const RainMap = lazy(() => import('./RainMap'))

const STATUS_ORDER = ['no_report_after_deadline', 'reported_mismatch', 'search_incomplete', 'reported']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CAPTION = "Each dot is a spike at a state monitor. 'No matching report' is a question, not a finding."
const nightHref = (id: string) => `${import.meta.env.BASE_URL}?night=${encodeURIComponent(id)}`

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function Ticks({ spikes, month }: { spikes: readonly Timed[]; month: number }) {
  const bars = useMemo(() => {
    const per = Array.from({ length: MONTHS_TOTAL }, () => 0)
    for (const s of spikes) per[s.month]++
    return per
  }, [spikes])
  const max = Math.max(...bars, 1)
  return (
    <div className="rn-ticks" aria-hidden="true">
      <svg viewBox={`0 0 ${TOTAL_DAYS} 28`} preserveAspectRatio="none" className="rn-bars">
        {bars.map((n, m) => {
          const x = monthStartDay(m), w = monthStartDay(m + 1) - x
          const h = Math.max(1, (n / max) * 28)
          return <rect key={m} x={x + 1} y={28 - h} width={w - 2} height={h} className={m <= month ? 'on' : ''} />
        })}
      </svg>
      <div className="rn-months">
        {Array.from({ length: MONTHS_TOTAL }, (_, m) => (
          <span key={m} className={`rn-tick${m % 12 === 0 ? ' year' : ''}`} style={{ left: `${(monthStartDay(m) / TOTAL_DAYS) * 100}%` }}>
            {m % 12 === 0 ? <b>{2024 + m / 12}</b> : m % 3 === 0 ? MONTH_ABBR[m % 12] : null}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SpikeRain() {
  const [spikes, setSpikes] = useState<Timed[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const reduced = useReducedMotion()
  const initial = useMemo(() => dayFromParam(new URLSearchParams(window.location.search).get('at')), [])
  const [day, setDay] = useState(initial ?? 0)
  const [n, setN] = useState(0)
  const [wantPlay, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<SpeedKey>('month')
  const [mapReady, setMapReady] = useState(false)
  // Reduced motion wins over any earlier Play.
  const playing = wantPlay && !reduced

  const tRef = useRef(initial ?? 0)
  const apiRef = useRef<RainMapApi | null>(null)
  const spikesRef = useRef<Timed[]>([])
  const speedRef = useRef(speed)
  const reducedRef = useRef(reduced)
  const playingRef = useRef(playing)
  // Mirrors for code that runs outside render (rAF, key handler); declared first so later effects read fresh values.
  useEffect(() => {
    speedRef.current = speed
    reducedRef.current = reduced
    playingRef.current = playing && !reduced
  })
  const started = useRef(false)

  useEffect(() => {
    document.title = 'Two years of spikes · Houston Ship Channel · Plume Witness'
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}spikes.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load spikes.json (HTTP ${r.status}). Check that web/public/spikes.json exists.`)
        return r.json()
      })
      .then((raw) => {
        const t = timeSpikes(parseSpikes(raw).rows)
        spikesRef.current = t
        setSpikes(t)
        setN(countAt(t, tRef.current))
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [])

  const prefix = useMemo(() => (spikes ? prefixCounts(spikes) : [{}]), [spikes])

  /** The one place time changes: draws the map directly (no React render per frame), then updates the readouts. */
  const commit = useCallback((t: number) => {
    const all = spikesRef.current
    t = clampDay(t)
    tRef.current = t
    const api = apiRef.current
    if (api) {
      api.draw(reducedRef.current
        ? { kind: 'month', month: monthOfDay(t) }
        : { kind: 'rain', visible: visibleAt(all, t, fadeDaysFor(SPEEDS.find((s) => s.key === speedRef.current)!.daysPerSec)) })
    }
    setDay(Math.floor(t))
    setN(countAt(all, t))
  }, [])

  const onApi = useCallback((api: RainMapApi | null) => {
    apiRef.current = api
    setMapReady(api !== null)
    if (api) commit(tRef.current)
  }, [commit])

  // Autoplay once the map can show it, unless the reader asked for no motion or deep-linked to a date.
  useEffect(() => {
    if (!mapReady || started.current) return
    started.current = true
    if (!reducedRef.current && initial === null) setPlaying(true)
  }, [mapReady, initial])

  // Speed changes the fade window; reduced motion swaps the frame kind. Redraw in place.
  useEffect(() => { if (mapReady) commit(tRef.current) }, [speed, reduced, mapReady, commit])

  useEffect(() => {
    if (!playing || !mapReady) return
    const perSec = SPEEDS.find((s) => s.key === speed)!.daysPerSec
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // A long gap (tab in the background, a stall) must not jump the timeline.
      const dt = Math.min(now - last, 100) / 1000
      last = now
      const t = tRef.current + perSec * dt
      if (t >= TOTAL_DAYS) {
        commit(TOTAL_DAYS)
        setPlaying(false)
        return
      }
      commit(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, mapReady, commit])

  useEffect(() => {
    const onVis = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const toggle = useCallback(() => {
    if (reducedRef.current || !apiRef.current) return
    if (!playingRef.current && tRef.current >= TOTAL_DAYS) commit(0)
    setPlaying(!playingRef.current)
  }, [commit])

  const step = useCallback((dir: 1 | -1) => {
    if (reducedRef.current) commit(monthStartDay(Math.min(MONTHS_TOTAL - 1, Math.max(0, monthOfDay(tRef.current) + dir))))
    else commit(tRef.current + 7 * dir)
  }, [commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const el = e.target as HTMLElement
      const tag = el.tagName
      if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range')) return
      if (e.key === ' ' || e.key === 'Spacebar') {
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        step(e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, step])

  const onScrub = (v: number) => commit(reduced ? monthStartDay(v) : v)
  const onPick = useCallback((id: string) => window.location.assign(nightHref(id)), [])

  const back = <a className="rn-back" href={`${import.meta.env.BASE_URL}?view=spikes`}>← Back to the spike log</a>
  if (error) return <main className="rn-page state-msg" role="alert"><h1>Two years of spikes</h1><p>{error}</p><a href={DEMO_REPLAY_HREF}>Open the event replay</a></main>
  if (!spikes) return <main className="rn-page state-msg"><p>Loading two years of spikes…</p></main>

  const month = monthOfDay(day)
  const counts = prefix[reduced ? 0 : n] ?? {}
  const monthCounts = reduced ? spikes.filter((s) => s.month === month).reduce<Record<string, number>>((a, s) => ({ ...a, [s.row.status]: (a[s.row.status] ?? 0) + 1 }), {}) : counts
  const total = reduced ? Object.values(monthCounts).reduce((a, b) => a + b, 0) : n
  const perSec = SPEEDS.find((s) => s.key === speed)!.daysPerSec
  const recent = reduced ? spikes.filter((s) => s.month === month) : spikes.slice(Math.max(0, n - 6), n).reverse()
  const listed = recent.slice(0, 12)
  const date = dateText(isoFromDay(day))
  const atEnd = day >= TOTAL_DAYS
  const pct = ((reduced ? month : Math.min(day, TOTAL_DAYS - 1)) / (reduced ? MONTHS_TOTAL - 1 : TOTAL_DAYS - 1)) * 100
  const sliderMax = reduced ? MONTHS_TOTAL - 1 : TOTAL_DAYS - 1
  const sliderValue = reduced ? month : Math.min(day, TOTAL_DAYS - 1)

  return (
    <main className="rn-page">
      {back}
      <header className="rn-head">
        <p className="rn-kicker">Plume Witness · Houston Ship Channel monitors</p>
        <h1>Two years of spikes, in time order</h1>
        <p className="rn-sub">{spikes.length} hours when a state air monitor read far above its own recent normal, January 2024 to December 2025. Press play, or drag the date.</p>
      </header>

      <div className="rn-stage">
        <div className="rn-main">
          <div className="rn-map" role="group" aria-label="Map of spikes at state monitors, Houston Ship Channel">
            <Suspense fallback={<p className="rn-map-msg">Loading the map…</p>}>
              {mapFailed ? null : <RainMap spikes={spikes} onApi={onApi} onPick={onPick} onError={() => setMapFailed(true)} />}
            </Suspense>
            {mapFailed && <p className="rn-map-msg" role="status">The map couldn't load. Every spike is listed as text below.</p>}
            <div className="rn-hud" aria-hidden="true">
              <span className="rn-date">{reduced ? monthLabel(month) : date}</span>
              <span className="rn-total">{reduced ? `${total} ${total === 1 ? 'spike' : 'spikes'} this month` : `${n} of ${spikes.length} spikes so far`}</span>
            </div>
          </div>
          <p className="rn-caption">{CAPTION}</p>

          <div className="rn-controls" role="group" aria-label="Timeline controls">
            <div className="rn-buttons">
              {!reduced && (
                <button type="button" className="btn btn-primary rn-play" onClick={toggle} disabled={!mapReady}>
                  {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
                  <span className="rn-key" aria-hidden="true">space</span>
                </button>
              )}
              {!reduced && (
                <div className="rn-speed" role="group" aria-label="Speed">
                  {SPEEDS.map((s) => (
                    <button key={s.key} type="button" className="btn" aria-pressed={speed === s.key} onClick={() => setSpeed(s.key)}>{s.label}</button>
                  ))}
                </div>
              )}
              {reduced && <p className="rn-rm">Animation is off (your device asks for reduced motion). Pick a month; its spikes show as dots.</p>}
            </div>
            <div className="rn-scrub">
              <input
                type="range" min={0} max={sliderMax} step={1} value={sliderValue}
                aria-label={reduced ? 'Month' : 'Date, 1 January 2024 to 31 December 2025'}
                aria-valuetext={reduced ? monthLabel(month) : date}
                aria-describedby="rn-summary"
                style={{ '--p': `${pct}%` } as React.CSSProperties}
                onChange={(e) => onScrub(Number(e.target.value))}
              />
              <Ticks spikes={spikes} month={month} />
            </div>
            <p className="rn-hint">Space plays or pauses. Left and right arrows step {reduced ? 'a month' : 'a week'}.</p>
          </div>

          {/* Announced only when the timeline is still, so playback never talks over a screen reader. */}
          <p id="rn-summary" className="rn-sr" aria-live="polite">{playing ? '' : monthSummary(spikes, month)}</p>
        </div>

        <aside className="rn-side">
          <section aria-label={reduced ? 'Spikes this month by record check' : 'Running count by record check'}>
            <h2>{reduced ? `${monthLabel(month)}, by record check` : 'So far, by record check'}</h2>
            <ul className="rn-counts">
              {STATUS_ORDER.map((s) => (
                <li key={s}>
                  <span className="rn-dot" style={{ background: STATUS_FILL[s] }} aria-hidden="true" />
                  <span className="rn-count-label">{statusInfo(s).en}</span>
                  <span className="rn-count-n">{monthCounts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
            <p className="rn-key-note">
              Dot size: how many times the monitor's own 7-day median (10× to about 2,900×, log scale).
              {!reduced && ` Dots fade over ${Math.round(fadeDaysFor(perSec))} days of timeline (2 seconds).`}
            </p>
          </section>

          <section aria-label={reduced ? 'Spikes this month' : 'Latest spikes'}>
            <h2>{reduced ? 'Spikes this month' : 'Latest spikes'}</h2>
            {listed.length ? (
              <ul className="rn-list">
                {listed.map((s) => (
                  <li key={s.row.night_id}>
                    <a href={nightHref(s.row.night_id)}>
                      <span className="rn-li-when"><time dateTime={s.row.date}>{dateText(s.row.date)}</time> · {hourLabel(s.row.hour_cst)}</span>
                      <span className="rn-li-what">{[s.row.site, s.row.compound, s.row.ratio === null ? null : `${s.row.ratio}× baseline`].filter(Boolean).join(' · ')}</span>
                      <span className={`sl-status sl-status-${s.row.status}`}>{statusInfo(s.row.status).en}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : <p className="rn-empty">No spikes {reduced ? 'this month' : 'yet'}.</p>}
            {recent.length > listed.length && <p className="rn-empty">and {recent.length - listed.length} more; see the <a href={`${import.meta.env.BASE_URL}?view=spikes`}>spike log</a>.</p>}
            <p className="rn-key-note">Each link opens that night's replay.</p>
          </section>
        </aside>
      </div>
      <p className="rn-foot">Readings are TCEQ hourly AutoGC values, provisional. Hours are CST. Dots mark monitors, never facilities.</p>
    </main>
  )
}
