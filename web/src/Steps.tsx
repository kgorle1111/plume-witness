import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { type AiDraft, type DayIncident, type Facility, type Monitor, type PlumeEvent, type RecordCheck } from './types'
import { compass, hourLabel, readingText, safeHttpUrl, statusInfo } from './format'
import { incidentNote } from './note'
import { arrivalTick, daysAfterEvent, reportBand } from './reportWindow'
import type { Lang, PacketReview, Source } from './packet'
import { PlaceSearch, type Place } from './PlaceSearch'
import { Rose } from './Rose'
import { useRecordedClip } from './recorded'

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

export function StatusBadge({ status, lang = 'en' }: { status: string; lang?: Lang }) {
  const info = statusInfo(status)
  return (
    <span className={`status status-${status}`} lang={lang}>
      <StatusIcon kind={info.icon} />
      <span>{info[lang]}</span>
    </span>
  )
}

function Sparkline({ m, units, highlightHour, selectedHour, rc, eventDay }: { m: Monitor; units: string; highlightHour: number; selectedHour: number; rc: RecordCheck; eventDay: string }) {
  const W = 288, H = 96, pad = 14
  const values = m.hourly.map((h) => h.value ?? 0)
  const max = Math.max(...values, m.baseline) || 1
  const bw = (W - 4) / 24
  const y = (v: number) => H - pad - (v / max) * (H - pad - 6)
  const missing = m.hourly.filter((h) => h.value === null).length
  const band = reportBand(rc, eventDay)
  const tick = band ? arrivalTick(rc, eventDay) : null
  const bandLabel = band && (band.matched ? 'Company-reported release window (its own report)' : 'Report lists other compounds')
  const bandText = band
    ? ` Shaded band: ${band.matched ? 'the company-reported release window, from its own report' : 'a report that lists other compounds, drawn dashed'}, ${band.localText}${band.cstText ? ` (${band.cstText})` : ''}${band.startsBefore ? '; it began before this day' : ''}${band.endsAfter ? '; it continues past this day' : ''}.${tick ? ` Marker: ${tick.text}.` : ''}`
    : ''
  const summary = `24 hourly readings at ${m.name}. Highest ${m.peak.value} ${units} at ${hourLabel(m.peak.hour_cst)}; baseline ${m.baseline} ${units}.${missing ? ` ${missing} hours have no value.` : ''}${bandText}`
  const bx = (h: number) => 2 + h * bw
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {/* Band behind the bars marks the replay's current hour. */}
        {m.hourly.map((h, i) => h.hour_cst === selectedHour && (
          <rect key="sel" x={2 + i * bw - 1} y={0} width={bw + 2} height={H - pad} className="spark-selected" />
        ))}
        {band && (
          <g className={band.matched ? 'spark-report' : 'spark-report is-mismatch'}>
            <rect x={bx(band.from)} y={0} width={Math.max(bx(band.to) - bx(band.from), 2)} height={H - pad} className="spark-report-fill" />
            <line x1={bx(band.from)} x2={bx(band.to)} y1={1.5} y2={1.5} className="spark-report-cap" />
            {!band.startsBefore && <line x1={bx(band.from)} x2={bx(band.from)} y1={0} y2={H - pad} className="spark-report-edge" />}
            {!band.endsAfter && <line x1={bx(band.to)} x2={bx(band.to)} y1={0} y2={H - pad} className="spark-report-edge" />}
          </g>
        )}
        {m.hourly.map((h, i) => {
          const x = 2 + i * bw
          if (h.value === null) {
            return <text key={h.hour_cst} x={x + bw / 2} y={H - pad - 2} className="spark-missing" textAnchor="middle">×</text>
          }
          const top = y(h.value)
          return (
            <rect key={h.hour_cst} x={x + 1} y={top} width={bw - 2} height={Math.max(H - pad - top, 1)}
              className={h.hour_cst === highlightHour ? 'spark-bar spark-peak' : 'spark-bar'} />
          )
        })}
        <line x1="0" x2={W} y1={y(m.baseline)} y2={y(m.baseline)} className="spark-baseline" />
        {tick && (
          <path d={`M${bx(tick.hourCst) - 4} ${H - pad + 1}h8l-4 -7z`} className="spark-arrival" />
        )}
        <text x="2" y={H - 2} className="spark-axis">00</text>
        <text x={W / 2} y={H - 2} className="spark-axis" textAnchor="middle">12</text>
        <text x={W - 2} y={H - 2} className="spark-axis" textAnchor="end">23 h CST</text>
      </svg>
      <figcaption>
        <span className="key key-bar" aria-hidden="true" /> hourly {units}{' '}
        <span className="key key-base" aria-hidden="true" /> baseline{' '}
        <span className="key key-sel" aria-hidden="true" /> replay hour{missing ? ' · × no value' : ''}
      </figcaption>
      {band && (
        <p className="spark-note small">
          <span className={band.matched ? 'key key-report' : 'key key-report is-mismatch'} aria-hidden="true" /> <strong>{bandLabel}:</strong> {band.localText}{band.cstText ? <> (= {band.cstText}, the clock this chart uses)</> : ''}{band.startsBefore || band.endsAfter ? '; the band covers the part inside this day' : ''}.
          {tick && <> <span className="key-arrival" aria-hidden="true">▲</span> {tick.text[0].toUpperCase() + tick.text.slice(1)}.</>}
        </p>
      )}
      {rc.status === 'no_report_after_deadline' && <p className="spark-note muted small">No matching report in a complete search.</p>}
      <details className="hourly-table">
        <summary>Show all 24 hourly values</summary>
        <table>
          <thead><tr><th scope="col">Hour (CST)</th><th scope="col">{units}</th><th scope="col">Flag</th></tr></thead>
          <tbody>
            {m.hourly.map((h) => (
              <tr key={h.hour_cst}>
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

export function Detect({ ev, hour }: { ev: PlumeEvent; hour: number }) {
  const d = ev.detection
  const m = ev.monitors.find((x) => x.site_id === d.site_id) as Monitor
  const u = ev.compound.units
  const others = ev.monitors.filter((x) => x.triggered && x.site_id !== d.site_id)
  const atHour = m.hourly.find((x) => x.hour_cst === hour)
  return (
    <>
      <p className="lead">A state monitor recorded a {ev.compound.name} reading far above its usual level.</p>
      <dl className="facts">
        <div><dt>Monitor</dt><dd>{m.name} <span className="muted">({m.site_id})</span></dd></div>
        <div className="fact-key">
          <dt>Reading</dt>
          <dd><strong className="reading-value">{d.value} {u}</strong> <span className="reading-when">at {hourLabel(d.hour_cst)}, <span className="nowrap">{ev.date_local}</span></span></dd>
        </div>
        <div><dt>Usual level (baseline)</dt><dd>{d.baseline} {u}</dd></div>
        <div><dt>Rule used</dt><dd><code>{d.rule}</code></dd></div>
      </dl>
      <Sparkline m={m} units={u} highlightHour={d.hour_cst} selectedHour={hour} rc={ev.record_check} eventDay={ev.date_local} />
      <p className="small">
        Replay hour {hourLabel(hour)}: <strong>{atHour ? readingText(atHour.value, atHour.flag, u) : 'no data'}</strong>
      </p>
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
}

export function Trace({ ev, corridor, outside, onHighlight, place, onPlace }: TraceProps) {
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
      <h3 className="list-heading">In the upwind corridor ({corridor.length})</h3>
      <p className="muted small">Hover or focus a facility to show its name on the map; with a keyboard, Tab into the list and use the arrow keys. On the map, tap or point at a dot.</p>
      {corridor.length === 0 ? <p>No facilities in the corridor.</p> : (
        <ol className="facility-list" onKeyDown={onListKey}>
          {corridor.map((f, i) => (
            // Key on id + rank: the pipeline can emit the same facility id twice.
            <li
              key={`${f.id}-${f.rank}`}
              className={f.id === matched ? 'is-matched' : undefined}
              ref={(el) => { items.current[i] = el }}
              tabIndex={i === Math.min(current, corridor.length - 1) ? 0 : -1}
              onMouseEnter={() => onHighlight(f.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => { setCurrent(i); onHighlight(f.id) }}
              onBlur={() => onHighlight(null)}
            >
              <span className="fl-name">{f.name}</span>
              {f.id === matched && ev.record_check.incident && <span className="filed-tag">Filed report #{ev.record_check.incident}</span>}
              <span className="fl-geo">{f.distance_km} km away · bearing {f.bearing_deg}° ({compass(f.bearing_deg)})</span>
              <span className="fl-align">
                <span className="align-label">Wind alignment {f.alignment}</span>
                <span className="align-track" aria-hidden="true"><span className="align-fill" style={{ width: `${Math.max(0, Math.min(1, f.alignment)) * 100}%` }} /></span>
              </span>
              <span className="muted small">Location source: {f.source}</span>
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

export function Check({ ev, lang }: { ev: PlumeEvent; lang: Lang }) {
  const rc = ev.record_check
  const url = safeHttpUrl(rc.source_url)
  const matched = ev.facilities.find((f) => f.id === rc.matched_facility_id)
  const r = rc.reported
  return (
    <>
      <h3 className="question">Did any facility in the corridor file a matching report?</h3>
      <div className="status-block">
        <StatusBadge status={rc.status} lang={lang} />
        <p className="muted small">{rc.search_scope}</p>
      </div>
      {matched && (
        <p className="is-matched-note">
          <strong>{matched.name}</strong>{rc.incident ? <> · Filed report #{rc.incident}</> : null}
        </p>
      )}
      <h3 className="list-heading">Checks over time</h3>
      <ul className="checks">
        {rc.checks.map((c) => (
          <li key={c.at}><span className="check-at">{c.at}</span> <StatusBadge status={c.status} lang={lang} /></li>
        ))}
      </ul>
      {r && (
        <>
          <h3 className="list-heading">What the report says</h3>
          <dl className="facts">
            {r.compound && <div><dt>Compound</dt><dd>{r.compound}</dd></div>}
            {r.pounds != null && <div><dt>Amount reported</dt><dd>{r.pounds.toLocaleString('en-US')} lb</dd></div>}
            {(r.start_local || r.end_local) && (
              <div><dt>Time reported</dt><dd>{localTime(r.start_local)} to {localTime(r.end_local)}{r.tz ? ` ${r.tz}` : ''}</dd></div>
            )}
            {r.cause && <div><dt>Cause given</dt><dd>{r.cause}</dd></div>}
            {(r.revisions ?? []).map((v) => {
              const n = r.start_local ? daysAfterEvent(r.start_local, v.date) : null
              return (
                <div key={`${v.date}-${v.text}`}>
                  <dt>Report update</dt>
                  <dd>{n != null ? `Revised ${n} day${n === 1 ? '' : 's'} after the event` : `Revised ${v.date}`}: <q>{v.text}</q> <span className="muted">(company update dated {v.date}, quoted from the state record)</span></dd>
                </div>
              )
            })}
          </dl>
        </>
      )}
      {rc.day_incidents && rc.day_incidents.length > 0 && <DayIncidents items={rc.day_incidents} lang={lang} />}
      {url
        ? <p><a className="record-link" href={url} target="_blank" rel="noopener noreferrer">Open the state record<span className="sr-only"> (opens in a new tab)</span></a></p>
        : <p className="muted">No valid link to the state record in this file.</p>}
    </>
  )
}

// kn: Spanish not yet reviewed by a community reader, like the status labels.
const CORRIDOR_TAG = {
  in: { en: 'In the upwind corridor', es: 'En el corredor viento arriba' },
  out: { en: 'Not in the corridor', es: 'Fuera del corredor' },
  // A report that couldn't be placed is neither in nor out; "not in" read as a verdict on its location.
  unknown: { en: 'Location unknown', es: 'Ubicación desconocida' },
} as const

function DayIncidents({ items, lang }: { items: DayIncident[]; lang: Lang }) {
  return (
    <>
      <h3 className="list-heading">Other reports filed that day ({items.length})</h3>
      <ul className="day-incidents">
        {items.map((d) => (
          <li key={d.incident} className={d.in_corridor ? 'in-corridor' : undefined}>
            <span className="di-entity">{d.entity}</span>
            {/* Corridor membership is stated in words; the border colour only repeats it. */}
            <span className={d.in_corridor ? 'di-tag di-in' : 'di-tag'} lang={lang}>
              {CORRIDOR_TAG[d.in_corridor === true ? 'in' : d.in_corridor === false ? 'out' : 'unknown'][lang]}
            </span>
            <span className="di-facts">
              {[d.compound, d.pounds != null ? `${d.pounds.toLocaleString('en-US')} lb` : null, d.start_local ? `started ${localTime(d.start_local)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="muted small">Report #{d.incident}: {d.resolution}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

const localTime = (t?: string) => (t ? t.replace('T', ' ') : 'not given')

const LANG_NAME: Record<Lang, string> = { en: 'English', es: 'Spanish' }
const SPEECH_LANG: Record<Lang, string> = { en: 'en-US', es: 'es-US' }

interface PacketProps {
  ev: PlumeEvent
  ai: AiDraft | null
  review: PacketReview
  setReview: Dispatch<SetStateAction<PacketReview>>
}

export function Packet({ ev, ai, review, setReview }: PacketProps) {
  const { lang, source, drafts, approved } = review
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
  const clip = useRecordedClip(source, lang, drafts[lang])
  const audio = useRef<HTMLAudioElement>(null)
  const guard = ev.packet.guard

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel() }, [canSpeak])
  // The text, language or source changed under a playing recording: it no longer matches what is on screen.
  useEffect(() => () => { audio.current?.pause(); setSpeaking(false) }, [clip.url])

  const stopSpeech = () => {
    if (canSpeak) window.speechSynthesis.cancel()
    if (audio.current) { audio.current.pause(); audio.current.currentTime = 0 }
    setSpeaking(false)
  }

  // Product rule: a person approves the exact text they file, so approval belongs to one language's draft.
  const switchLang = (l: Lang) => {
    if (l === lang) return
    stopSpeech()
    if (approved) setNotice(`Switched to ${LANG_NAME[l]}. Review and approve the ${LANG_NAME[l]} draft before filing.`)
    setReview((r) => ({ ...r, lang: l, approved: false }))
  }

  // Same rule as switching language: approval covers the exact text read, so a new source needs a new approval.
  const switchSource = (s: Source) => {
    if (s === source || (s === 'ai' && !ai)) return
    stopSpeech()
    const next = s === 'ai' && ai ? { en: ai.draft_en, es: ai.draft_es } : { en: ev.packet.draft_en, es: ev.packet.draft_es }
    setNotice(s === 'ai' ? 'Showing the AI draft. Every number in it was checked against the data. Review it before approving.'
      : 'Showing the template draft.')
    setReview((r) => ({ ...r, source: s, drafts: next, approved: false }))
  }

  const readAloud = () => {
    if (speaking) return stopSpeech()
    if (clip.url && audio.current) {
      audio.current.play().then(() => setSpeaking(true), () => setNotice('The recording would not play. Check the sound and try again.'))
      return
    }
    if (!canSpeak) return
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

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(done)
    } catch {
      setNotice('Copy failed. Select the text and copy it by hand.')
    }
  }

  return (
    <>
      <p className="lead">A draft for a person to read, edit and file. Nothing is sent from this app.</p>
      <div className="controls">
        {ai && (
          <div className="control">
            <span className="control-label" id="src-label">Who wrote the draft</span>
            <div className="seg" role="group" aria-labelledby="src-label">
              <button type="button" aria-pressed={source === 'template'} onClick={() => switchSource('template')}>
                Template <span className="seg-sub">(no AI)</span>
              </button>
              <button type="button" aria-pressed={source === 'ai'} onClick={() => switchSource('ai')}>
                AI draft <span className="seg-sub">({ai.provider}, number-checked)</span>
              </button>
            </div>
          </div>
        )}
        <div className="control">
          <span className="control-label" id="lang-label">Draft language</span>
          <div className="seg" role="group" aria-labelledby="lang-label">
            <button type="button" aria-pressed={lang === 'en'} onClick={() => switchLang('en')}>English</button>
            <button type="button" aria-pressed={lang === 'es'} onClick={() => switchLang('es')} lang="es">Español</button>
          </div>
        </div>
      </div>
      <label className="draft-label" htmlFor="draft">
        Draft ({LANG_NAME[lang]}){approved ? <span className="approved-tag"> · approved</span> : ''}
      </label>
      <textarea
        id="draft"
        className="draft"
        lang={lang}
        rows={9}
        value={drafts[lang]}
        onChange={(e) => {
          const value = e.target.value
          // Approval covers the exact text a person read; any edit needs a fresh approval.
          // Said aloud too: otherwise a screen reader user typing here never learns File was disabled.
          if (approved) setNotice('Draft edited. Approve it again before filing.')
          setReview((r) => ({ ...r, drafts: { ...r.drafts, [lang]: value }, approved: false }))
        }}
      />
      <p className="muted small provenance">
        {source === 'ai' && ai ? (
          <>Drafted by {ai.provider} ({ai.model}), generated once on {ai.generated_local} from this event's facts; it has
            drafted {ai.runs_on_this_event} real event so far. Number check: passed (every number, id and time matches the data).</>
        ) : (
          <>Drafted by: {ev.packet.drafted_by ?? 'not stated in this file'}. Number check:{' '}
            {guard.passed ? 'passed' : `failed (${guard.rejected.join(', ') || 'no details'})`}.</>
        )}
      </p>
      <div className="row">
        {/* The label states the action, so no aria-pressed: a toggle whose label also flips reads backwards. */}
        <button type="button" className="btn" onClick={readAloud} disabled={!canSpeak && !clip.url}>
          {speaking ? 'Stop reading' : 'Read aloud'}
        </button>
        <button type="button" className="btn" onClick={() => copy(drafts[lang], 'Draft copied.')}>Copy draft</button>
        <button type="button" className="btn" onClick={() => copy(incidentNote(ev, `${location.origin}${location.pathname}`), 'Incident note copied. It is a draft for review, not a finding.')}>
          Copy as incident note
        </button>
      </div>
      {clip.url && <audio ref={audio} src={clip.url} preload="none" onEnded={() => setSpeaking(false)} onError={() => setSpeaking(false)} />}
      {!clip.url && clip.checked && canSpeak && <p className="muted small">Computer voice (this text has no recorded audio)</p>}
      {!canSpeak && !clip.url && <p className="muted small">Read aloud isn't available in this browser.</p>}
      <p className="sr-only" aria-live="polite">{notice}</p>
      {notice && <p className="muted small" aria-hidden="true">{notice}</p>}

      <h3 className="list-heading">Review and file</h3>
      <ol className="file-steps">
        <li>
          <span className="file-step-num" aria-hidden="true">1</span>
          <button type="button" className={approved ? 'btn btn-done' : 'btn btn-primary'} onClick={() => setReview((r) => ({ ...r, approved: !r.approved }))}>
            {approved ? 'Approved (press to undo)' : 'Approve this draft'}
          </button>
        </li>
        <li>
          <span className="file-step-num" aria-hidden="true">2</span>
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
    </>
  )
}
