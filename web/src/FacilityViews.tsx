import { useEffect, useMemo, useState } from 'react'
import { SiteFooter } from './SiteFooter'
import {
  REGISTRY_ID, facilitiesHref, facilityHref, lbs, localTime, parseFacility, parseIndex, searchFacilities,
  type FacilityFile, type FacilityIndex,
} from './facilities'
import { hourLabel, safeHttpUrl } from './format'
import { DEMO_REPLAY_HREF } from './demoHref'
import { LangSwitch, T } from './LangSwitch'
import { useT, type Translate } from './useT'
import './Facilities.css'

const BASE = import.meta.env.BASE_URL

// A failed load throws this prefix plus the status, so the message can be written in the reader's language.
const HTTP_ERROR = 'http:'

function errorText(error: string, file: string, t: Translate): string {
  if (!error.startsWith(HTTP_ERROR)) return error
  const status = Number(error.slice(HTTP_ERROR.length))
  return status === 404 ? t('fx.err404') : t('fx.errHttp', { file, status })
}

function useJson<T>(file: string, parse: (raw: unknown) => T): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${BASE}${file}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${HTTP_ERROR}${r.status}`)
        return r.json()
      })
      .then((raw) => setState({ data: parse(raw), error: null }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setState({ data: null, error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
    // parse is a module-level function or an inline closure over a stable id; the file name is the real key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])
  return state
}

function Shell({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="fx-shell">
      <main className="fx-page">
        <a className="fx-back" href={DEMO_REPLAY_HREF}>{t('common.backReplayPlain')}</a>
        <LangSwitch />
        <header className="fx-head">
          <p className="fx-kicker">{kicker}</p>
          <h1>{title}</h1>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

function Message({ title, text }: { title: string; text: string }) {
  const t = useT()
  return <Shell kicker="Plume Witness" title={title}><p role="alert">{text}</p><p><a href={facilitiesHref(BASE)}>{t('fx.searchAll')}</a></p></Shell>
}

function Report({ r }: { r: FacilityFile['reports_to_state']['reports'][number] }) {
  const t = useT()
  const url = safeHttpUrl(r.url)
  return (
    <li className="fx-card">
      <p className="fx-card-head">
        {url ? <a href={url} rel="noopener" target="_blank">{t('fx.record', { id: r.incident })}</a> : <span>{t('fx.record', { id: r.incident })}</span>}
        <span className="muted small">{r.event_type}</span>
      </p>
      <p className="small"><T k="fx.span" v={{ from: <time dateTime={r.start_local}>{localTime(r.start_local)}</time>, to: <time dateTime={r.end_local}>{localTime(r.end_local)}</time> }} /></p>
      <dl className="fx-facts">
        <div><dt>{t('fx.benzene')}</dt><dd>{r.benzene_lbs > 0 ? lbs(r.benzene_lbs) : t('fx.notListed')}</dd></div>
        <div><dt>{t('fx.butadiene')}</dt><dd>{r.butadiene_lbs > 0 ? lbs(r.butadiene_lbs) : t('fx.notListed')}</dd></div>
      </dl>
      <p className="small"><span className="muted">{t('fx.cause')}</span><span lang="en">{r.cause_excerpt}</span></p>
    </li>
  )
}

function TriTable({ f }: { f: FacilityFile }) {
  const t = useT()
  const lb = (n: number | null) => (n === null ? t('fx.noNumber') : lbs(n))
  const years = Object.keys(f.reports_to_epa.years).sort()
  if (!years.length) {
    return <p className="small">{f.reports_to_epa.reason ?? t('fx.noTri')}</p>
  }
  const rows = years.flatMap((y) => Object.entries(f.reports_to_epa.years[y]).map(([compound, v]) => ({ y, compound, v })))
  return (
    <div className="fx-scroll">
      <table className="fx-table">
        <caption className="sr-only">{t('fx.triCaption')}</caption>
        <thead><tr><th scope="col">{t('fx.cYear')}</th><th scope="col">{t('fx.cCompound')}</th><th scope="col" className="num">{t('fx.cStack')}</th><th scope="col" className="num">{t('fx.cFugitive')}</th><th scope="col" className="num">{t('fx.cTotal')}</th></tr></thead>
        <tbody>
          {rows.map(({ y, compound, v }) => (
            <tr key={`${y}-${compound}`}>
              <th scope="row">{y}</th><td>{compound === 'butadiene' ? '1,3-butadiene' : compound}</td>
              <td className="num">{lb(v.stack_lbs)}</td><td className="num">{lb(v.fugitive_lbs)}</td><td className="num">{lb(v.total_lbs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The matched report's state record, or plain text when the file has no usable URL (a "#" link went nowhere). */
function IncidentLink({ f, incident }: { f: FacilityFile; incident: string }) {
  const url = safeHttpUrl(f.reports_to_state.reports.find((r) => r.incident === incident)?.url)
  return url ? <a href={url} rel="noopener" target="_blank">{incident}</a> : <>{incident}</>
}

function FacilityPage({ id }: { id: string }) {
  const t = useT()
  const { data: f, error } = useJson(`facilities/${id}.json`, (raw) => parseFacility(raw, id))
  useEffect(() => { if (f) document.title = t('fx.docTitle', { name: f.name }) }, [f, t])
  if (error) return <Message title={t('fx.notFound')} text={errorText(error, `facilities/${id}.json`, t)} />
  if (!f) return <main className="state-msg"><p>{t('fx.loadingOne')}</p></main>
  const echo = safeHttpUrl(f.echo_url)
  const n = f.reports_to_state.count
  const cite = t('fx.cite', { name: f.name, id: f.registry_id, url: `${window.location.origin}${window.location.pathname}?view=facility&id=${f.registry_id}` })
  return (
    <Shell kicker={t('fx.kicker')} title={f.name}>
      <p className="fx-sub"><T k="fx.sub" v={{ address: f.address, km: f.distance_km, monitor: f.nearest_monitor, link: echo ? <a href={echo} rel="noopener" target="_blank">{t('fx.echo')}</a> : '' }} /></p>
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
        <p className="muted small">{f.reports_to_epa.note} {t('fx.epaTail')}</p>
      </section>

      <section aria-labelledby="fx-nights">
        <h2 id="fx-nights">{t('fx.hNights', { n: f.matched_nights.length })}</h2>
        {f.matched_nights.length === 0
          ? <p className="small">{t('fx.noNights')}</p>
          : (
            <ul className="fx-list">
              {f.matched_nights.map((m) => (
                <li key={m.night_id} className="fx-card">
                  <p className="fx-night-link"><a href={`${BASE}?night=${encodeURIComponent(m.night_id)}`}>{t('fx.nightLink', { date: m.date })}</a></p>
                  <p className="small"><T k="fx.nightBody" v={{ compound: m.compound, monitor: m.monitor, hour: hourLabel(m.hour_cst), value: m.value_ppb, km: m.distance_km, link: <IncidentLink f={f} incident={m.incident} /> }} /></p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="fx-cite">
        <h2 id="fx-cite">{t('fx.hCite')}</h2>
        <p className="small fx-cite">{cite}</p>
        <p className="small"><a href={`${BASE}facilities/${f.registry_id}.json`}>{t('fx.json')}</a> · <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">{t('fx.fields')}</a></p>
      </section>
    </Shell>
  )
}

function FacilityList() {
  const t = useT()
  const { data, error } = useJson<FacilityIndex>('facilities/index.json', parseIndex)
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const rows = useMemo(() => (data ? searchFacilities(data.facilities, q) : []), [data, q])
  useEffect(() => { document.title = 'Facilities · Plume Witness' }, [])
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (q) p.set('q', q)
    else p.delete('q')
    history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
  }, [q])
  if (error) return <Message title={t('common.facilities')} text={errorText(error, 'facilities/index.json', t)} />
  if (!data) return <main className="state-msg"><p>{t('fx.loadingList')}</p></main>
  return (
    <Shell kicker={t('common.facilities')} title={t('fx.listTitle')}>
      <p className="fx-note" role="note">{t('fx.upwindNote')}</p>
      <p className="small">{t('fx.listIntro', { n: data.facilities.length })}</p>
      <div className="fx-search">
        <label htmlFor="fx-q">{t('fx.search')}</label>
        <input id="fx-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <p role="status" className="muted small">{t('fx.shown', { n: rows.length, total: data.facilities.length })}</p>
      </div>
      <ul className="fx-list fx-rows">
        {rows.map((r) => (
          <li key={r.id} className="fx-card">
            <a href={facilityHref(r.id, BASE)}>{r.name}</a>
            <span className="small muted">{r.address} · {r.distance_km} km from {r.nearest_monitor}</span>
            <span className="small">{[t(r.reports === 1 ? 'fx.reportsOne' : 'fx.reportsMany', { n: r.reports }), r.tri_years ? t(r.tri_years === 1 ? 'fx.triOne' : 'fx.triMany', { n: r.tri_years }) : t('fx.triNone'), r.matched_nights ? t(r.matched_nights === 1 ? 'fx.matchedOne' : 'fx.matchedMany', { n: r.matched_nights }) : null].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p>{t('fx.noMatch', { q })}</p>}
      <p className="muted small">
        {t('fx.coverage', { a: data.coverage.not_placed, b: data.coverage.detail_pages_cached })}
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
  if (!REGISTRY_ID.test(id)) return <BadId />
  return <FacilityPage id={id} />
}
