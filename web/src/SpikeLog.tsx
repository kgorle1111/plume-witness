import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { hourLabel, safeHttpUrl, statusInfo, statusLabel } from './format'
import { StatusIcon } from './StatusIcon'
import {
  NO_FILTER, PAGE_SIZE, REASON_CODE_KEYS, cleanFilters, countKey, logView, optionCounts, parseSpikes, parseSpot, reasonInLabel, reasonKey, rowStatusLabel, spikeKey, toCsv, yearSpan,
  type Dir, type Filters, type SortKey, type SpikeFile, type SpikeRow,
} from './spikes'
import { SpikeCalendar } from './SpikeCalendar'
import { Follow } from './Follow'
import { NeighborhoodPicks } from './NeighborhoodPicks'
import { DEFAULT_REGION, REGIONS, compoundLabel, regionFrom, regionLabel, regionQuery, type RegionInfo } from './region'
import { T } from './LangSwitch'
import { navHref, replayHref } from './routes'
import { useLang, useT } from './useT'
import { dateLabel, type Lang, type StringKey } from './i18n'
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

// intro=0: a row opens its night flat; the globe fly-in on every row cost about 9 MB of tiles (PERF-04).
const nightHref = (region: RegionInfo, id: string) => `${import.meta.env.BASE_URL}${regionQuery(region, { night: id, intro: '0' })}`

// Where the list was when a night was opened, so Back returns to the same row (a phone lost about 1,750 px).
const SPOT_KEY = 'pw-spikes-spot'
function saveSpot(limit: number) {
  try {
    sessionStorage.setItem(SPOT_KEY, JSON.stringify({ search: window.location.search, limit, y: Math.round(window.scrollY) }))
  } catch { /* storage blocked: Back starts at the top, as before */ }
}
function takeSpot() {
  try {
    const raw = sessionStorage.getItem(SPOT_KEY)
    sessionStorage.removeItem(SPOT_KEY)
    return parseSpot(raw, window.location.search)
  } catch {
    return null
  }
}

type LoadError = { key: 'spikes.errNetwork' | 'spikes.errData' } | { key: 'spikes.errHttp'; status: number }
class HttpError extends Error {
  readonly status: number
  constructor(status: number, file: string) {
    super(`Could not load ${file} (HTTP ${status})`)
    this.status = status
  }
}

