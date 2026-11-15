import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { STATUS_FILL, hourLabel, statusInfo, statusLabel } from './format'
import { StatusIcon } from './StatusIcon'
import { parseSpikes, rowStatusLabel, spikeKey } from './spikes'
import {
  MONTHS_TOTAL, SPEEDS, TOTAL_DAYS, clampDay, countAt, dayFromParam, fadeDaysFor, isoFromDay, monthOfDay,
  monthStartDay, monthSummary, prefixCounts, timeSpikes, visibleAt, type SpeedKey, type Timed,
} from './rain'
import type { RainMapApi } from './RainMap'
import { DEMO_REPLAY_HREF } from './demoHref'
import { T } from './LangSwitch'
import { useLang, useT } from './useT'
import { dateLabel, monthShort, monthYearLabel, type Lang } from './i18n'
import { compoundLabel } from './region'
import { nightHref as nightLink, spikeTip, withAt } from './rainLinks'
import './SpikeRain.css'

// MapLibre + deck.gl load after the controls and text have rendered.
const RainMap = lazy(() => import('./RainMap'))

const OPEN_QUESTION = 'no_report_after_deadline'
const STATUS_ORDER = ['no_report_after_deadline', 'reported_mismatch', 'search_incomplete', 'reported']
/** A spike with no night file (no wind data) is listed but not linked: a link would 404. */
const RowLink = ({ id, children }: { id: string | null; children: ReactNode }) =>
  id ? <a href={nightHref(id)}>{children}</a> : <span className="rn-nolink">{children}</span>
const nightHref = (id: string) => nightLink(import.meta.env.BASE_URL, id)
/** Latest-spike cards in rain mode: always this many slots, so a new spike never reflows the page. */
const LATEST_SLOTS = 6
/** During playback the date, counts and list repaint at most this often (the map still draws every frame). */
const UI_FRAME_MS = 80
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright'
/** Without IntersectionObserver (old browsers), autoplay as before rather than never. */
const NO_IO = typeof IntersectionObserver === 'undefined'

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

