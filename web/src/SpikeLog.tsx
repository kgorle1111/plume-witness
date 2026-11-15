import { useEffect, useMemo, useState } from 'react'
import { hourLabel, safeHttpUrl, statusInfo } from './format'
import { DEMO_REPLAY_HREF } from './demoHref'
import { NO_FILTER, dateText, parseSpikes, selectRows, toCsv, type Dir, type Filters, type SortKey, type SpikeFile, type SpikeRow } from './spikes'
import { SpikeCalendar } from './SpikeCalendar'
import { Follow } from './Follow'
import { NOT_BACKTESTED_NOTE, REGIONS, regionFrom, regionQuery, type RegionInfo } from './region'
import './SpikeLog.css'

// One line per status, written for this log (every spike here is past its reporting deadline).
const STATUS_NOTE: Record<string, string> = {
  reported: 'A company report from the upwind area lists this compound and starts near the spike hour.',
  reported_mismatch: 'A report exists for that day, but its compound, place or time does not line up with this spike.',
  no_report_after_deadline: 'We found no matching company report. That is a question to ask, not a finding.',
  search_incomplete: 'The record check could not finish (the row says why), so the tool says nothing either way.',
}

function readUrl(initialSite?: string): { filters: Filters; sort: SortKey; dir: Dir } {
  const q = new URLSearchParams(window.location.search)
  const sort = (['date', 'value', 'ratio'] as const).find((k) => k === q.get('sort')) ?? 'date'
  return {
    filters: { site: initialSite ?? q.get('site') ?? '', compound: q.get('compound') ?? '', status: q.get('status') ?? '', year: q.get('year') ?? '' },
    sort,
    dir: q.get('dir') === 'asc' ? 'asc' : 'desc',
  }
}

/** Keeps the filtered view shareable: a reporter can paste the URL and get the same rows. */
function writeUrl(f: Filters, sort: SortKey, dir: Dir) {
  const q = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries({ ...f, sort: sort === 'date' ? '' : sort, dir: dir === 'desc' ? '' : dir })) {
    if (v) q.set(k, v)
    else q.delete(k)
  }
  history.replaceState(null, '', `${window.location.pathname}?${q.toString()}${window.location.hash}`)
}

const nightHref = (region: RegionInfo, id: string) => `${import.meta.env.BASE_URL}${regionQuery(region, { night: id })}`

/** Two links, not tabs: each region is its own URL, so a filtered view of either can be shared. */
function RegionSwitch({ current }: { current: RegionInfo }) {
  return (
    <nav className="sl-region" aria-label="Region">
      {Object.values(REGIONS).map((r) => (
        <a key={r.key} href={`${import.meta.env.BASE_URL}${regionQuery(r, { view: 'spikes' })}`}
          aria-current={r.key === current.key ? 'page' : undefined}>{r.label}</a>
      ))}
    </nav>
  )
}

