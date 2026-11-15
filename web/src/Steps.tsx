import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react'
import { type AiDraft, type DayIncident, type Facility, type Monitor, type PlumeEvent } from './types'
import { compass, hourLabel, safeHttpUrl, statusInfo } from './format'
import { CountUp, DrawnCheck, FadeWord, HoldButton, SwipeToast } from './fx'
import { spotlight, useTypewriter } from './fxHooks'
import type { Lang, PacketReview, Source } from './packet'
import { PlaceSearch, type Place } from './PlaceSearch'
import { Rose } from './Rose'

function StatusIcon({ kind }: { kind: ReturnType<typeof statusInfo>['icon'] }) {
  const common = { width: 18, height: 18, viewBox: '0 0 20 20', 'aria-hidden': true, focusable: false } as const
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  switch (kind) {
    case 'check':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M6 10.5l2.7 2.7L14 7.5" {...stroke} /></svg>
    case 'clock':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M10 5.5V10l3 2" {...stroke} /></svg>
    case 'mismatch':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M6 8h8M6 12h8M12.5 5.5l-5 9" {...stroke} /></svg>
    case 'question':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M7.7 7.6a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1.1.9-1.1 1.6v.4" {...stroke} /><circle cx="10" cy="14.6" r=".6" fill="currentColor" /></svg>
    default:
      return <svg {...common}><path d="M10 2.5l8 14.5H2z" {...stroke} /><path d="M10 8v4" {...stroke} /><circle cx="10" cy="14.4" r=".6" fill="currentColor" /></svg>
  }
}

function InfoIcon() {
  return (
    <svg className="inline-icon" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="8.5" /><path d="M10 9v5" /><circle cx="10" cy="6.2" r=".6" fill="currentColor" />
    </svg>
  )
}

/** `drawDelay` (seconds) draws a "reported" check in and fades its word in after it (Status Mark). The word is
 *  always there: status is stated in words, the mark only repeats it. */
export function StatusBadge({ status, drawDelay }: { status: string; drawDelay?: number }) {
  const info = statusInfo(status)
  const draw = drawDelay !== undefined && info.icon === 'check'
  return (
    <span className={`status status-${status}`}>
      {draw ? <DrawnCheck delay={drawDelay} /> : <StatusIcon kind={info.icon} />}
      {draw ? <FadeWord delay={drawDelay}>{info.en}</FadeWord> : <span>{info.en}</span>}
    </span>
  )
}

