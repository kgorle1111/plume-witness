import { useEffect, useRef, useState } from 'react'
import type { DayIncident, Facility, Monitor, PlumeEvent } from './types'
import { compass, hourLabel, readingText, safeHttpUrl, statusInfo } from './format'

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

export function StatusBadge({ status }: { status: string }) {
  const info = statusInfo(status)
  return (
    <span className={`status status-${status}`}>
      <StatusIcon kind={info.icon} />
      <span>{info.en}</span>
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
        <div><dt>Reading</dt><dd><strong>{d.value} {u}</strong> at {hourLabel(d.hour_cst)}, {ev.date_local}</dd></div>
        <div><dt>Usual level (baseline)</dt><dd>{d.baseline} {u}</dd></div>
        <div><dt>Rule used</dt><dd><code>{d.rule}</code></dd></div>
      </dl>
      <Sparkline m={m} units={u} highlightHour={d.hour_cst} selectedHour={hour} />
      <p className="small">
        Replay hour {hourLabel(hour)}: <strong>{atHour ? readingText(atHour.value, atHour.flag, u) : 'no data'}</strong>
      </p>
      {others.length > 0 && (
        <p className="muted small">Also flagged that day: {others.map((o) => `${o.name} (highest ${o.peak.value} ${u} at ${hourLabel(o.peak.hour_cst)})`).join('; ')}.</p>
      )}
      <p className="muted small">{ev.time_note}</p>
    </>
  )
}

interface TraceProps {
  ev: PlumeEvent
  corridor: Facility[]
  outside: Facility[]
  onHighlight: (id: string | null) => void
}

export function Trace({ ev, corridor, outside, onHighlight }: TraceProps) {
  const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)
  const matched = ev.record_check.matched_facility_id
  const windSite = ev.monitors.find((m) => m.site_id === ev.wind.site_id)?.name ?? ev.wind.site_id
  return (
    <>
      <p className="lead">
        {wind
          ? <>At {hourLabel(wind.hour_cst)} the wind at {windSite} came from the {compass(wind.from_deg)} ({wind.from_deg}°) at {wind.speed_mph} mph. These facilities sit in that upwind direction, nearest first.</>
          : <>No wind reading for {hourLabel(ev.detection.hour_cst)}. Facilities are listed nearest first.</>}
      </p>
      <p className="caveat">Wind direction alone can't tell these apart.</p>
      <h3 className="list-heading">In the upwind corridor ({corridor.length})</h3>
      <p className="muted small">Hover or focus a facility to show its name on the map. On the map, tap or point at a dot.</p>
      {corridor.length === 0 ? <p>No facilities in the corridor.</p> : (
        <ol className="facility-list">
          {corridor.map((f) => (
            // Key on id + rank: the pipeline can emit the same facility id twice.
            <li
              key={`${f.id}-${f.rank}`}
              className={f.id === matched ? 'is-matched' : undefined}
              tabIndex={0}
              onMouseEnter={() => onHighlight(f.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(f.id)}
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
          <strong>{matched.name}</strong>{rc.incident ? <> · Filed report #{rc.incident}</> : null}
        </p>
      )}
      <h3 className="list-heading">Checks over time</h3>
      <ul className="checks">
        {rc.checks.map((c) => (
          <li key={c.at}><span className="check-at">{c.at}</span> <StatusBadge status={c.status} /></li>
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
          </dl>
        </>
      )}
      {rc.day_incidents && rc.day_incidents.length > 0 && <DayIncidents items={rc.day_incidents} />}
      {url
        ? <p><a href={url} target="_blank" rel="noopener noreferrer">Open the state record<span className="sr-only"> (opens in a new tab)</span></a></p>
        : <p className="muted">No valid link to the state record in this file.</p>}
    </>
  )
}

function DayIncidents({ items }: { items: DayIncident[] }) {
  return (
    <>
      <h3 className="list-heading">Other reports filed that day ({items.length})</h3>
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
            <span className="muted small">Report #{d.incident}: {d.resolution}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

const localTime = (t?: string) => (t ? t.replace('T', ' ') : 'not given')

type Lang = 'en' | 'es'
const SPEECH_LANG: Record<Lang, string> = { en: 'en-US', es: 'es-US' }

export function Packet({ ev }: { ev: PlumeEvent }) {
  const [lang, setLang] = useState<Lang>('en')
  const [drafts, setDrafts] = useState({ en: ev.packet.draft_en, es: ev.packet.draft_es })
  const [approved, setApproved] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
  const guard = ev.packet.guard

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel() }, [canSpeak])

  const stopSpeech = () => {
    if (canSpeak) window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const switchLang = (l: Lang) => {
    stopSpeech()
    setLang(l)
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
    try {
      await navigator.clipboard.writeText(drafts[lang])
      setNotice('Draft copied.')
    } catch {
      setNotice('Copy failed. Select the text and copy it by hand.')
    }
  }

  return (
    <>
      <p className="lead">A draft for a person to read, edit and file. Nothing is sent from this app.</p>
      <div className="lang-toggle" role="group" aria-label="Draft language">
        <button type="button" aria-pressed={lang === 'en'} onClick={() => switchLang('en')}>English</button>
        <button type="button" aria-pressed={lang === 'es'} onClick={() => switchLang('es')} lang="es">Español</button>
      </div>
      <label className="draft-label" htmlFor="draft">Draft ({lang === 'en' ? 'English' : 'Spanish'}){approved ? ' · approved' : ''}</label>
      <textarea
        id="draft"
        className="draft"
        lang={lang}
        rows={6}
        value={drafts[lang]}
        onChange={(e) => {
          setDrafts((d) => ({ ...d, [lang]: e.target.value }))
          // Approval covers the exact text a person read; any edit needs a fresh approval.
          setApproved(false)
        }}
      />
      <p className="muted small">
        Drafted by: {ev.packet.drafted_by ?? 'not stated in this file'}. Number check:{' '}
        {guard.passed ? 'passed' : `failed (${guard.rejected.join(', ') || 'no details'})`}.
      </p>
      <div className="row">
        <button type="button" className="btn" onClick={readAloud} disabled={!canSpeak} aria-pressed={speaking}>
          {speaking ? 'Stop reading' : 'Read aloud'}
        </button>
        <button type="button" className="btn" onClick={copy}>Copy draft</button>
      </div>
      {!canSpeak && <p className="muted small">Read aloud isn't available in this browser.</p>}
      <p className="sr-only" aria-live="polite">{notice}</p>
      {notice && <p className="muted small" aria-hidden="true">{notice}</p>}

      <h3 className="list-heading">Review and file</h3>
      <ol className="file-steps">
        <li>
          <button type="button" className={approved ? 'btn btn-done' : 'btn btn-primary'} aria-pressed={approved} onClick={() => setApproved((a) => !a)}>
            {approved ? 'Approved (press to undo)' : 'Approve this draft'}
          </button>
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
        <p>Plume Witness does not send anything to the regulator or anyone else.</p>
        <p>To file, copy the approved draft and submit it yourself through the state regulator's own complaint process, with the record link from the Check step.</p>
        <form method="dialog"><button className="btn btn-primary" autoFocus>Got it</button></form>
      </dialog>
    </>
  )
}