function Ticks({ spikes, month, lang }: { spikes: readonly Timed[]; month: number; lang: Lang }) {
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
            {m % 12 === 0 ? <b>{2024 + m / 12}</b> : m % 3 === 0 ? monthShort(m % 12, lang) : null}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function SpikeRain() {
  const t = useT()
  const lang = useLang()
  const [spikes, setSpikes] = useState<Timed[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [mapFailed, setMapFailed] = useState(false)
  const [basemapFailed, setBasemapFailed] = useState(false)
  // Autoplay waits until the Play/Pause button is on screen, so nobody watches it run with no way to stop it.
  const [controlsSeen, setControlsSeen] = useState(false)
  const playRef = useRef<HTMLButtonElement>(null)
  // Set by a reader's own pause, scrub or arrow key: only then does the URL carry the date (?at=).
  const userMoved = useRef(false)
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
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}spikes.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`spikes.json: HTTP ${r.status}`)
        return r.json()
      })
      .then((raw) => {
        const t = timeSpikes(parseSpikes(raw).rows)
        spikesRef.current = t
        setSpikes(t)
        setN(countAt(t, tRef.current))
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        // The reader gets a plain sentence and Retry; the cause stays here for whoever debugs it.
        console.error('Timeline: could not load spikes.json', e)
        setError(true)
      })
    return () => ctrl.abort()
  }, [attempt])

  useEffect(() => { document.title = t('rn.docTitle') }, [t])

  const prefix = useMemo(() => (spikes ? prefixCounts(spikes) : [{}]), [spikes])

  /** The one place time changes: draws the map directly (no React render per frame), then updates the readouts.
   *  `readouts: false` (playback frames between UI_FRAME_MS ticks) draws the map only. */
  const commit = useCallback((t: number, readouts = true) => {
    const all = spikesRef.current
    t = clampDay(t)
    tRef.current = t
    const api = apiRef.current
    if (api) {
      api.draw(reducedRef.current
        ? { kind: 'month', month: monthOfDay(t) }
        : { kind: 'rain', visible: visibleAt(all, t, fadeDaysFor(SPEEDS.find((s) => s.key === speedRef.current)!.daysPerSec)) })
    }
    if (!readouts) return
    setDay(Math.floor(t))
    setN(countAt(all, t))
  }, [])

  const onApi = useCallback((api: RainMapApi | null) => {
    apiRef.current = api
    setMapReady(api !== null)
    if (api) commit(tRef.current)
  }, [commit])

  useEffect(() => {
    const el = playRef.current
    if (controlsSeen || !el || NO_IO) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.intersectionRatio > 0.99)) setControlsSeen(true) }, { threshold: [0, 1] })
    io.observe(el)
    return () => io.disconnect()
  }, [controlsSeen, spikes, reduced])

  // Autoplay once the map can show it and its Pause button is in view, unless the reader asked for no motion or
  // deep-linked to a date.
  useEffect(() => {
    if (!mapReady || !(controlsSeen || NO_IO) || started.current) return
    started.current = true
    if (!reducedRef.current && initial === null && !userMoved.current) setPlaying(true)
  }, [mapReady, controlsSeen, initial])

  // A paused position is shareable: ?at=YYYY-MM-DD (read back by dayFromParam on load). Debounced for scrubbing.
  useEffect(() => {
    if (playing || !userMoved.current) return
    const id = window.setTimeout(() => {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${withAt(window.location.search, isoFromDay(day))}${window.location.hash}`)
    }, 250)
    return () => window.clearTimeout(id)
  }, [day, playing])

  // Speed changes the fade window; reduced motion swaps the frame kind. Redraw in place.
  useEffect(() => { if (mapReady) commit(tRef.current) }, [speed, reduced, mapReady, commit])

  useEffect(() => {
    if (!playing || !mapReady) return
    const perSec = SPEEDS.find((s) => s.key === speed)!.daysPerSec
    let raf = 0
    let last = performance.now()
    let lastReadout = -Infinity
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
      const readouts = now - lastReadout >= UI_FRAME_MS
      if (readouts) lastReadout = now
      commit(t, readouts)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, mapReady, commit])

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) return
      setPlaying(false)
      commit(tRef.current) // the last frame may have skipped its readouts
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [commit])

  const toggle = useCallback(() => {
    if (reducedRef.current || !apiRef.current) return
    userMoved.current = true
    if (!playingRef.current && tRef.current >= TOTAL_DAYS) commit(0)
    if (playingRef.current) commit(tRef.current) // pause shows the exact frame, not the last throttled readout
    setPlaying(!playingRef.current)
  }, [commit])

  const step = useCallback((dir: 1 | -1) => {
    userMoved.current = true
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

  const onScrub = (v: number) => {
    userMoved.current = true
    commit(reduced ? monthStartDay(v) : v)
  }
  const onPick = useCallback((id: string) => window.location.assign(nightHref(id)), [])

  if (error) {
    return (
      <main className="rn-page rn-state state-msg" role="alert">
        <h1>{t('rn.errTitle')}</h1>
        <p>{t('rn.errLoad')}</p>
        <p className="rn-state-actions">
          <button type="button" className="btn btn-primary" onClick={() => { setError(false); setAttempt((a) => a + 1) }}>{t('rn.retry')}</button>
          <a href={DEMO_REPLAY_HREF}>{t('rn.openReplay')}</a>
        </p>
      </main>
    )
  }
  if (!spikes) return <main className="rn-page rn-state state-msg" aria-busy="true"><p>{t('rn.loading')}</p></main>

  const month = monthOfDay(day)
  const counts = prefix[reduced ? 0 : n] ?? {}
  const monthCounts = reduced ? spikes.filter((s) => s.month === month).reduce<Record<string, number>>((a, s) => ({ ...a, [s.row.status]: (a[s.row.status] ?? 0) + 1 }), {}) : counts
  const total = reduced ? Object.values(monthCounts).reduce((a, b) => a + b, 0) : n
  const perSec = SPEEDS.find((s) => s.key === speed)!.daysPerSec
  const recent = reduced ? spikes.filter((s) => s.month === month) : spikes.slice(Math.max(0, n - LATEST_SLOTS), n).reverse()
  const listed = recent.slice(0, 12)
  const date = dateLabel(isoFromDay(day), lang)
  const monthName = monthYearLabel(month, lang)
  const atEnd = day >= TOTAL_DAYS
  const pct = ((reduced ? month : Math.min(day, TOTAL_DAYS - 1)) / (reduced ? MONTHS_TOTAL - 1 : TOTAL_DAYS - 1)) * 100
  const sliderMax = reduced ? MONTHS_TOTAL - 1 : TOTAL_DAYS - 1
  const sliderValue = reduced ? month : Math.min(day, TOTAL_DAYS - 1)

  return (
    <main className="rn-page">
      <header className="rn-head">
        <p className="rn-kicker">{t('rn.kicker')}</p>
        <h1>{t('rn.title')}</h1>
        <p className="rn-sub">{t('rn.sub', { n: spikes.length })}</p>
      </header>

      <div className="rn-stage">
        <div className="rn-main">
          <div className="rn-map" role="group" aria-label={t('rn.mapLabel')}>
            <Suspense fallback={<p className="rn-map-msg">{t('rn.mapLoading')}</p>}>
              {mapFailed ? null : (
                <RainMap spikes={spikes} label={t('rn.mapLabel')} tipFor={(row) => spikeTip(row, lang)}
                  onApi={onApi} onPick={onPick} onError={() => setMapFailed(true)} onBasemapError={() => setBasemapFailed(true)} />
              )}
            </Suspense>
            {mapFailed && <p className="rn-map-msg" role="status">{t('rn.mapFailed')}</p>}
            {basemapFailed && !mapFailed && <p className="rn-map-note" role="status">{t('rn.basemapFailed')}</p>}
            <div className="rn-hud" aria-hidden="true">
              <span className="rn-date">{reduced ? monthName : date}</span>
              <span className="rn-total">{reduced ? t(total === 1 ? 'rn.hudOne' : 'rn.hudMany', { n: total }) : t('rn.hudSoFar', { n, total: spikes.length })}</span>
            </div>
          </div>
          <p className="rn-credit">
            <T k="rn.credit" v={{
              ofm: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap<span className="rn-sr">{t('chk.newTab')}</span></a>,
              omt: <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles<span className="rn-sr">{t('chk.newTab')}</span></a>,
              osm: <a href={OSM_COPYRIGHT} target="_blank" rel="noopener">{t('rn.osm')}<span className="rn-sr">{t('chk.newTab')}</span></a>,
            }} />
          </p>
          <p className="rn-caption">{t('rn.caption')}</p>

          <div className="rn-controls" role="group" aria-label={t('rn.controls')}>
            <div className="rn-buttons">
              {!reduced && (
                <button type="button" ref={playRef} className="btn btn-primary rn-play" onClick={toggle} disabled={!mapReady}>
                  {/* Disabled until the map can draw; the map pane says "Loading the map…". The label stays Play rather than
                      that longer text, whose width change wrapped the speed buttons and shifted the page (CLS 0.077 at 375px). */}
                  {/* All three labels share one grid cell, so autoplay's Play -> Pause never changes the button's width. */}
                  <span className="rn-play-label">
                    {(['play', 'pause', 'replay'] as const).map((k) => (
                      <span key={k} className={k === (playing ? 'pause' : atEnd ? 'replay' : 'play') ? undefined : 'rn-ghost'}>{t(`rn.${k}`)}</span>
                    ))}
                  </span>
                  {mapReady && <span className="rn-key" aria-hidden="true">{t('rn.space')}</span>}
                </button>
              )}
              {!reduced && (
                <div className="rn-speed" role="group" aria-label={t('rn.speed')}>
                  {SPEEDS.map((s) => (
                    <button key={s.key} type="button" className="btn" aria-pressed={speed === s.key} onClick={() => setSpeed(s.key)}>{t(s.key === 'week' ? 'rn.speedWeek' : 'rn.speedMonth')}</button>
                  ))}
                </div>
              )}
              {reduced && <p className="rn-rm">{t('rn.reduced')}</p>}
            </div>
            <div className="rn-scrub">
              <input
                type="range" min={0} max={sliderMax} step={1} value={sliderValue}
                aria-label={reduced ? t('rn.sliderMonth') : t('rn.sliderDate')}
                aria-valuetext={reduced ? monthName : date}
                aria-describedby="rn-summary"
                style={{ '--p': `${pct}%` } as React.CSSProperties}
                onChange={(e) => onScrub(Number(e.target.value))}
              />
              <Ticks spikes={spikes} month={month} lang={lang} />
            </div>
            <p className="rn-hint">{t('rn.hint', { unit: t(reduced ? 'rn.unitMonth' : 'rn.unitWeek') })}</p>
          </div>

          {/* Announced only when the timeline is still, so playback never talks over a screen reader. */}
          <p id="rn-summary" className="rn-sr" aria-live="polite">{playing ? '' : monthSummary(spikes, month, lang)}</p>
        </div>

        <aside className="rn-side">
          <section aria-label={reduced ? t('rn.secMonthCounts') : t('rn.secRunning')}>
            <h2>{reduced ? t('rn.hMonthCounts', { month: monthName }) : t('rn.hRunning')}</h2>
            <ul className="rn-counts">
              {STATUS_ORDER.map((s) => (
                <li key={s}>
                  <span className={`rn-dot${s === OPEN_QUESTION ? ' rn-dot-ring' : ''}`} style={{ '--dot': STATUS_FILL[s] } as CSSProperties} aria-hidden="true" />
                  <span className="rn-count-label" lang={lang}>{statusLabel(s, lang)}</span>
                  <span className="rn-count-n">{monthCounts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
            <p className="rn-key-note">
              {t('rn.dotSize')}
              {!reduced && t('rn.fade', { d: Math.round(fadeDaysFor(perSec)) })}
            </p>
          </section>

          <section aria-label={reduced ? t('rn.secMonthList') : t('rn.secLatest')}>
            <h2>{reduced ? t('rn.secMonthList') : t('rn.secLatest')}</h2>
            {/* Rain mode: fixed-height cards in fixed slots (keyed by slot, not by spike), so playback swaps text in
                place instead of pushing every card down a row; that push was the page's layout shift (CLS ~1.0). */}
            <div className={reduced ? undefined : 'rn-latest'}>
              {listed.length ? (
                <ul className="rn-list">
                  {listed.map((s, slot) => (
                    <li key={reduced ? spikeKey(s.row) : `slot-${slot}`}>
                      <RowLink id={s.row.night_id}>
                        <span className="rn-li-when"><time dateTime={s.row.date}>{dateLabel(s.row.date, lang)}</time> · {hourLabel(s.row.hour_cst)}</span>
                        <span className="rn-li-what">{[s.row.site, compoundLabel(lang, s.row.compound), s.row.ratio === null ? null : t('rn.ratio', { r: s.row.ratio })].filter(Boolean).join(' · ')}</span>
                        <span className={`sl-status sl-status-${s.row.status}`} lang={lang}><StatusIcon kind={statusInfo(s.row.status).icon} size={14} />{rowStatusLabel(s.row, lang)}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              ) : <p className="rn-empty">{t(reduced ? 'rn.noneMonth' : 'rn.noneYet')}</p>}
            </div>
            {recent.length > listed.length && <p className="rn-empty"><T k="rn.more" v={{ n: recent.length - listed.length, link: <a href={`${import.meta.env.BASE_URL}?view=spikes`}>{t('rn.moreLink')}</a> }} /></p>}
            <p className="rn-key-note">{t('rn.linkNote')}</p>
          </section>
        </aside>
      </div>
      <p className="rn-foot">{t('rn.foot')}</p>
    </main>
  )
}