function downloadCsv(rows: SpikeRow[], f: Filters) {
  const parts = ['plume-witness-spikes', f.year, f.site, f.compound && f.compound.replace(/[^a-z0-9]+/gi, ''), f.status].filter(Boolean)
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${parts.join('_')}.csv`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function StatusTag({ row }: { row: SpikeRow }) {
  return (
    <span className="sl-status-cell">
      <span className={`sl-status sl-status-${row.status}`}>{statusInfo(row.status).en}</span>
      {row.reason && <span className="sl-reason">{row.reason}</span>}
    </span>
  )
}

function SortButton({ k, label, sort, dir, onSort }: { k: SortKey; label: string; sort: SortKey; dir: Dir; onSort: (k: SortKey) => void }) {
  const active = sort === k
  return (
    <button type="button" className="sl-sort" onClick={() => onSort(k)}>
      {label}
      <span aria-hidden="true" className="sl-sort-mark">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  )
}

const ariaSort = (k: SortKey, sort: SortKey, dir: Dir) => (sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none')

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]
}) {
  return (
    <div className="sl-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>
  )
}

export default function SpikeLog({ initialSite }: { initialSite?: string }) {
  const [data, setData] = useState<SpikeFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const init = useMemo(() => readUrl(initialSite), [initialSite])
  const [filters, setFilters] = useState<Filters>(init.filters)
  const [sort, setSort] = useState<SortKey>(init.sort)
  const [dir, setDir] = useState<Dir>(init.dir)
  const region = useMemo(() => regionFrom(window.location.search), [])

  useEffect(() => {
    document.title = `Past spikes · ${region.place} · Plume Witness`
    const ctrl = new AbortController()
    const file = `${region.dir}spikes.json`
    fetch(`${import.meta.env.BASE_URL}${file}`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${file} (HTTP ${r.status}). Check that web/public/${file} exists.`)
        return r.json()
      })
      .then((raw) => setData(parseSpikes(raw)))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [region])

  useEffect(() => writeUrl(filters, sort, dir), [filters, sort, dir])

  const options = useMemo(() => {
    const rows = data?.rows ?? []
    const count = (pick: (r: SpikeRow) => string) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1)
      return m
    }
    const names = new Map(rows.map((r) => [r.site_id, r.site]))
    const sites = [...count((r) => r.site_id)].sort((a, b) => names.get(a[0])!.localeCompare(names.get(b[0])!))
    const compounds = [...count((r) => r.compound)].sort()
    const statuses = [...count((r) => r.status)].sort((a, b) => b[1] - a[1])
    const years = [...count((r) => r.date.slice(0, 4))].sort()
    return {
      monitors: sites.map(([v]) => [v, names.get(v)!]) as [string, string][],
      years: years.map(([v]) => v),
      site: [['', 'All monitors'], ...sites.map(([v, n]) => [v, `${names.get(v)} (${n})`])] as [string, string][],
      compound: [['', 'Both compounds'], ...compounds.map(([v, n]) => [v, `${v} (${n})`])] as [string, string][],
      status: [['', 'Any record check'], ...statuses.map(([v, n]) => [v, `${statusInfo(v).en} (${n})`])] as [string, string][],
      year: [['', '2024 and 2025'], ...years.map(([v, n]) => [v, `${v} (${n})`])] as [string, string][],
    }
  }, [data])

  const rows = useMemo(() => selectRows(data?.rows ?? [], filters, sort, dir), [data, filters, sort, dir])

  const onSort = (k: SortKey) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(k); setDir('desc') }
  }
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = Object.values(filters).some(Boolean)

  const back = <a className="sl-back" href={DEMO_REPLAY_HREF}>← Back to the event replay</a>
  if (error) return <main className="sl-page state-msg" role="alert"><h1>Past spikes</h1><p>{error}</p>{back}</main>
  if (!data) return <main className="sl-page state-msg"><p>Loading the spike log…</p></main>

  const s = data.summary
  const reported = s.by_status.reported ?? 0
  const noReport = s.by_status.no_report_after_deadline ?? 0
  const searchPage = safeHttpUrl(data.tceq_search_page)
  const sortText = { date: 'date', value: 'peak value', ratio: 'times baseline' }[sort]
  return (
    <main className="sl-page">
      {back}
      <header className="sl-head">
        <RegionSwitch current={region} />
        <p className="sl-kicker">Plume Witness · {region.place} monitors</p>
        <h1>Past spikes, 2024–2025</h1>
        {!region.backtested && (
          <p className="sl-region-note" role="note"><strong>{data.region?.note ?? NOT_BACKTESTED_NOTE}</strong></p>
        )}
        <p className="sl-summary">
          <strong>{s.spikes} spikes on {s.spike_days} days</strong>; {reported} with a matching company report.
        </p>
        <Follow siteId={filters.site || undefined} />
        <p><a href={`${import.meta.env.BASE_URL}?view=timeline`}>Watch two years</a> of spikes arrive on the map, in time order.</p>
        <p><a href={`${import.meta.env.BASE_URL}?view=brief`}>Read the 2-page method brief (printable)</a>: what these monitors can and cannot check.</p>
      </header>

      <section className="sl-explain" aria-label="How to read this log">
        <p>
          <strong>What a spike is.</strong> An hour when a state air monitor read benzene or 1,3-butadiene at or above
          10 times its own 7-day median and at least 10 ppb. There is one row per day and compound; it shows the
          first monitor and hour (CST) that crossed the line.
        </p>
        <p>
          <strong>“No matching report” is a question, not a finding.</strong> It means the tool found no company
          emissions-event report in the state’s public record (TCEQ) that lines up with the spike and the upwind area. The
          source may not have to report (traffic, a ship, a monitor fault), a report may sit outside our search, or the
          tool may have missed it
          {s.known_missed_reports ? <>: in our own check against the reports we know of, {s.known_missed_reports} of {noReport} such rows had a company report from inside the upwind area</> : null}.
          {searchPage && <> You can search the record yourself at <a href={searchPage} rel="noreferrer" target="_blank">TCEQ’s emissions-event search</a>.</>}
        </p>
        <p>
          <strong>Not measured: the false-alarm rate.</strong> We have not checked how many spikes are instrument faults or
          non-industrial sources. TCEQ labels these hourly readings provisional; they can change.
        </p>
        <details className="sl-statuses">
          <summary>What each record-check result means</summary>
          <dl>
            {Object.entries(STATUS_NOTE).map(([k, t]) => (
              <div key={k}><dt><span className={`sl-status sl-status-${k}`}>{statusInfo(k).en}</span></dt><dd>{t}</dd></div>
            ))}
          </dl>
        </details>
      </section>

      <section className="sl-controls" aria-label="Filter and download">
        <div className="sl-filters">
          <Select id="sl-site" label="Monitor" value={filters.site} onChange={set('site')} options={options.site} />
          <Select id="sl-compound" label="Compound" value={filters.compound} onChange={set('compound')} options={options.compound} />
          <Select id="sl-status" label="Record check" value={filters.status} onChange={set('status')} options={options.status} />
          <Select id="sl-year" label="Year" value={filters.year} onChange={set('year')} options={options.year} />
        </div>
        <div className="sl-actions">
          <p className="sl-count" aria-live="polite">Showing {rows.length} of {s.spikes} spikes</p>
          {filtered && <button type="button" className="btn" onClick={() => setFilters(NO_FILTER)}>Clear filters</button>}
          <button type="button" className="btn btn-primary" disabled={!rows.length} onClick={() => downloadCsv(rows, filters)}>
            Download CSV ({rows.length} rows)
          </button>
        </div>
      </section>

      <SpikeCalendar
        rows={rows}
        monitors={filters.site ? options.monitors.filter(([v]) => v === filters.site) : options.monitors}
        years={filters.year ? [filters.year] : options.years}
      />

      <div className="sl-table-wrap" tabIndex={0} role="region" aria-labelledby="sl-caption">
        <table className="sl-table">
          <caption id="sl-caption">
            Spikes {filtered ? 'matching the filters' : `at ${options.site.length - 1} monitors`}, sorted by {sortText}, {sort === 'date' ? (dir === 'asc' ? 'oldest' : 'newest') : (dir === 'asc' ? 'lowest' : 'highest')} first
          </caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('date', sort, dir)}><SortButton k="date" label="Date" sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col">Hour</th>
              <th scope="col">Monitor</th>
              <th scope="col">Compound</th>
              <th scope="col" className="num" aria-sort={ariaSort('value', sort, dir)}><SortButton k="value" label="Peak (ppb)" sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col" className="num">Baseline (ppb)</th>
              <th scope="col" className="num" aria-sort={ariaSort('ratio', sort, dir)}><SortButton k="ratio" label="× baseline" sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col">Record check</th>
              <th scope="col">Replay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const report = safeHttpUrl(r.report_url)
              return (
                <tr key={r.night_id}>
                  <th scope="row" className="nowrap"><time dateTime={r.date}>{dateText(r.date)}</time></th>
                  <td className="nowrap">{hourLabel(r.hour_cst)}</td>
                  <td>{r.site}</td>
                  <td className="nowrap">{r.compound}</td>
                  <td className="num">{r.value_ppb}</td>
                  <td className="num">{r.baseline_ppb}</td>
                  <td className="num">{r.ratio === null ? '—' : `${r.ratio}×`}</td>
                  <td>
                    <StatusTag row={r} />
                    {report && <a className="sl-report" href={report} rel="noreferrer" target="_blank">TCEQ report {r.matched_incident}</a>}
                  </td>
                  <td>
                    <a className="nowrap" href={nightHref(region, r.night_id)} aria-label={`Replay ${dateText(r.date)}, ${r.compound} at ${r.site}`}>Replay this night</a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <p className="sl-empty">No spikes match these filters.</p>}
      </div>
      <p className="sl-foot">
        Source: TCEQ AutoGC hourly data and STEERS emissions-event reports, via the Plume Witness
        {region.backtested ? ' backtest' : ' spike scan (this region has no backtest)'} (<code>pipeline/spikes.py</code>).
        Rows list monitors, never facilities.
      </p>
    </main>
  )
}
