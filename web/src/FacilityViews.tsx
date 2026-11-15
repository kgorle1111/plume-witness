import { useEffect, useMemo, useState } from 'react'
import { SiteFooter } from './SiteFooter'
import {
  REGISTRY_ID, facilitiesHref, facilityHref, lbs, localTime, parseFacility, parseIndex, searchFacilities,
  type FacilityFile, type FacilityIndex,
} from './facilities'
import { hourLabel, safeHttpUrl } from './format'
import { DEMO_REPLAY_HREF } from './demoHref'
import './Facilities.css'

const BASE = import.meta.env.BASE_URL
const UPWIND_NOTE = 'Being upwind of a spike is not evidence of anything; wind at one monitor cannot tell facilities apart.'

function useJson<T>(file: string, parse: (raw: unknown) => T): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${BASE}${file}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'No history page exists for that facility id.' : `Could not load ${file} (HTTP ${r.status}).`)
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
  return (
    <div className="fx-shell">
      <main className="fx-page">
        <a className="fx-back" href={DEMO_REPLAY_HREF}>Back to the replay</a>
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
  return <Shell kicker="Plume Witness" title={title}><p role="alert">{text}</p><p><a href={facilitiesHref(BASE)}>Search all facilities</a></p></Shell>
}

function Report({ r }: { r: FacilityFile['reports_to_state']['reports'][number] }) {
  const url = safeHttpUrl(r.url)
  return (
    <li className="fx-card">
      <p className="fx-card-head">
        {url ? <a href={url} rel="noopener" target="_blank">TCEQ record {r.incident}</a> : <span>TCEQ record {r.incident}</span>}
        <span className="muted small">{r.event_type}</span>
      </p>
      <p className="small"><time dateTime={r.start_local}>{localTime(r.start_local)}</time> to <time dateTime={r.end_local}>{localTime(r.end_local)}</time> (local time at the facility)</p>
      <dl className="fx-facts">
        <div><dt>Benzene</dt><dd>{r.benzene_lbs > 0 ? lbs(r.benzene_lbs) : 'not listed'}</dd></div>
        <div><dt>1,3-butadiene</dt><dd>{r.butadiene_lbs > 0 ? lbs(r.butadiene_lbs) : 'not listed'}</dd></div>
      </dl>
      <p className="small"><span className="muted">Cause, as the facility wrote it: </span>{r.cause_excerpt}</p>
    </li>
  )
}

