import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { hourLabel, safeHttpUrl, statusInfo, statusLabel } from './format'
import { StatusIcon } from './StatusIcon'
import { DEMO_REPLAY_HREF } from './demoHref'
import { NO_FILTER, parseSpikes, spikeKey, selectRows, toCsv, type Dir, type Filters, type SortKey, type SpikeFile, type SpikeRow } from './spikes'
import { SpikeCalendar } from './SpikeCalendar'
import { Follow } from './Follow'
import { REGIONS, regionFrom, regionQuery, type RegionInfo } from './region'
import { LangSwitch, T } from './LangSwitch'
import { useLang, useT } from './useT'
import { dateLabel, type Lang } from './i18n'
import './SpikeLog.css'

// One line per status, written for this log (every spike here is past its reporting deadline).
const STATUS_NOTES = ['reported', 'reported_mismatch', 'no_report_after_deadline', 'search_incomplete'] as const

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

const PHONE = '(max-width: 639.98px)'
/** True below 640 px: rows render as cards there, so the page never scrolls sideways. One render path at a time. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(PHONE)
      mq?.addEventListener('change', cb)
      return () => mq?.removeEventListener('change', cb)
    },
    () => window.matchMedia?.(PHONE).matches ?? false,
    () => false,
  )
}

const nightHref = (region: RegionInfo, id: string) => `${import.meta.env.BASE_URL}${regionQuery(region, { night: id })}`

/** Two links, not tabs: each region is its own URL, so a filtered view of either can be shared. */
function RegionSwitch({ current }: { current: RegionInfo }) {
  const t = useT()
  return (
    <nav className="sl-region" aria-label={t('region.nav')}>
      {Object.values(REGIONS).map((r) => (
        <a key={r.key} href={`${import.meta.env.BASE_URL}${regionQuery(r, { view: 'spikes' })}`}
          aria-current={r.key === current.key ? 'page' : undefined}>{r.key === 'beaumont' ? t('region.beaumont') : r.label}</a>
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

function StatusTag({ row, lang }: { row: SpikeRow; lang: Lang }) {
  return (
    <span className="sl-status-cell">
      <span className={`sl-status sl-status-${row.status}`} lang={lang}><StatusIcon kind={statusInfo(row.status).icon} size={14} />{statusInfo(row.status)[lang]}</span>
      {row.reason && <span className="sl-reason">{row.reason}</span>}
    </span>
  )
}

/** A night with no file (no wind data) gets plain text: a link there would 404. */
function ReplayLink({ row, region, lang }: { row: SpikeRow; region: RegionInfo; lang: Lang }) {
  const t = useT()
  if (!row.night_id) return <span className="sl-noreplay">{t('spikes.noReplay')}</span>
  return (
    <a className="nowrap sl-replay" href={nightHref(region, row.night_id)}
      aria-label={t('spikes.replayAria', { date: dateLabel(row.date, lang), compound: row.compound, site: row.site })}>{t('spikes.replayLink')}</a>
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
  const t = useT()
  const lang = useLang()
  const [data, setData] = useState<SpikeFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const init = useMemo(() => readUrl(initialSite), [initialSite])
  const [filters, setFilters] = useState<Filters>(init.filters)
  const [sort, setSort] = useState<SortKey>(init.sort)
  const [dir, setDir] = useState<Dir>(init.dir)
  const region = useMemo(() => regionFrom(window.location.search), [])
  const phone = usePhone()

  useEffect(() => {
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

  useEffect(() => { document.title = t('spikes.docTitle', { place: region.place }) }, [t, region])

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
      site: [['', t('spikes.allMonitors')], ...sites.map(([v, n]) => [v, `${names.get(v)} (${n})`])] as [string, string][],
      compound: [['', t('spikes.bothCompounds')], ...compounds.map(([v, n]) => [v, `${v} (${n})`])] as [string, string][],
      status: [['', t('spikes.anyCheck')], ...statuses.map(([v, n]) => [v, `${statusInfo(v)[lang]} (${n})`])] as [string, string][],
      year: [['', t('spikes.bothYears')], ...years.map(([v, n]) => [v, `${v} (${n})`])] as [string, string][],
    }
  }, [data, t, lang])

  const rows = useMemo(() => selectRows(data?.rows ?? [], filters, sort, dir), [data, filters, sort, dir])

  const onSort = (k: SortKey) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(k); setDir('desc') }
  }
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = Object.values(filters).some(Boolean)

  const back = <a className="sl-back" href={DEMO_REPLAY_HREF}>{t('common.backReplay')}</a>
  if (error) return <main className="sl-page state-msg" role="alert"><h1>{t('common.pastSpikes')}</h1><p>{error}</p>{back}</main>
  if (!data) return <main className="sl-page state-msg"><p>{t('spikes.loading')}</p></main>

  const s = data.summary
  const reported = s.by_status.reported ?? 0
  const noReport = s.by_status.no_report_after_deadline ?? 0
  const searchPage = safeHttpUrl(data.tceq_search_page)
  const sortText = t(({ date: 'sort.date', value: 'sort.value', ratio: 'sort.ratio' } as const)[sort])
  const orderText = t(sort === 'date' ? (dir === 'asc' ? 'order.oldest' : 'order.newest') : (dir === 'asc' ? 'order.lowest' : 'order.highest'))
  return (
    <main className="sl-page">
      {back}
      <header className="sl-head">
        <LangSwitch />
        <RegionSwitch current={region} />
        <p className="sl-kicker">{t('spikes.kicker', { place: region.place })}</p>
        <h1>{t('spikes.title')}</h1>
        {!region.backtested && (
          <p className="sl-region-note" role="note"><strong>{data.region?.note ?? t('region.notBacktested')}</strong></p>
        )}
        <p className="sl-summary">
          <T k="spikes.summary" v={{ spikes: s.spikes, days: s.spike_days, reported }} />
        </p>
        <Follow siteId={filters.site || undefined} />
        <p><T k="spikes.watch" v={{ link: <a href={`${import.meta.env.BASE_URL}?view=timeline`}>{t('spikes.watchLink')}</a> }} /></p>
        <p className="sl-brief-link"><T k="spikes.brief" v={{ link: <a href={`${import.meta.env.BASE_URL}?view=brief`}>{t('spikes.briefLink')}</a> }} /></p>
      </header>

      <section className="sl-explain" aria-label={t('spikes.explain')}>
        <p><T k="spikes.what" /></p>
        <p>
          <T k="spikes.noMatch" v={{
            missed: s.known_missed_reports ? t('spikes.noMatchMissed', { k: s.known_missed_reports, n: noReport }) : '',
            search: searchPage
              ? <T k="spikes.noMatchSearch" v={{ link: <a href={searchPage} rel="noreferrer" target="_blank">{t('spikes.noMatchSearchLink')}</a> }} />
              : '',
          }} />
        </p>
        <p><T k="spikes.falseAlarm" /></p>
        <details className="sl-statuses">
          <summary>{t('spikes.statusesHelp')}</summary>
          <dl>
            {STATUS_NOTES.map((k) => (
              <div key={k}><dt><span className={`sl-status sl-status-${k}`} lang={lang}><StatusIcon kind={statusInfo(k).icon} size={14} />{statusLabel(k, lang)}</span></dt><dd>{t(`status.note.${k}`)}</dd></div>
            ))}
          </dl>
        </details>
      </section>

      <section className="sl-controls" aria-label={t('spikes.filterLabel')}>
        <div className="sl-filters">
          <Select id="sl-site" label={t('spikes.fMonitor')} value={filters.site} onChange={set('site')} options={options.site} />
          <Select id="sl-compound" label={t('spikes.fCompound')} value={filters.compound} onChange={set('compound')} options={options.compound} />
          <Select id="sl-status" label={t('spikes.fCheck')} value={filters.status} onChange={set('status')} options={options.status} />
          <Select id="sl-year" label={t('spikes.fYear')} value={filters.year} onChange={set('year')} options={options.year} />
        </div>
        {phone && (
          <div className="sl-sortbar">
            <Select id="sl-sort" label={t('spikes.sortBy')} value={sort} onChange={(v) => { setSort(v as SortKey); setDir('desc') }}
              options={[['date', t('spikes.hDate')], ['value', t('spikes.hPeak')], ['ratio', t('spikes.hRatio')]]} />
            <button type="button" className="btn sl-dir" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
              <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span> {orderText}
            </button>
          </div>
        )}
        <div className="sl-actions">
          <p className="sl-count" aria-live="polite">{t('spikes.showing', { n: rows.length, total: s.spikes })}</p>
          {filtered && <button type="button" className="btn" onClick={() => setFilters(NO_FILTER)}>{t('spikes.clear')}</button>}
          <button type="button" className="btn btn-primary" disabled={!rows.length} onClick={() => downloadCsv(rows, filters)}>
            {t('spikes.csv', { n: rows.length })}
          </button>
        </div>
      </section>

      <SpikeCalendar
        rows={rows}
        monitors={filters.site ? options.monitors.filter(([v]) => v === filters.site) : options.monitors}
        years={filters.year ? [filters.year] : options.years}
      />

      {phone ? (
        <div className="sl-cards-wrap">
          <p id="sl-caption" className="sl-cards-cap">
            {t('spikes.capSorted', { what: filtered ? t('spikes.capFiltered') : t('spikes.capMonitors', { n: options.site.length - 1 }), by: sortText, order: orderText })}
          </p>
          <ul className="sl-cards" aria-label={t('spikes.cardsLabel')}>
            {rows.map((r) => {
              const report = safeHttpUrl(r.report_url)
              return (
                <li key={spikeKey(r)} className="sl-card">
                  <div className="sl-card-top">
                    <p className="sl-card-when"><time dateTime={r.date}>{dateLabel(r.date, lang)}</time> · {hourLabel(r.hour_cst)}</p>
                    <StatusTag row={r} lang={lang} />
                  </div>
                  <p className="sl-card-where">{r.site} · {r.compound}</p>
                  <dl className="sl-card-nums">
                    <div><dt>{t('spikes.hPeak')}</dt><dd>{r.value_ppb}</dd></div>
                    <div><dt>{t('spikes.hBase')}</dt><dd>{r.baseline_ppb}</dd></div>
                    <div><dt>{t('spikes.hRatio')}</dt><dd>{r.ratio === null ? '—' : `${r.ratio}×`}</dd></div>
                  </dl>
                  {report && <a className="sl-report" href={report} rel="noreferrer" target="_blank">{t('spikes.tceqReport', { id: r.matched_incident ?? '' })}</a>}
                  <div className="sl-card-replay"><ReplayLink row={r} region={region} lang={lang} /></div>
                </li>
              )
            })}
          </ul>
          {!rows.length && <p className="sl-empty">{t('spikes.empty')}</p>}
        </div>
      ) : (
      <div className="sl-table-wrap" tabIndex={0} role="region" aria-labelledby="sl-caption">
        <table className="sl-table">
          <caption id="sl-caption">
            {t('spikes.capSorted', { what: filtered ? t('spikes.capFiltered') : t('spikes.capMonitors', { n: options.site.length - 1 }), by: sortText, order: orderText })}
          </caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('date', sort, dir)}><SortButton k="date" label={t('spikes.hDate')} sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col">{t('spikes.hHour')}</th>
              <th scope="col">{t('spikes.hMonitor')}</th>
              <th scope="col">{t('spikes.hCompound')}</th>
              <th scope="col" className="num" aria-sort={ariaSort('value', sort, dir)}><SortButton k="value" label={t('spikes.hPeak')} sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col" className="num">{t('spikes.hBase')}</th>
              <th scope="col" className="num" aria-sort={ariaSort('ratio', sort, dir)}><SortButton k="ratio" label={t('spikes.hRatio')} sort={sort} dir={dir} onSort={onSort} /></th>
              <th scope="col">{t('spikes.hCheck')}</th>
              <th scope="col">{t('spikes.hReplay')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const report = safeHttpUrl(r.report_url)
              return (
                <tr key={spikeKey(r)}>
                  <th scope="row" className="nowrap"><time dateTime={r.date}>{dateLabel(r.date, lang)}</time></th>
                  <td className="nowrap">{hourLabel(r.hour_cst)}</td>
                  <td>{r.site}</td>
                  <td className="nowrap">{r.compound}</td>
                  <td className="num">{r.value_ppb}</td>
                  <td className="num">{r.baseline_ppb}</td>
                  <td className="num">{r.ratio === null ? '—' : `${r.ratio}×`}</td>
                  <td>
                    <StatusTag row={r} lang={lang} />
                    {report && <a className="sl-report" href={report} rel="noreferrer" target="_blank">{t('spikes.tceqReport', { id: r.matched_incident ?? '' })}</a>}
                  </td>
                  <td>
                    <ReplayLink row={r} region={region} lang={lang} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <p className="sl-empty">{t('spikes.empty')}</p>}
      </div>
      )}
      <p className="sl-foot">
        <T k="spikes.source" v={{ via: t(region.backtested ? 'spikes.srcBacktest' : 'spikes.srcScan'), code: <code>pipeline/spikes.py</code> }} />
      </p>
    </main>
  )
}
