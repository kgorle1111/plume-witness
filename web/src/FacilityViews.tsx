import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PAGE_SIZE, REGISTRY_ID, clipQuery, compoundKey, displayName, eventTypeKey, facilitiesHref, facilityHref, isLoadError, lbs, loadJson,
  localTime, monitorSpikesHref, nightHref, parseFacility, parseIndex, searchFacilities, triReasonKey,
  type FacilityFile, type FacilityIndex, type LoadError,
} from './facilities'
import { distanceText, hourLabel, maxFracDigits, safeHttpUrl } from './format'
import { T } from './LangSwitch'
import { Num } from './Unit'
import { useT, type Translate } from './useT'
import './Facilities.css'

const BASE = import.meta.env.BASE_URL

/** The reader's sentence for a failed load; the technical detail of damaged data goes to the console. */
function errorText(error: LoadError, file: string, t: Translate): string {
  if (error.kind === 'network') return t('fx.errNetwork')
  if (error.kind === 'damaged') return t('fx.errDamaged')
  return error.status === 404 ? t('fx.err404') : t('fx.errHttp', { file, status: error.status })
}

/** A 404 is final; a dropped connection, a server error or a damaged file is worth another try. */
const canRetry = (e: LoadError) => !(e.kind === 'http' && e.status === 404)