function Sparkline({ m, units, highlightHour, selectedHour }: { m: Monitor; units: string; highlightHour: number; selectedHour: number }) {
  const W = 288, H = 96, pad = 14
  const values = m.hourly.map((h) => h.value ?? 0)
  const max = Math.max(...values, m.baseline) || 1
  const bw = (W - 4) / 24
  const y = (v: number) => H - pad - (v / max) * (H - pad - 6)
  const missing = m.hourly.filter((h) => h.value === null).length
  const summary = `24 hourly readings at ${m.name}. Highest ${m.peak.value} ${units} at ${hourLabel(m.peak.hour_cst)}; baseline ${m.baseline} ${units}.${missing ? ` ${missing} hours have no value.` : ''}`
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {/* Band behind the bars marks the replay's current hour. */}
        {m.hourly.map((h, i) => h.hour_cst === selectedHour && (
          <rect key="sel" x={2 + i * bw - 1} y={0} width={bw + 2} height={H - pad} className="spark-selected" />
        ))}
        {m.hourly.map((h, i) => {
          const x = 2 + i * bw
          if (h.value === null) {
            return <text key={h.hour_cst} x={x + bw / 2} y={H - pad - 2} className="spark-missing" textAnchor="middle">×</text>
          }
          const top = y(h.value)
          return (
            <rect key={h.hour_cst} x={x + 1} y={top} width={bw - 2} height={Math.max(H - pad - top, 1)}
              style={{ animationDelay: `${i * 22}ms` }}
              className={h.hour_cst === highlightHour ? 'spark-bar spark-peak' : 'spark-bar'} />
          )
        })}
        <line x1="0" x2={W} y1={y(m.baseline)} y2={y(m.baseline)} className="spark-baseline" />
        <text x="2" y={H - 2} className="spark-axis">00</text>
        <text x={W / 2} y={H - 2} className="spark-axis" textAnchor="middle">12</text>
        <text x={W - 2} y={H - 2} className="spark-axis" textAnchor="end">23 h CST</text>
      </svg>
      <figcaption>
        <span className="key key-bar" aria-hidden="true" /> hourly {units}{' '}
        <span className="key key-base" aria-hidden="true" /> baseline{' '}
        <span className="key key-sel" aria-hidden="true" /> replay hour{missing ? ' · × no value' : ''}
      </figcaption>
      <details className="hourly-table">
        <summary>Show all 24 hourly values</summary>
        <table>
          <thead><tr><th scope="col">Hour (CST)</th><th scope="col">{units}</th><th scope="col">Flag</th></tr></thead>
          <tbody>
            {m.hourly.map((h) => (
              <tr key={h.hour_cst} className={h.hour_cst === highlightHour ? 'is-peak' : undefined}>
                <td>{hourLabel(h.hour_cst)}</td>
                <td>{h.value ?? 'no value'}</td>
                <td>{h.flag ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

const decimals = (v: number) => (String(v).split('.')[1] ?? '').length

export function Detect({ ev, hour }: { ev: PlumeEvent; hour: number }) {
  const d = ev.detection
  const m = ev.monitors.find((x) => x.site_id === d.site_id) as Monitor
  const u = ev.compound.units
  const others = ev.monitors.filter((x) => x.triggered && x.site_id !== d.site_id)
  return (
    <>
      <p className="lead">A state monitor recorded a {ev.compound.name} reading far above its usual level.</p>
      <div className="spike-hero">
        <span className="spike-eyebrow">Peak reading · <span className="num">{hourLabel(d.hour_cst)}, {ev.date_local}</span></span>
        <span className="spike-value">
          <CountUp from={d.baseline} to={d.value} format={(n) => n.toFixed(decimals(d.value))} className="num" />
          <span className="spike-unit">{u}</span>
        </span>
        {d.baseline > 0 && (
          <span className="spike-ratio">
            About <strong className="num">{Math.round(d.value / d.baseline)}×</strong> its usual <span className="num">{d.baseline} {u}</span>
          </span>
        )}
      </div>
      <dl className="facts">
        <div><dt>Monitor</dt><dd>{m.name} <span className="muted num">({m.site_id})</span></dd></div>
        <div><dt>Usual level (baseline)</dt><dd className="num">{d.baseline} {u}</dd></div>
        <div><dt>Rule used</dt><dd><code>{d.rule}</code></dd></div>
      </dl>
      <Sparkline m={m} units={u} highlightHour={d.hour_cst} selectedHour={hour} />
      {others.length > 0 && (
        <p className="muted small">Also flagged that day: {others.map((o) => `${o.name} (highest ${o.peak.value} ${u} at ${hourLabel(o.peak.hour_cst)})`).join('; ')}.</p>
      )}
      <p className="muted small">{ev.time_note}</p>
      <Rose siteId={m.site_id} param={ev.compound.aqs_param} />
    </>
  )
}

interface TraceProps {
  ev: PlumeEvent
  corridor: Facility[]
  outside: Facility[]
  onHighlight: (id: string | null) => void
  place: Place | null
  onPlace: (p: Place | null) => void
  /** Empty-state action: go on to the record check, which searches the whole county either way. */
  onCheck?: () => void
}

export function Trace({ ev, corridor, outside, onHighlight, place, onPlace, onCheck }: TraceProps) {
  const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)
  const matched = ev.record_check.matched_facility_id
  const windSite = ev.monitors.find((m) => m.site_id === ev.wind.site_id)?.name ?? ev.wind.site_id
  // One tab stop for the whole list (roving tabindex): 40 facilities were 40 Tab presses before "Next".
  const [current, setCurrent] = useState(0)
  const items = useRef<(HTMLLIElement | null)[]>([])
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const last = corridor.length - 1
    const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: last }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    items.current[Math.max(0, Math.min(last, next))]?.focus()
  }
  return (
    <>
      <p className="lead">
        {wind
          ? <>At {hourLabel(wind.hour_cst)} the wind at {windSite} came from the {compass(wind.from_deg)} ({wind.from_deg}°) at {wind.speed_mph} mph. These facilities sit in that upwind direction, nearest first.</>
          : <>No wind reading for {hourLabel(ev.detection.hour_cst)}. Facilities are listed nearest first.</>}
      </p>
      <p className="caveat"><InfoIcon />Wind direction alone can't tell these apart.</p>
      <PlaceSearch ev={ev} place={place} onPlace={onPlace} />
      <h3 className="list-heading">In the upwind corridor <span className="num">({corridor.length})</span></h3>
      <p className="muted small">
        Point at a facility to find it on the map.
        <span className="sr-only"> With a keyboard, Tab into the list and use the arrow keys.</span>
        {corridor.length > 0 && <> Locations: {corridor[0].source}.</>}
      </p>
      {corridor.length === 0 ? (
        <div className="empty">
          <h4>No facilities in the upwind corridor</h4>
          <p>No major permitted facility sits within the corridor's distance and angle for this hour's wind. The record check still searches every report filed that day in the county.</p>
          {onCheck && <button type="button" className="btn btn-primary" onClick={onCheck}>Check the state record</button>}
        </div>
      ) : (
        <ol className="facility-list" onKeyDown={onListKey}>
          {corridor.map((f, i) => (
            // Key on id + rank: the pipeline can emit the same facility id twice.
            <li
              key={`${f.id}-${f.rank}`}
              className={f.id === matched ? 'is-matched' : undefined}
              {...(f.id === matched ? spotlight : {})}
              ref={(el) => { items.current[i] = el }}
              tabIndex={i === Math.min(current, corridor.length - 1) ? 0 : -1}
              onMouseEnter={() => onHighlight(f.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => { setCurrent(i); onHighlight(f.id) }}
              onBlur={() => onHighlight(null)}
            >
              <span className="fl-name">{f.name}</span>
              {f.id === matched && ev.record_check.incident && <span className="filed-tag">Filed report #{ev.record_check.incident}</span>}
              <span className="fl-geo"><span className="num">{f.distance_km} km</span> away · bearing <span className="num">{f.bearing_deg}°</span> ({compass(f.bearing_deg)})</span>
              <span className="fl-align">
                <span className="align-label">Wind alignment <span className="num">{f.alignment}</span></span>
                <span className="align-track" aria-hidden="true"><span className="align-fill" style={{ width: `${Math.max(0, Math.min(1, f.alignment)) * 100}%` }} /></span>
              </span>
              {f.source !== corridor[0].source && <span className="fl-source">Location source: {f.source}</span>}
            </li>
          ))}
        </ol>
      )}
      {outside.length > 0 && (
        <details className="outside">
          <summary>Nearby, outside the corridor ({outside.length})</summary>
          <ul>{outside.map((f) => <li key={`${f.id}-${f.rank}`}>{f.name} · {f.distance_km} km · bearing {f.bearing_deg}°</li>)}</ul>
        </details>
      )}
    </>
  )
}

export function Check({ ev }: { ev: PlumeEvent }) {
  const rc = ev.record_check
  const url = safeHttpUrl(rc.source_url)
  const matched = ev.facilities.find((f) => f.id === rc.matched_facility_id)
  const r = rc.reported
  return (
    <>
      <h3 className="question">Did any facility in the corridor file a matching report?</h3>
      <div className="status-block">
        <StatusBadge status={rc.status} />
        <p className="muted small">{rc.search_scope}</p>
      </div>
      {matched && (
        <p className="is-matched-note">
          <strong>{matched.name}</strong>{rc.incident ? <> · Filed report <span className="num">#{rc.incident}</span></> : null}
        </p>
      )}
      <h3 className="list-heading">Checks over time</h3>
      {rc.checks.length === 0 ? (
        <div className="empty">
          <h4>No checks recorded yet</h4>
          <p>This file has no 24-hour or 14-day check. Re-run the pipeline after the deadline passes, or open the state record to look yourself.</p>
        </div>
      ) : (
        <ul className="checks">
          {rc.checks.map((c, i) => (
            <li key={c.at}><span className="check-at">{c.at}</span> <StatusBadge status={c.status} drawDelay={0.2 + i * 0.65} /></li>
          ))}
        </ul>
      )}
      {r && (
        <>
          <h3 className="list-heading">What the report says</h3>
          <dl className="facts">
            {r.compound && <div><dt>Compound</dt><dd>{r.compound}</dd></div>}
            {r.pounds != null && (
              <div><dt>Amount reported</dt><dd>
                <CountUp to={r.pounds} duration={1.4} className="num"
                  format={(n) => `${(Number.isInteger(r.pounds) ? Math.round(n) : n).toLocaleString('en-US', { maximumFractionDigits: 3 })} lb`} />
              </dd></div>
            )}
            {(r.start_local || r.end_local) && (
              <div><dt>Time reported</dt><dd><span className="num">{localTime(r.start_local)}</span> to <span className="num">{localTime(r.end_local)}</span>{r.tz ? ` ${r.tz}` : ''}</dd></div>
            )}
            {r.cause && <div><dt>Cause given</dt><dd>{r.cause}</dd></div>}
          </dl>
        </>
      )}
      {rc.day_incidents && rc.day_incidents.length > 0 && <DayIncidents items={rc.day_incidents} />}
      {url
        ? <p><a className="record-link" href={url} target="_blank" rel="noopener noreferrer">Open the state record<span className="sr-only"> (opens in a new tab)</span></a></p>
        : <p className="muted">No valid link to the state record in this file.</p>}
    </>
  )
}

function DayIncidents({ items }: { items: DayIncident[] }) {
  return (
    <>
      <h3 className="list-heading">Other reports filed that day <span className="num">({items.length})</span></h3>
      <ul className="day-incidents">
        {items.map((d) => (
          <li key={d.incident} className={d.in_corridor ? 'in-corridor' : undefined}>
            <span className="di-entity">{d.entity}</span>
            {/* Corridor membership is stated in words; the border colour only repeats it. */}
            <span className={d.in_corridor ? 'di-tag di-in' : 'di-tag'}>
              {d.in_corridor ? 'In the upwind corridor' : 'Not in the corridor'}
            </span>
            <span className="di-facts">
              {[d.compound, d.pounds != null ? `${d.pounds.toLocaleString('en-US')} lb` : null, d.start_local ? `started ${localTime(d.start_local)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="muted small">Report <span className="num">#{d.incident}</span>: {d.resolution}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

const localTime = (t?: string) => (t ? t.replace('T', ' ') : 'not given')

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish' }
const SPEECH_LANG: Record<Lang, string> = { en: 'en-US', es: 'es-US' }

// The draft types itself in once per draft (language and source) per page load; after that it is the reader's text.
const typedOnce = new Set<string>()

function DraftField({ typeKey, lang, value, isEmpty, approved, onEdit, onTyping }: {
  typeKey: string
  lang: Lang
  value: string
  isEmpty: boolean
  approved: boolean
  onEdit: (v: string) => void
  onTyping: (typing: boolean) => void
}) {
  const [run] = useState(() => !typedOnce.has(typeKey))
  const { shown, typing, skip } = useTypewriter(value, run)
  useEffect(() => {
    typedOnce.add(typeKey)
  }, [typeKey])
  useEffect(() => {
    onTyping(typing)
  }, [typing, onTyping])
  return (
    <>
      <label className="draft-label" htmlFor="draft">
        Draft ({LANG_NAME[lang]}){approved ? <span className="approved-tag"> · approved</span> : ''}
      </label>
      <div className={typing ? 'draft-wrap is-typing' : 'draft-wrap'}>
        <textarea
          id="draft"
          className="draft"
          lang={lang}
          rows={9}
          value={shown}
          readOnly={typing}
          aria-busy={typing}
          aria-invalid={!typing && isEmpty}
          aria-describedby={!typing && isEmpty ? 'draft-error draft-meta' : 'draft-meta'}
          // Any move to read or edit ends the typing at once; nothing the reader types is ever overwritten.
          onFocus={skip}
          onPointerDown={skip}
          onKeyDown={typing ? skip : undefined}
          onChange={(e) => onEdit(e.target.value)}
        />
        {typing && <span className="draft-caret" aria-hidden="true" />}
      </div>
    </>
  )
}

/** Rubber segment: the thumb slides with a little overshoot and squish; the buttons keep aria-pressed. */
function RubberSegment<T extends string>({ labelledBy, value, options, onChange }: {
  labelledBy: string
  value: T
  options: { value: T; label: ReactNode; lang?: string }[]
  onChange: (v: T) => void
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className="seg" role="group" aria-labelledby={labelledBy}>
      <span className="seg-thumb" aria-hidden="true" style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)` }}>
        <span key={value} className="seg-squish" />
      </span>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} lang={o.lang}>{o.label}</button>
      ))}
    </div>
  )
}

interface PacketProps {
  ev: PlumeEvent
  ai: AiDraft | null
  review: PacketReview
  setReview: Dispatch<SetStateAction<PacketReview>>
}

export function Packet({ ev, ai, review, setReview }: PacketProps) {
  const { lang, source, drafts, approved } = review
  const [speaking, setSpeaking] = useState(false)
  const [typing, setTyping] = useState(false)
  // Screen-reader notice (every message) and the visible error line (errors only); successes show as a toast.
  const [notice, setNotice] = useState('')
  const [errorLine, setErrorLine] = useState('')
  const [toast, setToast] = useState<{ id: number; msg: string | null }>({ id: 0, msg: null })
  const dialog = useRef<HTMLDialogElement>(null)
  const doneBtn = useRef<HTMLButtonElement>(null)
  const focusDone = useRef(false)
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
  const guard = ev.packet.guard
  const sourceDrafts = source === 'ai' && ai ? { en: ai.draft_en, es: ai.draft_es } : { en: ev.packet.draft_en, es: ev.packet.draft_es }
  const original = sourceDrafts[lang]
  const isEmpty = drafts[lang].trim() === ''
  const isEdited = drafts[lang] !== original
  const say = (text: string, isError = false) => {
    setNotice(text)
    setErrorLine(isError ? text : '')
    if (!isError) setToast((t) => ({ id: t.id + 1, msg: text }))
  }
  const hideToast = useCallback(() => setToast((t) => ({ ...t, msg: null })), [])

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel() }, [canSpeak])
  // The hold button becomes the "Approved" button; keep keyboard focus on it.
  useEffect(() => {
    if (approved && focusDone.current) doneBtn.current?.focus()
    focusDone.current = false
  }, [approved])

  const stopSpeech = () => {
    if (canSpeak) window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  // Product rule: a person approves the exact text they file, so approval belongs to one language's draft.
  const switchLang = (l: Lang) => {
    if (l === lang) return
    stopSpeech()
    if (approved) say(`Switched to ${LANG_NAME[l]}. Review and approve the ${LANG_NAME[l]} draft before filing.`)
    setReview((r) => ({ ...r, lang: l, approved: false }))
  }

  // Same rule as switching language: approval covers the exact text read, so a new source needs a new approval.
  const switchSource = (s: Source) => {
    if (s === source || (s === 'ai' && !ai)) return
    stopSpeech()
    const next = s === 'ai' && ai ? { en: ai.draft_en, es: ai.draft_es } : { en: ev.packet.draft_en, es: ev.packet.draft_es }
    say(s === 'ai' ? 'Showing the AI draft. Every number in it was checked against the data. Review it before approving.'
      : 'Showing the template draft.')
    setReview((r) => ({ ...r, source: s, drafts: next, approved: false }))
  }

  const readAloud = () => {
    if (!canSpeak) return
    if (speaking) return stopSpeech()
    const u = new SpeechSynthesisUtterance(drafts[lang])
    u.lang = SPEECH_LANG[lang]
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang))
    if (voice) u.voice = voice
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    setSpeaking(true)
  }

  const copy = async () => {
    if (isEmpty) return say('Nothing to copy: the draft is empty.', true)
    try {
      await navigator.clipboard.writeText(drafts[lang])
      say('Draft copied.')
    } catch {
      say('Copy failed. Select the text and copy it by hand.', true)
    }
  }

  const restore = () => {
    stopSpeech()
    // Same rule as an edit: the restored text is new text to the reader, so approval starts over.
    say(approved ? 'Original draft restored. Approve it again before filing.' : 'Original draft restored.')
    setReview((r) => ({ ...r, drafts: { ...r.drafts, [lang]: original }, approved: false }))
  }

  return (
    <>
      <p className="lead">A draft for a person to read, edit and file. Nothing is sent from this app.</p>
      <div className="controls">
        {ai && (
          <div className="control">
            <span className="control-label" id="src-label">Who wrote the draft</span>
            <RubberSegment<Source> labelledBy="src-label" value={source} onChange={switchSource} options={[
              { value: 'template', label: <>Template <span className="seg-sub">(no AI)</span></> },
              { value: 'ai', label: <>AI draft <span className="seg-sub">({ai.provider}, number-checked)</span></> },
            ]} />
          </div>
        )}
        <div className="control">
          <span className="control-label" id="lang-label">Draft language</span>
          <RubberSegment<Lang> labelledBy="lang-label" value={lang} onChange={switchLang} options={[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Español', lang: 'es' },
          ]} />
        </div>
      </div>
      <div className="draft-field">
        <DraftField
          key={`${source}-${lang}`}
          typeKey={`${source}-${lang}`}
          lang={lang}
          value={drafts[lang]}
          isEmpty={isEmpty}
          approved={approved}
          onTyping={setTyping}
          onEdit={(value) => {
            // Approval covers the exact text a person read; any edit needs a fresh approval.
            // Said aloud too: otherwise a screen reader user typing here never learns File was disabled.
            if (approved) say('Draft edited. Approve it again before filing.')
            setReview((r) => ({ ...r, drafts: { ...r.drafts, [lang]: value }, approved: false }))
          }}
        />
        {!typing && isEmpty && (
          <p id="draft-error" className="field-error">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="8" cy="8" r="6.5" /><path d="M8 4.8v3.6" /><circle cx="8" cy="11.1" r=".5" fill="currentColor" />
            </svg>
            The draft is empty. Write the summary, or restore the original, before approving it.
          </p>
        )}
        <p id="draft-meta" className="draft-meta provenance">
          <span>
            {source === 'ai' && ai ? (
              <>Drafted by {ai.provider} ({ai.model}), generated once on {ai.generated_local} from this event's facts; it has
                drafted {ai.runs_on_this_event} real event so far. Number check: passed (every number, id and time matches the data).</>
            ) : (
              <>Drafted by: {ev.packet.drafted_by ?? 'not stated in this file'}. Number check:{' '}
                {guard.passed ? 'passed' : `failed (${guard.rejected.join(', ') || 'no details'})`}.</>
            )}
          </span>
          {isEdited && <span>Edited</span>}
        </p>
      </div>
      <div className="row">
        {/* The label states the action, so no aria-pressed: a toggle whose label also flips reads backwards. */}
        <button type="button" className="btn" onClick={readAloud} disabled={!canSpeak}>
          {speaking ? 'Stop reading' : 'Read aloud'}
        </button>
        <button type="button" className="btn" onClick={copy}>Copy draft</button>
        {isEdited && <button type="button" className="btn" onClick={restore}>Restore original</button>}
      </div>
      {!canSpeak && <p className="muted small">Read aloud isn't available in this browser.</p>}
      <p className="sr-only" aria-live="polite">{notice}</p>
      {errorLine && <p className="notice is-error" aria-hidden="true">{errorLine}</p>}

      <h3 className="list-heading">Review and file</h3>
      <ol className="file-steps">
        <li>
          {approved ? (
            <button ref={doneBtn} type="button" className="btn btn-done" onClick={() => setReview((r) => ({ ...r, approved: false }))}>
              Approved (press to undo)
            </button>
          ) : (
            <HoldButton
              onComplete={() => { focusDone.current = true; setReview((r) => ({ ...r, approved: true })) }}
              disabled={isEmpty || typing}
              describedBy={isEmpty && !typing ? 'draft-error approve-hint' : 'approve-hint'}
            >
              Approve this draft
            </HoldButton>
          )}
          {!approved && (
            <p id="approve-hint" className="muted small">
              {typing ? 'The draft is still appearing.' : 'Press and hold to approve. With a keyboard, hold Space or Enter.'}
            </p>
          )}
        </li>
        <li>
          <button type="button" className="btn btn-primary" disabled={!approved} aria-describedby="file-hint" onClick={() => dialog.current?.showModal()}>
            File with regulator (you submit)
          </button>
          <p id="file-hint" className="muted small">{approved ? 'Opens instructions. Nothing is sent.' : 'Approve the draft first.'}</p>
        </li>
      </ol>

      <dialog ref={dialog} className="dialog" aria-labelledby="dlg-title">
        <h2 id="dlg-title">You file this yourself</h2>
        <p>You approved the <strong>{LANG_NAME[lang]}</strong> draft. That is the text to file.</p>
        <p>Plume Witness does not send anything to the regulator or anyone else.</p>
        <p>To file, copy the approved draft and submit it yourself through the state regulator's own complaint process, with the record link from the Check step.</p>
        <form method="dialog"><button className="btn btn-primary" autoFocus>Got it</button></form>
      </dialog>
      <SwipeToast id={toast.id} message={toast.msg} onDone={hideToast} />
    </>
  )
}