/** Links, not tabs: each region is its own URL, so a filtered view of any of them can be shared. */
function RegionSwitch({ current }: { current: RegionInfo }) {
  const t = useT()
  const lang = useLang()
  return (
    <nav className="sl-region" aria-label={t('region.nav')}>
      {Object.values(REGIONS).map((r) => (
        <a key={r.key} href={`${import.meta.env.BASE_URL}${regionQuery(r, { view: 'spikes' })}`}
          aria-current={r.key === current.key ? 'page' : undefined}>{regionLabel(lang, r)}</a>
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

/** The row's reason in the reader's language; one the string table does not know stays as written, marked English. */
function Reason({ row }: { row: Pick<SpikeRow, 'reason' | 'reason_code'> }) {
  const t = useT()
  const k = reasonKey(row)
  if (k) return <span className="sl-reason">{t(k)}</span>
  return row.reason ? <span className="sl-reason" lang="en">{row.reason}</span> : null
}

function StatusTag({ row, lang }: { row: SpikeRow; lang: Lang }) {
  return (
    <span className="sl-status-cell">
      <span className={`sl-status sl-status-${row.status}`} lang={lang}><StatusIcon kind={statusInfo(row.status).icon} size={14} />{rowStatusLabel(row, lang)}</span>
      {!reasonInLabel(row) && <Reason row={row} />}
    </span>
  )
}

/** A night with no file (no wind data) gets plain text: a link there would 404. */
function ReplayLink({ row, region, lang, onOpen }: { row: SpikeRow; region: RegionInfo; lang: Lang; onOpen: () => void }) {
  const t = useT()
  if (!row.night_id) return <span className="sl-noreplay">{t('spikes.noReplay')}</span>
  return (
    <a className="nowrap sl-replay" href={nightHref(region, row.night_id)} onClick={onOpen}
      aria-label={t('spikes.replayAria', { date: dateLabel(row.date, lang), compound: compoundLabel(lang, row.compound), site: row.site })}>{t('spikes.replayLink')}</a>
  )
}

interface RowProps { r: SpikeRow; i: number; region: RegionInfo; lang: Lang; onOpen: () => void }

// memo: "Show all", a sort or "Show more" re-renders the list; rows already drawn keep their DOM (PERF-10).
const Card = memo(function Card({ r, i, region, lang, onOpen }: RowProps) {
  const t = useT()
  const report = safeHttpUrl(r.report_url)
  return (
    <li className="sl-card" data-row={i} tabIndex={-1}>
      <div className="sl-card-top">
        <p className="sl-card-when"><time dateTime={r.date}>{dateLabel(r.date, lang)}</time> · {hourLabel(r.hour_cst)}</p>
        <StatusTag row={r} lang={lang} />
      </div>
      <p className="sl-card-where">{r.site} · {compoundLabel(lang, r.compound)}</p>
      <dl className="sl-card-nums">
        <div><dt>{t('spikes.hPeak')}</dt><dd>{r.value_ppb}</dd></div>
        <div><dt>{t('spikes.hBase')}</dt><dd>{r.baseline_ppb}</dd></div>
        <div><dt>{t('spikes.hRatio')}</dt><dd>{r.ratio === null ? '—' : `${r.ratio}×`}</dd></div>
      </dl>
      {report && <a className="sl-report" href={report} rel="noreferrer" target="_blank">{t('spikes.tceqReport', { id: r.matched_incident ?? '' })}</a>}
      <div className="sl-card-replay"><ReplayLink row={r} region={region} lang={lang} onOpen={onOpen} /></div>
    </li>
  )
})

const Row = memo(function Row({ r, i, region, lang, onOpen }: RowProps) {
  const t = useT()
  const report = safeHttpUrl(r.report_url)
  return (
    <tr data-row={i} tabIndex={-1}>
      <th scope="row" className="nowrap"><time dateTime={r.date}>{dateLabel(r.date, lang)}</time></th>
      <td className="nowrap">{hourLabel(r.hour_cst)}</td>
      <td>{r.site}</td>
      <td className="nowrap">{compoundLabel(lang, r.compound)}</td>
      <td className="num">{r.value_ppb}</td>
      <td className="num">{r.baseline_ppb}</td>
      <td className="num">{r.ratio === null ? '—' : `${r.ratio}×`}</td>
      <td>
        <StatusTag row={r} lang={lang} />
        {report && <a className="sl-report" href={report} rel="noreferrer" target="_blank">{t('spikes.tceqReport', { id: r.matched_incident ?? '' })}</a>}
      </td>
      <td>
        <ReplayLink row={r} region={region} lang={lang} onOpen={onOpen} />
      </td>
    </tr>
  )
})

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
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string, boolean?][]
}) {
  return (
    <div className="sl-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t, off]) => <option key={v} value={v} disabled={off}>{t}</option>)}
      </select>
    </div>
  )
}

const FIELD_LABEL: Record<keyof Filters, StringKey> = { site: 'spikes.fMonitor', compound: 'spikes.fCompound', status: 'spikes.fCheck', year: 'spikes.fYear' }

export default function SpikeLog({ initialSite }: { initialSite?: string }) {
  const t = useT()
  const lang = useLang()
  const [data, setData] = useState<SpikeFile | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const init = useMemo(() => readUrl(initialSite), [initialSite])
  const [filters, setFilters] = useState<Filters>(init.filters)
  // The page size resets when the filters change (a new list starts at its top) but not on a re-sort.
  const filterKey = JSON.stringify(filters)
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE_SIZE })
  const [dropped, setDropped] = useState<(keyof Filters)[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>(init.sort)
  const [dir, setDir] = useState<Dir>(init.dir)
  const region = useMemo(() => regionFrom(window.location.search), [])
  const phone = usePhone()
  const restoreY = useRef<number | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const file = `${region.dir}spikes.json`
    fetch(`${import.meta.env.BASE_URL}${file}`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new HttpError(r.status, file)
        return r.json().catch(() => { throw new SyntaxError(`${file} is not JSON`) })
      })
      .then((raw) => {
        const parsed = parseSpikes(raw)
        // Controls are not drawn until the file loads, so the filters here are still the link's own.
        const c = cleanFilters(parsed.rows, init.filters)
        // Back from a night: draw as many rows as were shown, then (effect below) return to the same scroll position.
        const back = takeSpot()
        if (back) {
          setPaging({ key: JSON.stringify(c.filters), limit: back.limit })
          restoreY.current = back.y
        }
        setFilters(c.filters)
        setDropped(c.dropped)
        setData(parsed)
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        // The reader gets a plain sentence and a retry; the technical detail goes to the console.
        console.error('Past spikes:', e)
        setError(e instanceof HttpError ? { key: 'spikes.errHttp', status: e.status } : e instanceof TypeError ? { key: 'spikes.errNetwork' } : { key: 'spikes.errData' })
      })
    return () => ctrl.abort()
  }, [region, init, attempt])

  useEffect(() => { document.title = t('spikes.docTitle', { place: region.place }) }, [t, region])

  useEffect(() => writeUrl(filters, sort, dir), [filters, sort, dir])

  // Option order comes from the whole file (stable while filtering); the counts follow the other filters, so an
  // option that would give 0 rows says (0) and is disabled unless it is the current choice.
  const order = useMemo(() => {
    const rows = data?.rows ?? []
    const all = optionCounts(rows, NO_FILTER, 'status')
    const names = new Map(rows.map((r) => [r.site_id, r.site]))
    return {
      names,
      sites: [...names.keys()].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!)),
      compounds: [...new Set(rows.map((r) => r.compound))].sort(),
      statuses: [...all].sort((a, b) => b[1] - a[1]).map(([v]) => v),
      years: [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort(),
    }
  }, [data])
  const options = useMemo(() => {
    const rows = data?.rows ?? []
    const opts = (k: keyof Filters, values: string[], any: string, label: (v: string) => string): [string, string, boolean?][] => {
      const n = optionCounts(rows, filters, k)
      return [['', any], ...values.map((v): [string, string, boolean] => [v, `${label(v)} (${n.get(v) ?? 0})`, !n.get(v) && v !== filters[k]])]
    }
    return {
      monitors: order.sites.map((v) => [v, order.names.get(v)!]) as [string, string][],
      site: opts('site', order.sites, t('spikes.allMonitors'), (v) => order.names.get(v)!),
      compound: opts('compound', order.compounds, t('spikes.bothCompounds'), (v) => compoundLabel(lang, v)),
      status: opts('status', order.statuses, t('spikes.anyCheck'), (v) => statusInfo(v)[lang]),
      year: opts('year', order.years, t('spikes.bothYears'), (v) => v),
    }
  }, [data, order, filters, t, lang])

  const limit = paging.key === filterKey ? paging.limit : PAGE_SIZE
  const view = useMemo(() => logView(data?.rows ?? [], filters, sort, dir, limit), [data, filters, sort, dir, limit])
  const rows = view.rows
  const listRef = useRef<HTMLDivElement>(null)
  const focusRow = useRef<number | null>(null)
  const showMore = (n: number) => {
    focusRow.current = view.shown.length
    startTransition(() => setPaging({ key: filterKey, limit: view.shown.length + n }))
  }
  // Keyboard and screen-reader users land on the first row "Show more" added, not back at the button below it.
  useEffect(() => {
    const i = focusRow.current
    if (i === null) return
    focusRow.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)?.focus()
  }, [view.shown.length])

  useEffect(() => {
    if (!data || restoreY.current === null) return
    window.scrollTo(0, restoreY.current)
    restoreY.current = null
  }, [data])
  // Reads the drawn row count from the list, so the callback stays stable and memoized rows do not re-render.
  const onOpenNight = useCallback(() => saveSpot(listRef.current?.querySelectorAll('[data-row]').length ?? PAGE_SIZE), [])
  // A page restored from the back/forward cache keeps its own scroll; drop the saved spot so a later reload starts fresh.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) takeSpot() }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const onSort = (k: SortKey) => startTransition(() => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(k); setDir('desc') }
  })
  const set = (k: keyof Filters) => (v: string) => {
    setDropped([])
    if (k === 'site') setPicked(null)
    setFilters((f) => ({ ...f, [k]: v }))
  }
  const filtered = Object.values(filters).some(Boolean)
  const clearFilters = () => {
    setDropped([])
    setPicked(null)
    setFilters(NO_FILTER)
    // The button removes itself; focus goes to the first filter instead of falling to <body>.
    document.getElementById('sl-site')?.focus()
  }

  const back = <a className="sl-back" href={replayHref(import.meta.env.BASE_URL, window.location.search)}>{t('common.backReplay')}</a>
  if (error) {
    return (
      <main className="sl-page state-msg sl-loading">
        <div className="sl-error" role="alert">
          <h1>{t('common.pastSpikes')}</h1>
          <p>{error.key === 'spikes.errHttp' ? t(error.key, { status: error.status }) : t(error.key)}</p>
        </div>
        <button type="button" className="btn sl-retry" onClick={() => { setError(null); setAttempt((a) => a + 1) }}>{t('spikes.retry')}</button>
        {back}
      </main>
    )
  }
  if (!data) return <main className="sl-page state-msg sl-loading" aria-busy="true"><p>{t('spikes.loading')}</p></main>

  const s = data.summary
  const reported = s.by_status.reported ?? 0
  const noReport = s.by_status.no_report_after_deadline ?? 0
  const searchPage = safeHttpUrl(data.tceq_search_page)
  const sortText = t(({ date: 'sort.date', value: 'sort.value', ratio: 'sort.ratio' } as const)[sort])
  const orderText = t(sort === 'date' ? (dir === 'asc' ? 'order.oldest' : 'order.newest') : (dir === 'asc' ? 'order.lowest' : 'order.highest'))
  const caption = t('spikes.capSorted', { what: filtered ? t('spikes.capFiltered') : t('spikes.capMonitors', { n: order.sites.length }), by: sortText, order: orderText })
  const empty = !rows.length
  const count = countKey(data.rows.length, rows.length, filtered)
  const calendar = !empty && (
    <SpikeCalendar
      rows={rows}
      monitors={filters.site ? options.monitors.filter(([v]) => v === filters.site) : options.monitors}
      years={filters.year ? [filters.year] : order.years}
      onOpen={(id) => { onOpenNight(); window.location.assign(nightHref(region, id)) }}
    />
  )
  const list = !empty && (phone ? (
    <div className="sl-cards-wrap" ref={listRef}>
      <h2 className="sr-only">{t('spikes.hList')}</h2>
      <p id="sl-caption" className="sl-cards-cap">{caption}</p>
      <ul className="sl-cards" aria-label={t('spikes.cardsLabel')}>
        {view.shown.map((r, i) => <Card key={spikeKey(r)} r={r} i={i} region={region} lang={lang} onOpen={onOpenNight} />)}
      </ul>
    </div>
  ) : (
    <div className="sl-table-wrap" tabIndex={0} role="region" aria-labelledby="sl-caption" ref={listRef}>
      <h2 className="sr-only">{t('spikes.hList')}</h2>
      <table className="sl-table">
        <caption id="sl-caption">{caption}</caption>
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
          {view.shown.map((r, i) => <Row key={spikeKey(r)} r={r} i={i} region={region} lang={lang} onOpen={onOpenNight} />)}
        </tbody>
      </table>
    </div>
  ))
  return (
    <main className="sl-page">
      <header className="sl-head">
        <RegionSwitch current={region} />
        <p className="sl-kicker">{t('spikes.kicker', { where: region.where[lang] })}</p>
        <h1>{t('spikes.title')}</h1>
        <p className="sl-summary">
          <T k="spikes.summary" v={{ spikes: s.spikes, days: s.spike_days, reported }} />
        </p>
        <p className="sl-links">
          <T k="spikes.watch" v={{ link: <a href={navHref(import.meta.env.BASE_URL, 'timeline', window.location.search)}>{t('spikes.watchLink')}</a> }} />{' '}
          <T k="spikes.brief" v={{ link: <a href={navHref(import.meta.env.BASE_URL, 'brief', window.location.search)}>{t('spikes.briefLink')}</a> }} />
        </p>
      </header>

      <details className="sl-explain">
        <summary>{t('spikes.explain')}</summary>
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
              <div key={k}>
                <dt><span className={`sl-status sl-status-${k}`} lang={lang}><StatusIcon kind={statusInfo(k).icon} size={14} />{statusLabel(k, lang)}</span></dt>
                <dd>
                  {t(`status.note.${k}`)}
                  {k === 'search_incomplete' && (
                    <ul>{REASON_CODE_KEYS.map((r) => <li key={r}><strong>{t(r)}</strong>: {t(`${r}Long`)}</li>)}</ul>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </details>

      {count === 'spikes.none' && (
        <section className="sl-empty" role="status">
          <p>{t('spikes.none', { years: yearSpan(data.years) })}</p>
          <p><T k="spikes.noneCoverage" v={{ link: <a href={navHref(import.meta.env.BASE_URL, 'coverage', window.location.search)}>{t('spikes.noneCoverageLink')}</a> }} /></p>
        </section>
      )}
      {count !== 'spikes.none' && <section className="sl-controls" aria-labelledby="sl-controls-h">
        <h2 id="sl-controls-h" className="sr-only">{t('spikes.filterLabel')}</h2>
        {region.key === DEFAULT_REGION && (
          <NeighborhoodPicks rows={data.rows} picked={picked} onPick={(p) => {
            setDropped([])
            setPicked(p?.label ?? null)
            setFilters((f) => ({ ...f, site: p?.site ?? '' }))
          }} />
        )}
        <div className="sl-filters">
          <Select id="sl-site" label={t('spikes.fMonitor')} value={filters.site} onChange={set('site')} options={options.site} />
          <Select id="sl-compound" label={t('spikes.fCompound')} value={filters.compound} onChange={set('compound')} options={options.compound} />
          <Select id="sl-status" label={t('spikes.fCheck')} value={filters.status} onChange={set('status')} options={options.status} />
          <Select id="sl-year" label={t('spikes.fYear')} value={filters.year} onChange={set('year')} options={options.year} />
        </div>
        {dropped.length > 0 && (
          <p className="sl-dropped" role="status">{t('spikes.dropped', { fields: dropped.map((k) => t(FIELD_LABEL[k])).join(', ') })}</p>
        )}
        {phone && (
          <div className="sl-sortbar">
            <Select id="sl-sort" label={t('spikes.sortBy')} value={sort} onChange={(v) => startTransition(() => { setSort(v as SortKey); setDir('desc') })}
              options={[['date', t('spikes.hDate')], ['value', t('spikes.hPeak')], ['ratio', t('spikes.hRatio')]]} />
            <button type="button" className="btn sl-dir" onClick={() => startTransition(() => setDir(dir === 'asc' ? 'desc' : 'asc'))}>
              <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span> {orderText}
            </button>
          </div>
        )}
        <div className="sl-actions">
          <p className="sl-count" aria-live="polite">
            {count === 'spikes.empty' ? t('spikes.empty', { total: s.spikes })
              : count === 'spikes.showingFiltered' ? t('spikes.showingFiltered', { n: view.shown.length, m: rows.length, total: s.spikes })
                : t('spikes.showing', { n: view.shown.length, total: s.spikes })}
          </p>
          {filtered && <button type="button" className="btn" onClick={clearFilters}>{t('spikes.clear')}</button>}
          <button type="button" className="btn btn-primary" disabled={empty} onClick={() => downloadCsv(rows, filters)}>
            {t('spikes.csv', { n: rows.length })}
          </button>
          {/* Laptops: a way past the calendar; the first row sat about 1,100 px down. */}
          {!phone && !empty && (
            <button type="button" className="btn" onClick={() => {
              listRef.current?.scrollIntoView({ block: 'start' })
              listRef.current?.focus({ preventScroll: true })
            }}>{t('spikes.jump')}</button>
          )}
        </div>
      </section>}

      {/* Phones get the list first (the calendar marks are hard to tap there); laptops get the overview first. */}
      {!phone && calendar}
      {list}
      {view.remaining > 0 && (
        <div className="sl-more">
          <button type="button" className="btn" onClick={() => showMore(view.next)}>{t('spikes.more', { n: view.next })}</button>
          {view.remaining > view.next && (
            <button type="button" className="btn" onClick={() => showMore(view.remaining)}>{t('spikes.all', { n: rows.length })}</button>
          )}
        </div>
      )}
      {phone && calendar}
      <Follow siteId={filters.site || undefined} />
      <p className="sl-foot">
        <T k="spikes.source" v={{ via: t(region.backtested ? 'spikes.srcBacktest' : 'spikes.srcScan'), code: <code>pipeline/spikes.py</code> }} />
      </p>
    </main>
  )
}