function useJson<T>(file: string, parse: (raw: unknown) => T): { data: T | null; error: LoadError | null; retry: () => void } {
  const [state, setState] = useState<{ data: T | null; error: LoadError | null }>({ data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    loadJson(`${BASE}${file}`, parse, fetch, ctrl.signal)
      .then((data) => setState({ data, error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        const error: LoadError = isLoadError(e) ? e : { kind: 'damaged', detail: String(e) }
        if (error.kind === 'damaged') console.error(`Plume Witness: ${error.detail}`)
        setState({ data: null, error })
      })
    return () => ctrl.abort()
    // parse is a module-level function or an inline closure over a stable id; the file name is the real key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, attempt])
  const retry = () => { setState({ data: null, error: null }); setAttempt((n) => n + 1) }
  return { ...state, retry }
}

// Site.tsx wraps this in the site header and footer.
function Shell({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <main className="fx-page">
      <header className="fx-head">
        <p className="fx-kicker">{kicker}</p>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  )
}

/** A failed or impossible page. The list page offers no link to itself; a retryable failure offers Try again. */
function Message({ title, text, retry, list = false }: { title: string; text: string; retry?: () => void; list?: boolean }) {
  const t = useT()
  return (
    <Shell kicker="Plume Witness" title={title}>
      <p role="alert">{text}</p>
      {retry && <p><button type="button" className="btn" onClick={retry}>{t('fx.retry')}</button></p>}
      {!list && <p><a href={facilitiesHref(BASE)}>{t('fx.searchAll')}</a></p>}
    </Shell>
  )
}

function Report({ r }: { r: FacilityFile['reports_to_state']['reports'][number] }) {
  const t = useT()
  const url = safeHttpUrl(r.url)
  const type = eventTypeKey(r.event_type)
  return (
    <li className="fx-card">
      <p className="fx-card-head">
        {url ? <a href={url} rel="noopener" target="_blank">{t('fx.record', { id: r.incident })}</a> : <span>{t('fx.record', { id: r.incident })}</span>}
        {type ? <span className="muted small">{t(type)}</span> : <span className="muted small" lang="en">{r.event_type}</span>}
      </p>
      <p className="small"><T k="fx.span" v={{ from: <time dateTime={r.start_local}>{localTime(r.start_local)}</time>, to: <time dateTime={r.end_local}>{localTime(r.end_local)}</time> }} /></p>
      <dl className="fx-facts">
        <div><dt>{t('fx.benzene')}</dt><dd>{r.benzene_lbs > 0 ? lbs(r.benzene_lbs)
          : r.benzene_lumped?.length ? r.benzene_lumped.map((x) => t('fx.inMixture', { lbs: lbs(x.pounds), cell: x.cell })).join('; ')
            : t('fx.notListed')}</dd></div>
        <div><dt>{t('fx.butadiene')}</dt><dd>{r.butadiene_lbs > 0 ? lbs(r.butadiene_lbs) : t('fx.notListed')}</dd></div>
      </dl>
      <p className="small"><span className="muted">{t('fx.cause')}</span><span lang="en">{r.cause_excerpt}</span></p>
    </li>
  )
}

/** "benzene" in the reader's language, for prose; an unknown compound stays as the file wrote it. */
function useCompound(): (c: string) => string {
  const t = useT()
  return (c) => { const k = compoundKey(c); return k ? t(k) : c }
}

function TriTable({ f }: { f: FacilityFile }) {
  const t = useT()
  const compound = useCompound()
  const years = Object.keys(f.reports_to_epa.years).sort()
  if (!years.length) {
    const key = triReasonKey(f.reports_to_epa.status)
    if (key) return <p className="small">{t(key)}</p>
    return f.reports_to_epa.reason ? <p className="small" lang="en">{f.reports_to_epa.reason}</p> : <p className="small">{t('fx.noTri')}</p>
  }
  const rows = years.flatMap((y) => Object.entries(f.reports_to_epa.years[y]).map(([compound, v]) => ({ y, compound, v })))
  // Pounds exactly as the form gives them, each column's decimal points in line (Unit.tsx Num).
  const frac = {
    stack: maxFracDigits(rows.map((r) => r.v.stack_lbs)),
    fugitive: maxFracDigits(rows.map((r) => r.v.fugitive_lbs)),
    total: maxFracDigits(rows.map((r) => r.v.total_lbs)),
  }
  const lb = (n: number | null, f: number) => (n === null ? t('fx.noNumber') : <Num value={n} frac={f} suffix=" lb" group />)
  const compounds = new Set(rows.map((r) => r.compound))
  // One compound: say it once above the table, so the four number columns fit a 343 px phone column.
  const only = compounds.size === 1 ? rows[0].compound : null
  return (
    <>
      {only && <p className="small">{t('fx.triOnly', { compound: compound(only) })}</p>}
      <div className="fx-scroll">
        <table className="fx-table">
          <caption className="sr-only">{t('fx.triCaption')}</caption>
          <thead><tr><th scope="col">{t('fx.cYear')}</th>{!only && <th scope="col">{t('fx.cCompound')}</th>}<th scope="col" className="num">{t('fx.cStack')}</th><th scope="col" className="num">{t('fx.cFugitive')}</th><th scope="col" className="num">{t('fx.cTotal')}</th></tr></thead>
          <tbody>
            {rows.map(({ y, compound: c, v }) => (
              <tr key={`${y}-${c}`}>
                <th scope="row">{y}</th>{!only && <td>{compound(c)}</td>}
                <td className="num">{lb(v.stack_lbs, frac.stack)}</td><td className="num">{lb(v.fugitive_lbs, frac.fugitive)}</td><td className="num">{lb(v.total_lbs, frac.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('fx.triNote')}</p>
    </>
  )
}

/** The matched report's state record, or plain text when the file has no usable URL (a "#" link went nowhere). */
function IncidentLink({ f, incident }: { f: FacilityFile; incident: string }) {
  const url = safeHttpUrl(f.reports_to_state.reports.find((r) => r.incident === incident)?.url)
  return url ? <a href={url} rel="noopener" target="_blank">{incident}</a> : <>{incident}</>
}

function FacilityPage({ id }: { id: string }) {
  const t = useT()
  const compound = useCompound()
  const { data: f, error, retry } = useJson(`facilities/${id}.json`, (raw) => parseFacility(raw, id))
  useEffect(() => { if (f) document.title = t('fx.docTitle', { name: displayName(f.name) }) }, [f, t])
  if (error) {
    // "Not found" only when the server said so: a dropped connection must not tell a reader the facility does not exist.
    const notFound = error.kind === 'http' && error.status === 404
    return <Message title={t(notFound ? 'fx.notFound' : 'fx.errLoadTitle')} text={errorText(error, `facilities/${id}.json`, t)} retry={canRetry(error) ? retry : undefined} />
  }
  if (!f) return <main className="state-msg" aria-busy="true"><p>{t('fx.loadingOne')}</p></main>
  const echo = safeHttpUrl(f.echo_url)
  const spikes = monitorSpikesHref(f.nearest_monitor, BASE)
  const n = f.reports_to_state.count
  const cite = t('fx.cite', { name: f.name, id: f.registry_id, url: `${window.location.origin}${window.location.pathname}?view=facility&id=${f.registry_id}` })
  return (
    <Shell kicker={t('fx.kicker')} title={displayName(f.name)}>
      {displayName(f.name) !== f.name && <p className="fx-registered">{t('fx.registered', { name: f.name })}</p>}
      <p className="fx-sub"><T k="fx.sub" v={{ address: f.address, km: distanceText(f.distance_km), monitor: f.nearest_monitor, link: echo ? <a href={echo} rel="noopener" target="_blank">{t('fx.echo')}</a> : '' }} /></p>
      {spikes && <p className="fx-spikes"><a href={spikes}>{t('fx.spikesLink', { monitor: f.nearest_monitor })}</a></p>}
      <p className="fx-note" role="note">{t('fx.upwindNote')} {t('fx.pageNote')}</p>

      <section aria-labelledby="fx-state">
        <h2 id="fx-state">{t('fx.hState', { n })}</h2>
        {n === 0
          ? <p className="small">{t('fx.noState')}</p>
          : <ul className="fx-list">{f.reports_to_state.reports.map((r) => <Report key={r.incident} r={r} />)}</ul>}
        <p className="muted small">{t('fx.stateSrc')}</p>
      </section>

      <section aria-labelledby="fx-epa">
        <h2 id="fx-epa">{t('fx.hEpa')}</h2>
        <TriTable f={f} />
        <p className="muted small">{t('fx.epaTail')}</p>
      </section>

      <section aria-labelledby="fx-nights">
        <h2 id="fx-nights">{t('fx.hNights', { n: f.matched_nights.length })}</h2>
        {f.matched_nights.length === 0
          ? <p className="small">{t('fx.noNights')}</p>
          : (
            <ul className="fx-list">
              {f.matched_nights.map((m) => (
                <li key={m.night_id} className="fx-card">
                  <p className="fx-night-link"><a href={nightHref(m.night_id, BASE)}>{t('fx.nightLink', { date: m.date })}</a></p>
                  <p className="small"><T k="fx.nightBody" v={{ compound: compound(m.compound), monitor: m.monitor, hour: hourLabel(m.hour_cst), value: m.value_ppb, km: distanceText(m.distance_km), link: <IncidentLink f={f} incident={m.incident} /> }} /></p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="fx-cite">
        <h2 id="fx-cite">{t('fx.hCite')}</h2>
        <p className="small fx-cite">{cite}</p>
        <p className="small fx-links"><a href={`${BASE}facilities/${f.registry_id}.json`}>{t('fx.json')}</a> · <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('fx.fields')}</a></p>
      </section>
    </Shell>
  )
}

function FacilityList() {
  const t = useT()
  const { data, error, retry } = useJson<FacilityIndex>('facilities/index.json', parseIndex)
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  // The page size resets with each new query, so a search starts at its first card.
  const [paging, setPaging] = useState({ q, limit: PAGE_SIZE })
  const limit = paging.q === q ? paging.limit : PAGE_SIZE
  const rows = useMemo(() => (data ? searchFacilities(data.facilities, q) : []), [data, q])
  const listRef = useRef<HTMLUListElement>(null)
  const focusRow = useRef<number | null>(null)
  useEffect(() => { document.title = t('fx.listDocTitle') }, [t])
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    // ?view=facility with no id lands here: name the page actually shown.
    p.set('view', 'facilities')
    p.delete('id')
    if (q) p.set('q', q)
    else p.delete('q')
    history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
  }, [q])
  // Keyboard and screen-reader users land on the first card "Show more" added, not back on the button below it.
  useEffect(() => {
    const i = focusRow.current
    if (i === null) return
    focusRow.current = null
    listRef.current?.querySelectorAll<HTMLElement>('.fx-card > a')[i]?.focus()
  }, [limit])
  if (error) {
    // fx.err404 speaks of one facility; a missing index is a site fault, worth a retry once it is redeployed.
    const file = 'facilities/index.json'
    const text = error.kind === 'http' ? t('fx.errHttp', { file, status: error.status }) : errorText(error, file, t)
    return <Message title={t('common.facilities')} text={text} retry={retry} list />
  }
  if (!data) return <main className="state-msg" aria-busy="true"><p>{t('fx.loadingList')}</p></main>
  const shown = rows.slice(0, limit)
  const next = Math.min(PAGE_SIZE, rows.length - shown.length)
  const showMore = () => {
    focusRow.current = shown.length
    setPaging({ q, limit: shown.length + PAGE_SIZE })
  }
  const cov = data.coverage
  const covVars = { a: cov.not_placed, b: cov.detail_pages_cached }
  return (
    <Shell kicker={t('common.facilities')} title={t('fx.listTitle')}>
      <p className="fx-note" role="note">{t('fx.upwindNote')}</p>
      <p className="small">{t('fx.listIntro', { n: data.facilities.length })}</p>
      <div className="fx-search">
        <label htmlFor="fx-q">{t('fx.search')}</label>
        <input id="fx-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder={t('fx.placeholder')} />
        <p role="status" className="muted small">{q.trim() ? t('fx.shownFiltered', { n: shown.length, m: rows.length, total: data.facilities.length }) : t('fx.shown', { n: shown.length, total: data.facilities.length })}</p>
      </div>
      <h2 className="sr-only">{t('fx.listHeading')}</h2>
      <ul className="fx-list fx-rows" ref={listRef}>
        {shown.map((r) => (
          <li key={r.id} className="fx-card">
            <a href={facilityHref(r.id, BASE)}>{displayName(r.name)}</a>
            <span className="small muted">{t('fx.rowWhere', { address: r.address, km: distanceText(r.distance_km), monitor: r.nearest_monitor })}</span>
            <span className="small">{[t(r.reports === 1 ? 'fx.reportsOne' : 'fx.reportsMany', { n: r.reports }), r.tri_years ? t(r.tri_years === 1 ? 'fx.triOne' : 'fx.triMany', { n: r.tri_years }) : t('fx.triNone'), r.matched_nights ? t(r.matched_nights === 1 ? 'fx.matchedOne' : 'fx.matchedMany', { n: r.matched_nights }) : null].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      {next > 0 && <p className="fx-more"><button type="button" className="btn" onClick={showMore}>{t('fx.more', { n: next })}</button></p>}
      {rows.length === 0 && <p className="fx-nomatch">{t('fx.noMatch', { q: clipQuery(q) })}</p>}
      <p className="muted small">
        {typeof cov.search_rows === 'number' ? t('fx.coverageRows', { ...covVars, rows: cov.search_rows }) : t('fx.coverage', covVars)}
      </p>
    </Shell>
  )
}

function BadId() {
  const t = useT()
  return <Message title={t('fx.notFound')} text={t('fx.errId')} />
}

export default function FacilityViews({ view }: { view: 'facility' | 'facilities' }) {
  if (view === 'facilities') return <FacilityList />
  const id = new URLSearchParams(window.location.search).get('id') ?? ''
  // No id at all is a reader who wants the list, not a bad id.
  if (!id) return <FacilityList />
  if (!REGISTRY_ID.test(id)) return <BadId />
  return <FacilityPage id={id} />
}
