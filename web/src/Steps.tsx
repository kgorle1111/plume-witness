import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type KeyboardEvent, type ReactNode, type SetStateAction } from 'react'
import { type AiDraft, type DayIncident, type Facility, type Monitor, type NrcReport, type PlumeEvent, type RecordCheck } from './types'
import { compass, hourLabel, hourShort, normCompound, offWindDeg, poundsText, readingText, safeHttpUrl, statusInfo, statusLabel, unitShort } from './format'
import { Unit } from './Unit'
import { StatusIcon } from './StatusIcon'
import { incidentNote, noteUrl } from './note'
import { facilityHref } from './facilities'
import { arrivalTick, calmMph, checkNoteText, daysAfterEvent, reportBand, resolutionText, searchScopeText, timeNote } from './reportWindow'
import { savePacketReview, useAiDraftFailed, type Lang, type PacketReview, type Source } from './packet'
import { PlaceSearch, type Place } from './PlaceSearch'
import { Rose } from './Rose'
import { setLang as setSiteLang, type StringKey, type Vars } from './i18n'
import { useLang, useT, type Translate } from './useT'
import { checkAt, ruleParts } from './plainWords'
import { compoundLabel, regionByKey } from './region'
import { shortlist } from './traceList'
import { useRecordedClip } from './recorded'
import './Steps.css'

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
      <span>{statusLabel(status, lang)}</span>
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
  const t = useT()
  const lang = useLang()
  const band = reportBand(rc, eventDay, lang)
  const tick = band ? arrivalTick(rc, eventDay, lang) : null
  const bandLabel = band && t(band.matched ? 'spark.bandMatched' : 'spark.bandOther')
  const bandText = band
    ? t('spark.ariaBand', {
      what: t(band.matched ? 'spark.ariaMatched' : 'spark.ariaOther'),
      when: `${band.localText}${band.cstText ? ` (${band.cstText})` : ''}`,
      extra: `${band.startsBefore ? t('spark.ariaBefore') : ''}${band.endsAfter ? t('spark.ariaAfter') : ''}`,
    }) + (tick ? t('spark.ariaMarker', { text: tick.text }) : '')
    : ''
  const u = unitShort(units)
  const summary = t('spark.summary', { name: m.name, peak: m.peak.value, unit: u, hour: hourLabel(m.peak.hour_cst), base: m.baseline })
    + (missing ? t('spark.missingHours', { n: missing }) : '') + bandText
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
        <span className="key key-bar" aria-hidden="true" /> {t('spark.keyHourly')} <Unit units={units} />{' '}
        <span className="key key-base" aria-hidden="true" /> {t('spark.keyBase')}{' '}
        <span className="key key-sel" aria-hidden="true" /> {t('spark.keyReplay')}{missing ? t('spark.keyMissing') : ''}
      </figcaption>
      {band && (
        <p className="spark-note small">
          <span className={band.matched ? 'key key-report' : 'key key-report is-mismatch'} aria-hidden="true" /> <strong>{bandLabel}:</strong> {band.localText}{band.cstText ? <> {t('spark.bandCst', { cst: band.cstText })}</> : ''}{band.startsBefore || band.endsAfter ? t('spark.bandClipped') : ''}.
          {tick && <> <span className="key-arrival" aria-hidden="true">▲</span> {tick.text[0].toUpperCase() + tick.text.slice(1)}.</>}
        </p>
      )}
      {rc.status === 'no_report_after_deadline' && <p className="spark-note muted small">{t('spark.noMatch')}</p>}
      <details className="hourly-table">
        <summary>{t('spark.showAll')}</summary>
        <table>
          <thead><tr><th scope="col">{t('spark.colHour')}</th><th scope="col"><Unit units={units} /></th><th scope="col">{t('spark.colFlag')}</th></tr></thead>
          <tbody>
            {m.hourly.map((h) => (
              <tr key={h.hour_cst}>
                <td>{hourShort(h.hour_cst)}</td>
                <td>{h.value ?? t('spark.noValue')}</td>
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
  const t = useT()
  const lang = useLang()
  const rule = ruleParts(d.rule)
  // Ten times a zero baseline is still zero: on those nights only the floor flagged the reading.
  const ruleKey = d.baseline === 0 ? 'det.ruleZero' : 'det.ruleText'
  const county = titleCase(regionByKey(ev.region?.key).county)
  const rc = ev.record_check
  const hasReport = Boolean(rc.reported) || (rc.day_incidents?.length ?? 0) > 0
  const note = timeNote(ev.time_note, lang, hasReport)
  return (
    <>
      <p className="lead">{t('det.lead', { compound: compoundLabel(lang, ev.compound.name) })}</p>
      <dl className="facts">
        <div><dt>{t('det.monitor')}</dt><dd>{m.name} <span className="muted small">({t('det.siteId', { id: m.site_id })})</span></dd></div>
        <div className="fact-key">
          <dt>{t('det.reading')}</dt>
          {/* The tip is also in the text: a title alone never reaches keyboard, touch or most screen-reader users. */}
          <dd><strong className="reading-value">{d.value}</strong> <Unit units={u} first /> <span className="reading-when">{t('det.atHour', { hour: hourLabel(d.hour_cst) })} <span className="nowrap">{ev.date_local}</span></span> <span className="prov-badge" title={t('prov.tip')}>{t('prov.badge')}<span className="sr-only">: {t('prov.tip')}</span></span></dd>
        </div>
        <div><dt>{t('det.baseline')}</dt><dd>{d.baseline} <Unit units={u} /></dd></div>
        <div>
          <dt>{t('det.rule')}</dt>
          <dd>{rule ? t(ruleKey, { ...rule, unit: unitShort(rule.unit) }) : <code>{d.rule}</code>}</dd>
        </div>
      </dl>
      <p className="small">{t('det.notAlert', { county })}</p>
      <Sparkline m={m} units={u} highlightHour={d.hour_cst} selectedHour={hour} rc={ev.record_check} eventDay={ev.date_local} />
      <p className="small">
        {t('det.replayHour', { hour: hourLabel(hour) })} <strong>{atHour ? readingText(atHour.value, atHour.flag, unitShort(u)) : t('tl.noData')}</strong>
      </p>
      {others.length > 0 && (
        <p className="muted small">{t('det.alsoFlagged', { list: others.map((o) => t('det.alsoItem', { name: o.name, value: o.peak.value, unit: unitShort(u), hour: hourLabel(o.peak.hour_cst) })).join('; ') })}</p>
      )}
      <p className="muted small" lang={note ? lang : 'en'}>{note ?? ev.time_note}</p>
      <Rose siteId={m.site_id} param={ev.compound.aqs_param} name={m.name} />
    </>
  )
}

/** regions.generated.json writes counties in capitals ("JEFFERSON"). */
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())

// Phones and tablets have no hover, so the Trace hint talks about taps there and about hover and Tab elsewhere.
const NO_HOVER = '(hover: none)'
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
const subscribeHover = (fn: () => void) => {
  if (!hasMatchMedia()) return () => {}
  const mq = window.matchMedia(NO_HOVER)
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
const useNoHover = () => useSyncExternalStore(subscribeHover, () => hasMatchMedia() && window.matchMedia(NO_HOVER).matches, () => false)

/** Facilities shown before "Show all": the nearest few keep "Next" within reach on a phone. */
const NEAREST = 5

// The pipeline's location-source label (build.py); another label is shown as written and marked English.
const SOURCE_KEY: Record<string, StringKey> = { 'EPA ECHO (major emissions source)': 'trc.sourceEcho' }
function sourceText(source: string, t: Translate): ReactNode {
  const k = SOURCE_KEY[source]
  return k ? t(k) : <span lang="en">{source}</span>
}

const reducedMotion = () => hasMatchMedia() && window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
  const calm = calmMph(ev.record_check)
  const narrowed = new Set(ev.triangulation?.verdict === 'narrows' ? ev.triangulation.intersection_ids : [])
  const t = useT()
  const lang = useLang()
  const noHover = useNoHover()
  // One tab stop for the whole list (roving tabindex): 40 facilities were 40 Tab presses before "Next".
  const [current, setCurrent] = useState(0)
  const items = useRef<(HTMLElement | null)[]>([])
  // 47 cards put "Next" about ten phone screens down; the filed-report facility stays in the short list.
  const [expanded, setExpanded] = useState(false)
  const short = shortlist(corridor.map((f) => f.id), matched, NEAREST)
  const folds = short.length < corridor.length
  const shown = expanded || !folds ? corridor.map((_, i) => i) : short
  const toggle = useRef<HTMLButtonElement>(null)
  // Set by the button only, so the first render neither moves focus nor scrolls.
  const afterToggle = useRef<'focus-new' | 'keep-button' | null>(null)
  useEffect(() => {
    const was = afterToggle.current
    afterToggle.current = null
    // Expanding moves focus to the first card that was hidden, so a keyboard or screen reader user lands on new content;
    // folding keeps focus on the button, which moved up with the shorter list.
    if (was === 'focus-new') items.current[corridor.findIndex((_, i) => !short.includes(i))]?.focus()
    if (was === 'keep-button') toggle.current?.scrollIntoView({ block: 'nearest' })
  })
  const onToggle = () => {
    afterToggle.current = expanded ? 'keep-button' : 'focus-new'
    setExpanded(!expanded)
  }
  // kn: reaches the map through App's .map-wrap class; an onShowMap prop from App would be cleaner.
  const showOnMap = (id: string) => {
    onHighlight(id)
    document.querySelector('.map-wrap')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  // Facility history pages exist for the Houston list only; a link from another region's night would 404.
  const linked = !ev.region
  const stop = shown.includes(current) ? current : shown[0]
  // The roving stop is the link when there is one, so each facility is one Tab stop, not two.
  const roving = (i: number) => ({
    tabIndex: i === stop ? 0 : -1,
    ref: (el: HTMLElement | null) => { items.current[i] = el },
  })
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const at = shown.indexOf(stop), last = shown.length - 1
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: last }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    items.current[shown[Math.max(0, Math.min(last, next))]]?.focus()
  }
  return (
    <>
      <p className="lead">
        {/* A calm night names the light wind the Check step quotes, not a corridor it never drew. */}
        {wind
          ? t(calm !== null ? 'trc.leadCalm' : 'trc.leadWind', { hour: hourLabel(wind.hour_cst), site: windSite, dir: compass(wind.from_deg, lang), deg: wind.from_deg, mph: wind.speed_mph, calm: calm ?? '' })
          : t('trc.leadNoWind', { hour: hourLabel(ev.detection.hour_cst) })}
      </p>
      {ev.wind.source && (
        <p className="muted small">
          {ev.wind.source === 'own_autogc'
            ? t('trc.windOwnAutogc')
            : t('trc.windBorrowed', { site: windSite, trig: ev.monitors.find((m) => m.site_id === ev.detection.site_id)?.name ?? ev.detection.site_id })}
        </p>
      )}
      <p className="caveat"><InfoIcon />{t('trc.caveat')}</p>
      <TriangulationNote ev={ev} />
      <h3 className="list-heading">{t('trc.heading', { n: corridor.length })}</h3>
      <p className="muted small">{t(noHover ? (linked ? 'trc.hintTouchLinked' : 'trc.hintTouch') : 'trc.hintPointer')}</p>
      {corridor.length === 0 ? <p>{t('trc.empty')}</p> : (
        <ol className="facility-list" id="facility-list" onKeyDown={onListKey}>
          {shown.map((i) => {
            const f = corridor[i]
            return (
            // Key on id + rank: the pipeline can emit the same facility id twice.
            // value and counter-set keep each card's number equal to its map marker when cards are skipped.
            <li
              key={`${f.id}-${f.rank}`}
              value={i + 1}
              style={{ counterSet: `fac ${i + 1}` }}
              className={f.id === matched ? 'is-matched' : undefined}
              {...(linked ? {} : roving(i))}
              onMouseEnter={() => onHighlight(f.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => { setCurrent(i); onHighlight(f.id) }}
              onBlur={() => onHighlight(null)}
            >
              {linked
                ? <a className="fl-name" href={facilityHref(f.id, import.meta.env.BASE_URL)} {...roving(i)}>{f.name}</a>
                : <span className="fl-name">{f.name}</span>}
              {f.id === matched && ev.record_check.incident && <span className="filed-tag">{t('trc.filed', { id: ev.record_check.incident })}</span>}
              {narrowed.has(f.id) && <span className="tri-tag">{t('trc.everyWedge')}</span>}
              <span className="fl-geo">{t('trc.geo', { km: f.distance_km, deg: f.bearing_deg, dir: compass(f.bearing_deg, lang) })}</span>
              <span className="fl-align">
                <span className="align-label">{t('trc.align', { deg: offWindDeg(f.alignment) })}</span>
                <span className="align-track" aria-hidden="true"><span className="align-fill" style={{ width: `${Math.max(0, Math.min(1, f.alignment)) * 100}%` }} /></span>
              </span>
              <span className="muted small">{withSlot(t('trc.source'), 'source', sourceText(f.source, t))}</span>
              {/* Phones: the map is a screen above the list, and a tap on the name leaves the replay. */}
              {noHover && (
                <button type="button" className="btn fl-show" onClick={() => showOnMap(f.id)}>
                  {t('trc.showOnMap')}<span className="sr-only">: {f.name}</span>
                </button>
              )}
            </li>
            )
          })}
        </ol>
      )}
      {folds && (
        <p>
          <button type="button" className="btn" ref={toggle} aria-controls="facility-list" onClick={onToggle}>
            {expanded ? t('trc.showFewer') : t('trc.showAll', { n: corridor.length })}
          </button>
        </p>
      )}
      <PlaceSearch ev={ev} place={place} onPlace={onPlace} />
      {outside.length > 0 && (
        <details className="outside">
          <summary>{t('trc.outside', { n: outside.length })}</summary>
          <ul>{outside.map((f) => <li key={`${f.id}-${f.rank}`}>{t('trc.outsideItem', { name: f.name, km: f.distance_km, deg: f.bearing_deg })}</li>)}</ul>
        </details>
      )}
    </>
  )
}

/** One line on whether a second triggering monitor narrows the corridor. Informational; names no facility. */
function TriangulationNote({ ev }: { ev: PlumeEvent }) {
  const t = useT()
  const tri = ev.triangulation
  if (!tri || tri.verdict === 'not_traced') return null
  const names = tri.monitors.map((m) => m.name).join(t('tri.and'))
  const all = tri.monitors.length === 2 ? t('tri.both') : t('tri.all', { n: tri.monitors.length })
  // The reason follows the verdict code; a verdict this table doesn't know keeps the pipeline's English text.
  const whyKey = TRI_WHY[tri.verdict]
  const why = whyKey ? t(whyKey) : <span lang="en">{tri.verdict_text}</span>
  if (tri.verdict === 'single') return <p className="muted small">{t('tri.single')}</p>
  if (tri.verdict === 'single_wind') {
    return <p className="muted small">{withSlot(t('tri.singleWind', { n: tri.monitors_triggered }), 'why', why)}</p>
  }
  const counts = t('tri.counts', { k: String(tri.intersection_count), n: tri.single_wedge_count })
  if (tri.verdict === 'narrows') {
    return <p className="tri-note">{t('tri.narrows', { names, all, counts, caveat: tri.caveat ?? '' })}</p>
  }
  return <p className="muted small">{withSlot(t('tri.other', { names, counts }), 'why', why)}</p>
}

const TRI_WHY: Record<string, StringKey> = { aligned: 'tri.why.aligned', no_overlap: 'tri.why.no_overlap', single_wind: 'tri.why.single_wind' }

export function Check({ ev, lang }: { ev: PlumeEvent; lang: Lang }) {
  const rc = ev.record_check
  const url = safeHttpUrl(rc.source_url)
  const matched = ev.facilities.find((f) => f.id === rc.matched_facility_id)
  const r = rc.reported
  const t = useT()
  // The report shown above is not one of the "other" reports, though the pipeline lists it with the day's reports.
  const others = (rc.day_incidents ?? []).filter((d) => d.incident !== rc.incident)
  const scope = searchScopeText(rc.search_scope, lang)
  const meaning = MEANING[rc.status]
  // With no matched report the pipeline links the generic STEERS search, not a record.
  const recordLabel = rc.incident ? 'chk.openRecord' : 'chk.searchRecord'
  return (
    <>
      <h3 className="question">{t('chk.question')}</h3>
      <div className="status-block">
        <StatusBadge status={rc.status} lang={lang} />
        {/* The answer first, in plain words; the search scope (a long run of counts) is one tap away. */}
        {meaning && <p>{t(meaning)}</p>}
        {rc.status === 'no_report_after_deadline' && (
          <p><a className="record-link" href="#packet" onClick={toPacketTab}>{t('chk.askState')}</a></p>
        )}
        <details className="scope-details">
          <summary>{t('chk.scopeSummary')}</summary>
          <p className="muted small" lang={scope.lang}>{scope.text}</p>
        </details>
      </div>
      {matched && (
        <p className="is-matched-note">
          <strong>{matched.name}</strong>{rc.incident ? <> · {t('trc.filed', { id: rc.incident })}</> : null}
        </p>
      )}
      <h3 className="list-heading">{t('chk.checks')}</h3>
      <ul className="checks">
        {rc.checks.map((c) => {
          // kn: types.ts does not declare checks[].note yet; read it as optional until it does.
          const note = checkNoteText((c as { note?: string }).note, lang)
          // A filing date in the note means the record exists: "not yet reported" would be false today.
          const late = c.status === 'reported_late' || (c.status === 'not_yet_reported' && note?.filed)
          return (
            <li key={c.at}>
              <span className="check-at">{checkLabel(c.at, t)}</span>{' '}
              {late
                ? <span className="status status-reported_late" lang={lang}><StatusIcon kind="late" /><span>{t('chk.filedAfter')}</span></span>
                : <StatusBadge status={c.status} lang={lang} />}
              {note && <span className="check-note muted small" lang={note.lang}>{note.text}</span>}
            </li>
          )
        })}
      </ul>
      {r && (
        <>
          <h3 className="list-heading">{t('chk.says')}</h3>
          <dl className="facts">
            {r.compound && <div><dt>{t('chk.compound')}</dt><dd><CompoundName raw={r.compound} lang={lang} /></dd></div>}
            {r.pounds != null && <div><dt>{t('chk.pounds')}</dt><dd>{poundsText(r.pounds, lang)}</dd></div>}
            {(r.start_local || r.end_local) && (
              <div><dt>{t('chk.time')}</dt><dd>{t('chk.timeRange', { start: localTime(r.start_local, t), end: localTime(r.end_local, t) })}{r.tz ? ` ${r.tz}` : ''}</dd></div>
            )}
            {r.cause && <div><dt>{t('chk.cause')}</dt><dd lang="en">{r.cause}</dd></div>}
            {(r.revisions ?? []).map((v) => {
              const n = r.start_local ? daysAfterEvent(r.start_local, v.date) : null
              return (
                <div key={`${v.date}-${v.text}`}>
                  <dt>{t('chk.update')}</dt>
                  <dd>{n != null ? t(n === 1 ? 'chk.revisedOne' : 'chk.revisedMany', { n }) : t('chk.revisedOn', { date: v.date })}: <q lang="en">{v.text}</q> <span className="muted">{t('chk.updateSource', { date: v.date })}</span></dd>
                </div>
              )
            })}
          </dl>
        </>
      )}
      {rc.nrc && <NrcBlock n={rc.nrc} lang={lang} />}
      {(rc.unplaced_other_reports?.length ?? 0) > 0 && (
        <p className="muted small">{t('chk.nrcUnplaced', { ids: (rc.unplaced_other_reports ?? []).map((id) => `#${id}`).join(', ') })}</p>
      )}
      {others.length > 0 && <DayIncidents items={others} lang={lang} />}
      {url
        ? <p><a className="record-link" href={url} target="_blank" rel="noopener noreferrer">{t(recordLabel)}<span className="sr-only">{t('chk.newTab')}</span></a></p>
        : <p className="muted">{t('chk.noLink')}</p>}
    </>
  )
}

/** The federal NRC report behind a reported_nrc status; its fields are shown as NRC published them (English). */
function NrcBlock({ n, lang }: { n: NrcReport; lang: Lang }) {
  const t = useT()
  const url = safeHttpUrl(n.source_url)
  return (
    <>
      <h3 className="list-heading">{t('chk.nrcHeading')}</h3>
      <p className="is-matched-note"><strong>{t('chk.nrcReport', { id: n.report })}</strong>{n.company ? <> · <span lang="en">{n.company}</span></> : null}</p>
      <dl className="facts">
        <div><dt>{t('chk.nrcStart')}</dt><dd>{localTime(n.incident_local, t)}</dd></div>
        <div><dt>{t('chk.nrcMaterial')}</dt><dd lang="en">{n.material}</dd></div>
        <div><dt>{t('chk.nrcAmount')}</dt><dd>{n.amount == null ? t('chk.nrcAmountUnknown') : n.unit === 'POUND(S)' ? poundsText(n.amount, lang) : <span lang="en">{`${n.amount} ${n.unit.toLowerCase()}`}</span>}</dd></div>
        <div><dt>{t('chk.nrcLocated')}</dt><dd lang="en">{n.located_by}</dd></div>
      </dl>
      <p className="muted small">{t('chk.nrcNote')}</p>
      {url && <p><a className="record-link" href={url} target="_blank" rel="noopener noreferrer">{t('chk.nrcOpen')}<span className="sr-only">{t('chk.newTab')}</span></a></p>}
    </>
  )
}

// kn: chk.meaning.reported_mismatch quotes pipeline/build.py MATCH_WINDOW_H (6 h before to 2 h after); change both together.
const MEANING: Record<string, StringKey> = {
  reported: 'chk.meaning.reported',
  reported_mismatch: 'chk.meaning.reported_mismatch',
  no_report_after_deadline: 'chk.meaning.no_report_after_deadline',
  search_incomplete: 'chk.meaning.search_incomplete',
  reported_nrc: 'chk.meaning.reported_nrc',
}

/** The hashchange listener (App) switches the step; focusing the new tab brings the stepper into view on a phone.
 *  kn: reaches App's tab by its id (tab-packet); an onStep prop from App would be cleaner. */
function toPacketTab() {
  requestAnimationFrame(() => document.getElementById('tab-packet')?.focus())
}

/** A STEERS compound name in the reader's language when it is one this tool tracks; any other stays as written (English). */
function compoundText(raw: string, lang: Lang): { text: string; lang: Lang } {
  const n = normCompound(raw)
  return n === raw ? { text: raw, lang: 'en' } : { text: compoundLabel(lang, n), lang }
}

function CompoundName({ raw, lang }: { raw: string; lang: Lang }) {
  const c = compoundText(raw, lang)
  return <span lang={c.lang}>{c.text}</span>
}

/** "T+24h" reads as "Notice within 24 hours"; a label of another shape is shown as the pipeline wrote it. */
function checkLabel(at: string, t: Translate): string {
  const c = checkAt(at)
  return c ? t(c.unit === 'h' ? 'chk.atHours' : 'chk.atDays', { n: c.n }) : at
}

// A report that couldn't be placed is neither in nor out; "not in" read as a verdict on its location.
const CORRIDOR_TAG = { in: 'chk.tagIn', out: 'chk.tagOut', unknown: 'chk.tagUnknown' } as const

function DayIncidents({ items, lang }: { items: DayIncident[]; lang: Lang }) {
  const t = useT()
  return (
    <>
      <h3 className="list-heading">{t('chk.dayHeading', { n: items.length })}</h3>
      <p className="muted small">{t('chk.dayNote')}</p>
      <ul className="day-incidents">
        {items.map((d) => (
          <li key={d.incident} className={d.in_corridor ? 'in-corridor' : undefined}>
            <span className="di-entity">{d.entity}</span>
            {/* Corridor membership is stated in words; the border colour only repeats it. */}
            <span className={d.in_corridor ? 'di-tag di-in' : 'di-tag'} lang={lang}>
              {t(CORRIDOR_TAG[d.in_corridor === true ? 'in' : d.in_corridor === false ? 'out' : 'unknown'])}
            </span>
            <span className="di-facts">
              {[
                d.compound ? <CompoundName key="c" raw={d.compound} lang={lang} /> : null,
                d.pounds != null ? poundsText(d.pounds, lang) : null,
                d.start_local ? t('chk.started', { time: localTime(d.start_local, t) }) : null,
              ]
                .filter(Boolean)
                .map((x, i) => <span key={i}>{i > 0 ? ' · ' : ''}{x}</span>)}
            </span>
            <span className="muted small">{t('chk.reportLine', { id: d.incident, resolution: '' }).replace(/:\s*$/, ':')} <span lang={resolutionText(d.resolution, lang).lang}>{resolutionText(d.resolution, lang).text}</span></span>
          </li>
        ))}
      </ul>
    </>
  )
}

const localTime = (stamp: string | undefined, t: Translate) => (stamp ? stamp.replace('T', ' ') : t('chk.notGiven'))

const LANG_NAME: Record<Lang, StringKey> = { en: 'lang.nameEn', es: 'lang.nameEs' }
// kn: one regulator (every region in pipeline/regions.py is in Texas); per-region link when a night outside Texas lands.
const COMPLAINT_URL = 'https://www.tceq.texas.gov/compliance/complaints'
// Shown as the contact number on pcs.harriscountytx.gov (checked 2026-11-14).
const PCS_PHONE = '(713) 920-2831'
const PCS_TEL = 'tel:+17139202831'
const SPEECH_LANG: Record<Lang, string> = { en: 'en-US', es: 'es-US' }

/** Stored as a key, not text, so a notice follows the site language when it changes. */
interface Notice { key: StringKey; vars?: Vars; langName?: Lang }

interface PacketProps {
  ev: PlumeEvent
  ai: AiDraft | null
  review: PacketReview
  setReview: Dispatch<SetStateAction<PacketReview>>
}

/** Puts a node where `{name}` sits in a translated sentence, so the word order stays the translator's. */
function withSlot(text: string, name: string, node: ReactNode): ReactNode {
  const [before, ...rest] = text.split(`{${name}}`)
  return rest.length ? <>{before}{node}{rest.join('')}</> : text
}

export function Packet({ ev, ai, review, setReview }: PacketProps) {
  const { lang, source, drafts, approved } = review
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const t = useT()
  const langName = (l: Lang) => t(LANG_NAME[l])
  const noticeText = notice ? t(notice.key, { ...notice.vars, ...(notice.langName ? { lang: langName(notice.langName) } : {}) }) : ''
  // A live region only speaks when its text changes, so the same notice twice ("Draft copied." after a second copy)
  // is cleared first and set again a moment later.
  const sayTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(sayTimer.current), [])
  const say = (n: Notice | null) => {
    window.clearTimeout(sayTimer.current)
    setNotice(null)
    if (n) sayTimer.current = window.setTimeout(() => setNotice(n), 60)
  }
  const dialog = useRef<HTMLDialogElement>(null)
  const dlgTitle = useRef<HTMLHeadingElement>(null)
  const [dlgCopy, setDlgCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const dlgDraft = useRef<HTMLTextAreaElement>(null)
  const draftBox = useRef<HTMLTextAreaElement>(null)
  // The incident note exists only on the clipboard; when copying fails it is shown here to copy by hand.
  const [noteFallback, setNoteFallback] = useState<string | null>(null)
  const noteBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (noteFallback !== null) noteBox.current?.select() }, [noteFallback])
  // No clipboard (insecure page, denied permission): the approved text is shown selected so it can be copied by hand.
  useEffect(() => { if (dlgCopy === 'failed') dlgDraft.current?.select() }, [dlgCopy])
  const copyApproved = async () => {
    try {
      await navigator.clipboard.writeText(drafts[lang])
      setDlgCopy('copied')
    } catch {
      setDlgCopy('failed')
    }
  }
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
  const clip = useRecordedClip(source, lang, drafts[lang])
  const audio = useRef<HTMLAudioElement>(null)
  const guard = ev.packet.guard
  const aiFailed = useAiDraftFailed()
  const replayUrl = noteUrl(location.href)
  const recordUrl = safeHttpUrl(ev.record_check.source_url)

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel() }, [canSpeak])
  // The text, language or source changed under a playing recording: it no longer matches what is on screen.
  useEffect(() => () => { audio.current?.pause(); setSpeaking(false) }, [clip.url])
  // Edits survive a reload or Back in this tab; edits happen only here, so saving here covers them all.
  useEffect(() => { savePacketReview(ev, review) }, [ev, review])

  // The header switch (App) also changes the language and clears approval; say so here, where it is seen.
  // Any older notice ("Draft copied.") was about the other language's draft.
  const prev = useRef(review)
  useEffect(() => {
    const was = prev.current
    prev.current = review
    if (was.lang === review.lang) return
    say(was.approved ? { key: 'pkt.switched', langName: review.lang } : null)
    // say is recreated each render; only a language change should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review])

  const stopSpeech = () => {
    if (canSpeak) window.speechSynthesis.cancel()
    if (audio.current) { audio.current.pause(); audio.current.currentTime = 0 }
    setSpeaking(false)
  }

  // Product rule: a person approves the exact text they file, so approval belongs to one language's draft.
  // The notice comes from the language effect above, for this switch and the header's alike.
  const switchLang = (l: Lang) => {
    if (l === lang) return
    stopSpeech()
    setReview((r) => ({ ...r, lang: l, approved: false }))
    setSiteLang(l)
  }

  // Same rule as switching language: approval covers the exact text read, so a new source needs a new approval.
  const switchSource = (s: Source) => {
    if (s === source || (s === 'ai' && !ai)) return
    stopSpeech()
    const next = s === 'ai' && ai ? { en: ai.draft_en, es: ai.draft_es } : { en: ev.packet.draft_en, es: ev.packet.draft_es }
    say({ key: s === 'ai' ? 'pkt.showingAi' : 'pkt.showingTemplate' })
    setReview((r) => ({ ...r, source: s, drafts: next, approved: false }))
  }

  const readAloud = () => {
    if (speaking) return stopSpeech()
    if (clip.url && audio.current) {
      audio.current.play().then(() => setSpeaking(true), () => say({ key: 'pkt.noPlay' }))
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

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(drafts[lang])
      say({ key: 'pkt.copiedDraft' })
    } catch {
      draftBox.current?.select()
      say({ key: 'pkt.copyFailed' })
    }
  }

  const copyNote = async () => {
    const text = incidentNote(ev, replayUrl, lang)
    try {
      await navigator.clipboard.writeText(text)
      setNoteFallback(null)
      say({ key: 'pkt.copiedNote' })
    } catch {
      setNoteFallback(text)
      say({ key: 'pkt.copyFailedNote' })
    }
  }

  const openDialog = () => {
    setDlgCopy('idle')
    dialog.current?.showModal()
    // autoFocus does nothing on a dialog that mounts closed; without this, focus landed on the phone link.
    dlgTitle.current?.focus()
  }

  return (
    <>
      <p className="lead">{t('pkt.lead')}</p>
      <div className="controls">
        {(ai || aiFailed) && (
          <div className="control">
            <span className="control-label" id="src-label">{t('pkt.source')}</span>
            <div className="seg" role="group" aria-labelledby="src-label">
              <button type="button" aria-pressed={source === 'template'} onClick={() => switchSource('template')}>
                {t('pkt.template')} <span className="seg-sub">{t('pkt.templateSub')}</span>
              </button>
              <button type="button" aria-pressed={source === 'ai'} disabled={!ai} aria-describedby={ai ? undefined : 'ai-missing'} onClick={() => switchSource('ai')}>
                {t('pkt.ai')} {ai && <span className="seg-sub">{t('pkt.aiSub', { provider: ai.provider })}</span>}
              </button>
            </div>
            {!ai && <p id="ai-missing" className="muted small">{t('pkt.aiUnavailable')}</p>}
          </div>
        )}
        <div className="control">
          <span className="control-label" id="lang-label">{t('pkt.langGroup')}</span>
          <div className="seg" role="group" aria-labelledby="lang-label">
            <button type="button" aria-pressed={lang === 'en'} onClick={() => switchLang('en')} lang="en">English</button>
            <button type="button" aria-pressed={lang === 'es'} onClick={() => switchLang('es')} lang="es">Español</button>
          </div>
        </div>
      </div>
      <label className="draft-label" htmlFor="draft">
        {t('pkt.draftLabel', { lang: langName(lang) })}{approved ? <span className="approved-tag">{t('pkt.approvedTag')}</span> : ''}
      </label>
      <textarea
        id="draft"
        ref={draftBox}
        className="draft"
        lang={lang}
        rows={9}
        value={drafts[lang]}
        onChange={(e) => {
          const value = e.target.value
          // Approval covers the exact text a person read; any edit needs a fresh approval.
          // Said aloud too: otherwise a screen reader user typing here never learns File was disabled.
          // Any other notice ("Draft copied.") is about the text before this edit.
          if (approved) say({ key: 'pkt.edited' })
          else if (notice) say(null)
          setReview((r) => ({ ...r, drafts: { ...r.drafts, [lang]: value }, approved: false }))
        }}
      />
      <p className="muted small provenance">
        {/* An AI draft restored after a reload names its model once packet.ai.json is back; it is never called the template. */}
        {source === 'ai' ? (
          ai && t('pkt.byAi', { provider: ai.provider, model: ai.model, date: ai.generated_local, runs: t(ai.runs_on_this_event === 1 ? 'pkt.runsOne' : 'pkt.runsMany', { n: ai.runs_on_this_event }) })
        ) : (
          withSlot(t('pkt.byTemplate', {
            result: guard.passed ? t('pkt.checkPassed') : t('pkt.checkFailed', { why: guard.rejected.join(', ') || t('pkt.noDetails') }),
          }), 'who', draftedBy(ev.packet.drafted_by, t))
        )}
      </p>
      <div className="row">
        {/* The label states the action, so no aria-pressed: a toggle whose label also flips reads backwards. */}
        <button type="button" className="btn" onClick={readAloud} disabled={!canSpeak && !clip.url}>
          {t(speaking ? 'pkt.stopReading' : 'pkt.readAloud')}
        </button>
        <button type="button" className="btn" onClick={copyDraft}>{t('pkt.copyDraft')}</button>
        <button type="button" className="btn" onClick={copyNote}>
          {t('pkt.copyNote')}
        </button>
      </div>
      {clip.url && <audio ref={audio} src={clip.url} preload="none" onEnded={() => setSpeaking(false)} onError={() => setSpeaking(false)} />}
      {!clip.url && clip.checked && canSpeak && <p className="muted small">{t('pkt.computerVoice')}</p>}
      {!canSpeak && !clip.url && <p className="muted small">{t('pkt.noSpeech')}</p>}
      <p className="sr-only" aria-live="polite">{noticeText}</p>
      {noticeText && <p className="muted small" aria-hidden="true">{noticeText}</p>}
      {noteFallback !== null && (
        <>
          <label className="draft-label" htmlFor="note-copy">{t('pkt.noteLabel')}</label>
          <textarea id="note-copy" ref={noteBox} className="draft" lang={lang} rows={8} readOnly value={noteFallback} />
        </>
      )}

      <h3 className="list-heading">{t('pkt.reviewFile')}</h3>
      <ol className="file-steps">
        <li>
          <span className="file-step-num" aria-hidden="true">1</span>
          <button type="button" className={approved ? 'btn btn-done' : 'btn btn-primary'} onClick={() => { say(null); setReview((r) => ({ ...r, approved: !r.approved })) }}>
            {t(approved ? 'pkt.approved' : 'pkt.approve')}
          </button>
        </li>
        <li>
          <span className="file-step-num" aria-hidden="true">2</span>
          <button type="button" className="btn btn-primary" disabled={!approved} aria-describedby="file-hint" onClick={openDialog}>
            {t('pkt.file')}
          </button>
          <p id="file-hint" className="muted small">{t(approved ? 'pkt.fileHint' : 'pkt.approveFirst')}</p>
        </li>
      </ol>

      {/* A tap on the backdrop closes it too: on a short phone the only other way out was below the fold. */}
      <dialog ref={dialog} className="dialog" aria-labelledby="dlg-title" onClick={(e) => {
        // The dialog box itself is also the click target on its own padding, so only a click outside its box closes it.
        if (e.target !== e.currentTarget) return
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.current?.close()
      }}>
        <div className="dlg-head">
          <h2 id="dlg-title" ref={dlgTitle} tabIndex={-1}>{t('pkt.dlgTitle')}</h2>
          <form method="dialog"><button className="btn dlg-close" aria-label={t('pkt.dlgClose')}><span aria-hidden="true">×</span></button></form>
        </div>
        <p>{withSlot(t('pkt.dlgApproved'), 'lang', <strong>{langName(lang)}</strong>)}</p>
        <p>{t('pkt.dlgNothingSent')}</p>
        <p>{t('pkt.dlgHow')}</p>
        <dl className="dlg-links">
          <div><dt>{t('pkt.dlgReplayLink')}</dt><dd><a href={replayUrl}>{replayUrl}</a></dd></div>
          {recordUrl && (
            <div>
              <dt>{t(ev.record_check.incident ? 'pkt.dlgRecordLink' : 'pkt.dlgSearchLink')}</dt>
              <dd><a href={recordUrl} target="_blank" rel="noopener noreferrer">{recordUrl}<span className="sr-only">{t('chk.newTab')}</span></a></dd>
            </div>
          )}
        </dl>
        {/* Houston and Harris County contacts: a night from another region (Jefferson County) does not get them. */}
        {!ev.region && (
          <>
            <p>{t('pkt.dlgCall')}</p>
            <p><a className="btn" href={PCS_TEL}>{t('pkt.dlgCallBtn', { phone: PCS_PHONE })}</a></p>
          </>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={copyApproved}>{t('pkt.dlgCopy')}</button>
          <a className="btn" href={COMPLAINT_URL} target="_blank" rel="noopener noreferrer">
            {t('pkt.dlgLink')}<span className="sr-only">{t('chk.newTab')}</span>
          </a>
        </div>
        {/* Inside the dialog: a modal makes the rest of the page inert, so the panel's own live region is not heard. */}
        <p className="small" aria-live="polite">{dlgCopy === 'copied' ? t('pkt.dlgCopied') : dlgCopy === 'failed' ? t('pkt.dlgCopyFailed') : ''}</p>
        {dlgCopy === 'failed' && (
          <>
            <label className="draft-label" htmlFor="dlg-draft">{t('pkt.dlgDraft')}</label>
            <textarea id="dlg-draft" ref={dlgDraft} className="draft" lang={lang} rows={6} readOnly value={drafts[lang]} />
          </>
        )}
        <form method="dialog"><button className="btn btn-primary">{t('pkt.dlgOk')}</button></form>
      </dialog>
    </>
  )
}

// The pipeline's drafted_by for the template (build.py); another value is shown as written and marked English.
const DRAFTED_BY: Record<string, StringKey> = { 'template (deterministic, no AI)': 'pkt.whoTemplate' }
function draftedBy(who: string | null, t: Translate): ReactNode {
  if (!who) return t('pkt.whoUnknown')
  const k = DRAFTED_BY[who]
  return k ? t(k) : <span lang="en">{who}</span>
}