function TriTable({ f }: { f: FacilityFile }) {
  const years = Object.keys(f.reports_to_epa.years).sort()
  if (!years.length) {
    return <p className="small">{f.reports_to_epa.reason ?? 'No TRI figures for benzene or 1,3-butadiene, 2020-2024.'}</p>
  }
  const rows = years.flatMap((y) => Object.entries(f.reports_to_epa.years[y]).map(([compound, v]) => ({ y, compound, v })))
  return (
    <div className="fx-scroll">
      <table className="fx-table">
        <caption className="sr-only">TRI air releases by year, in pounds</caption>
        <thead><tr><th scope="col">Year</th><th scope="col">Compound</th><th scope="col" className="num">Stack</th><th scope="col" className="num">Fugitive</th><th scope="col" className="num">Total</th></tr></thead>
        <tbody>
          {rows.map(({ y, compound, v }) => (
            <tr key={`${y}-${compound}`}>
              <th scope="row">{y}</th><td>{compound === 'butadiene' ? '1,3-butadiene' : compound}</td>
              <td className="num">{lbs(v.stack_lbs)}</td><td className="num">{lbs(v.fugitive_lbs)}</td><td className="num">{lbs(v.total_lbs)}</td>
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
  const { data: f, error } = useJson(`facilities/${id}.json`, (raw) => parseFacility(raw, id))
  useEffect(() => { if (f) document.title = `${f.name}: facility history | Plume Witness` }, [f])
  if (error) return <Message title="Facility not found" text={error} />
  if (!f) return <main className="state-msg"><p>Loading facility…</p></main>
  const echo = safeHttpUrl(f.echo_url)
  const n = f.reports_to_state.count
  const cite = `Plume Witness, facility history for ${f.name} (EPA registry ${f.registry_id}), ${window.location.origin}${window.location.pathname}?view=facility&id=${f.registry_id}. Compiled from TCEQ STEERS and EPA TRI/ECHO public records.`
  return (
    <Shell kicker="Facility history" title={f.name}>
      <p className="fx-sub">{f.address} · {f.distance_km} km from the {f.nearest_monitor} monitor · {echo && <a href={echo} rel="noopener" target="_blank">EPA ECHO record</a>}</p>
      <p className="fx-note" role="note">{UPWIND_NOTE} This page lists only what the facility reported and the nights where its own report matched.</p>

      <section aria-labelledby="fx-state">
        <h2 id="fx-state">Reported to the state, 2024-2025 ({n})</h2>
        {n === 0
          ? <p className="small">No report for this facility appears in the TCEQ pages this site has cached. That is a statement about the cache, not about the facility.</p>
          : <ul className="fx-list">{f.reports_to_state.reports.map((r) => <Report key={r.incident} r={r} />)}</ul>}
        <p className="muted small">Source: TCEQ Air Emission Event Report Database (STEERS). Amounts are the facility's own estimates, as listed on each record.</p>
      </section>

      <section aria-labelledby="fx-epa">
        <h2 id="fx-epa">Reports to EPA (TRI), 2020-2024</h2>
        <TriTable f={f} />
        <p className="muted small">{f.reports_to_epa.note} Annual routine-release estimates; context only.</p>
      </section>

      <section aria-labelledby="fx-nights">
        <h2 id="fx-nights">Replayed nights where its own report matched ({f.matched_nights.length})</h2>
        {f.matched_nights.length === 0
          ? <p className="small">None among the replayed nights.</p>
          : (
            <ul className="fx-list">
              {f.matched_nights.map((m) => (
                <li key={m.night_id} className="fx-card">
                  <p className="fx-night-link"><a href={`${BASE}?night=${encodeURIComponent(m.night_id)}`}>{m.date}: replay this night</a></p>
                  <p className="small">{m.compound} at {m.monitor}, {hourLabel(m.hour_cst)}, {m.value_ppb} ppb. The facility was {m.distance_km} km away in the upwind corridor, and its report <IncidentLink f={f} incident={m.incident} /> matched.</p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="fx-cite">
        <h2 id="fx-cite">Cite this page</h2>
        <p className="small fx-cite">{cite}</p>
        <p className="small"><a href={`${BASE}facilities/${f.registry_id}.json`}>This page as JSON</a> · <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">Field definitions</a></p>
      </section>
    </Shell>
  )
}

function FacilityList() {
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
  if (error) return <Message title="Facilities" text={error} />
  if (!data) return <main className="state-msg"><p>Loading facilities…</p></main>
  return (
    <Shell kicker="Facilities" title="Facilities near the Ship Channel monitors">
      <p className="fx-note" role="note">{UPWIND_NOTE}</p>
      <p className="small">{data.facilities.length} EPA "Major Emissions" air facilities within 15 km of a state monitor. Each page lists what the facility reported to TCEQ and to EPA.</p>
      <div className="fx-search">
        <label htmlFor="fx-q">Search by name, address or EPA registry id</label>
        <input id="fx-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <p role="status" className="muted small">{rows.length} of {data.facilities.length} shown</p>
      </div>
      <ul className="fx-list fx-rows">
        {rows.map((r) => (
          <li key={r.id} className="fx-card">
            <a href={facilityHref(r.id, BASE)}>{r.name}</a>
            <span className="small muted">{r.address} · {r.distance_km} km from {r.nearest_monitor}</span>
            <span className="small">{r.reports} report{r.reports === 1 ? '' : 's'} to the state, 2024-2025 · TRI data {r.tri_years ? `${r.tri_years} yr` : 'none'}{r.matched_nights ? ` · ${r.matched_nights} matched night${r.matched_nights === 1 ? '' : 's'}` : ''}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p>No facility matches "{q}".</p>}
      <p className="muted small">
        {data.coverage.not_placed} of {data.coverage.detail_pages_cached} cached TCEQ reports could not be tied to one EPA facility and appear on no page.
      </p>
    </Shell>
  )
}

export default function FacilityViews({ view }: { view: 'facility' | 'facilities' }) {
  if (view === 'facilities') return <FacilityList />
  const id = new URLSearchParams(window.location.search).get('id') ?? ''
  if (!REGISTRY_ID.test(id)) return <Message title="Facility not found" text="That is not an EPA registry id (12 digits)." />
  return <FacilityPage id={id} />
}
