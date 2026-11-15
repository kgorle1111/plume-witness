// ?view=coverage: every state hourly benzene monitor in Texas (coverage.json), what each recorded, and which ones this
// site replays. Site.tsx wraps it in the site header and footer. The table is the full alternative to the map.
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  SORT_KEYS, coverageSummary, firstDir, loadCoverage, markerGeometry, markerKind, regionSpikesHref, replayable,
  sortSites, viewBounds, type Coverage as CoverageData, type CoverageSite, type MarkerKind, type SortDir, type SortKey,
} from './coverage.ts'
import { isLoadError, type LoadError } from './facilities'
import { maxFracDigits } from './format'
import { Num } from './Unit'
import { T } from './LangSwitch'
import { replayHref } from './routes'
import { REGIONS } from './region'
import { useLang, useT, type Translate } from './useT'
import type { Lang, StringKey } from './i18n'
import './Coverage.css'

const BASE = import.meta.env.BASE_URL
const FILE = 'coverage.json'
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright'
const loadMap = () => import('./CoverageMap')
// React.lazy caches a rejected import, so a retry swaps in a fresh lazy component (MapSlot.tsx does the same).
let LazyMap = lazy(loadMap)

const COLUMN: Record<SortKey, StringKey> = {
  name: 'cv.cSite', county: 'cv.cCounty', region: 'cv.cRegion', benzene: 'cv.cBenzene', butadiene: 'cv.cButadiene',
  spikes: 'cv.cSpikes', wind: 'cv.cWind',
}
const NUMERIC = new Set<SortKey>(['benzene', 'butadiene', 'spikes'])
const LEGEND: { kind: MarkerKind; key: StringKey }[] = [
  { kind: { shape: 'crossed', size: 3 }, key: 'cv.lgCrossed3' },
  { kind: { shape: 'crossed', size: 2 }, key: 'cv.lgCrossed2' },
  { kind: { shape: 'crossed', size: 1 }, key: 'cv.lgCrossed1' },
  { kind: { shape: 'zero', size: 0 }, key: 'cv.lgZero' },
  { kind: { shape: 'none', size: 0 }, key: 'cv.lgNone' },
]

function useCoverage(): { data: CoverageData | null; error: LoadError | null; retry: () => void } {
  const [state, setState] = useState<{ data: CoverageData | null; error: LoadError | null }>({ data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    loadCoverage(`${BASE}${FILE}`, fetch, ctrl.signal)
      .then((data) => setState({ data, error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        const error: LoadError = isLoadError(e) ? e : { kind: 'damaged', detail: String(e) }
        if (error.kind === 'damaged') console.error(`Plume Witness: ${error.detail}`)
        setState({ data: null, error })
      })
    return () => ctrl.abort()
  }, [attempt])
  return { ...state, retry: () => { setState({ data: null, error: null }); setAttempt((n) => n + 1) } }
}

function Head({ children }: { children?: ReactNode }) {
  const t = useT()
  return (
    <header className="cv-head">
      <p className="cv-kicker">{t('cv.kicker')}</p>
      <h1>{t('cv.title')}</h1>
      {children}
    </header>
  )
}

/** Before the pipeline publishes coverage.json the file 404s: that is "not published yet", never an empty state. */
function Failed({ error, retry }: { error: LoadError; retry: () => void }) {
  const t = useT()
  const missing = error.kind === 'http' && error.status === 404
  const text = missing ? t('cv.notPublished')
    : error.kind === 'network' ? t('fx.errNetwork')
    : error.kind === 'damaged' ? t('fx.errDamaged')
    : t('fx.errHttp', { file: FILE, status: error.status })
  return (
    <main className="cv-page">
      <Head />
      <section className="cv-note" aria-labelledby="cv-fail">
        <h2 id="cv-fail">{t(missing ? 'cv.notPublishedTitle' : 'cv.errTitle')}</h2>
        <p role={missing ? undefined : 'alert'}>{text}</p>
        {!missing && <p><button type="button" className="btn" onClick={retry}>{t('fx.retry')}</button></p>}
        <p className="cv-links">
          <a href={`${BASE}?view=spikes`}>{t('common.pastSpikes')}</a>
          <a href={replayHref(BASE, '')}>{t('common.backReplayPlain')}</a>
        </p>
      </section>
    </main>
  )
}

function MarkerIcon({ kind }: { kind: MarkerKind }) {
  const g = markerGeometry(kind)
  const c = g.px / 2
  return (
    <svg className="cv-icon" width={g.px} height={g.px} viewBox={`0 0 ${g.px} ${g.px}`} aria-hidden="true" focusable="false">
      {g.el === 'polygon'
        ? <polygon points={g.points} fill={g.fill} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        : g.dashed
          ? <><circle cx={c} cy={c} r={g.r} fill="none" stroke="#fff" strokeWidth="4" /><circle cx={c} cy={c} r={g.r} fill="none" stroke="#3a3a44" strokeWidth="2" strokeDasharray="3 2" /></>
          : <circle cx={c} cy={c} r={g.r} fill={g.fill} stroke="#fff" strokeWidth="1.5" />}
    </svg>
  )
}

class MapBoundary extends Component<{ onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('Coverage map failed to load:', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <MapFailed onRetry={this.props.onRetry} />
  }
}

function MapFailed({ onRetry }: { onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="cv-map-msg" role="status">
      <p>{t('cv.mapFailed')}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>{t('map.retry')}</button>}
    </div>
  )
}

function tipText(t: Translate, s: CoverageSite): string {
  if (!s.has_data) return t('cv.tipNone', { name: s.name })
  if (s.spikes === 0) return t('cv.tipZero', { name: s.name })
  return s.spikes === 1 ? t('cv.tipOne', { name: s.name }) : t('cv.tipMany', { name: s.name, n: s.spikes })
}

function MapSection({ data }: { data: CoverageData }) {
  const t = useT()
  const lang = useLang()
  const [view, setView] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [basemapFailed, setBasemapFailed] = useState(false)
  const bounds = useMemo(() => viewBounds(data.sites, view), [data.sites, view])
  const regions = useMemo(() => coverageSummary(data).regions, [data])
  const tipFor = useCallback((s: CoverageSite) => tipText(t, s), [t])
  const retry = () => { LazyMap = lazy(loadMap); setFailed(false); setAttempt((a) => a + 1) }
  const label = t('cv.mapLabel', { n: data.sites.length })
  return (
    <section className="cv-map-section" aria-labelledby="cv-map-h">
      <h2 id="cv-map-h">{t('cv.mapTitle')}</h2>
      {regions.length > 0 && (
        <div className="cv-views seg" role="group" aria-label={t('cv.zoomGroup')}>
          {[null, ...regions].map((k) => (
            <button key={k ?? 'texas'} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {k === null ? t('cv.zoomTexas') : REGIONS[k].name[lang]}
            </button>
          ))}
        </div>
      )}
      <div className="cv-map" role="group" aria-label={label}>
        {failed ? <MapFailed /> : (
          <MapBoundary key={attempt} onRetry={retry}>
            <Suspense fallback={<p className="cv-map-msg" role="status">{t('cv.mapLoading')}</p>}>
              <LazyMap sites={data.sites} bounds={bounds} label={label} tipFor={tipFor}
                onError={() => setFailed(true)} onBasemapError={() => setBasemapFailed(true)} />
            </Suspense>
          </MapBoundary>
        )}
        {basemapFailed && !failed && <p className="cv-map-note" role="status">{t('cv.basemapFailed')}</p>}
      </div>
      <p className="cv-credit">
        <T k="rn.credit" v={{
          ofm: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap<span className="sr-only">{t('chk.newTab')}</span></a>,
          omt: <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles<span className="sr-only">{t('chk.newTab')}</span></a>,
          osm: <a href={OSM_COPYRIGHT} target="_blank" rel="noopener">{t('rn.osm')}<span className="sr-only">{t('chk.newTab')}</span></a>,
        }} />
      </p>
      {view === null && regions.length > 0 && <p className="cv-small">{t('cv.mapNote')}</p>}
      <div className="cv-legend">
        <h3>{t('cv.legend')}</h3>
        <ul>
          {LEGEND.map(({ kind, key }) => (
            <li key={key}><span className="cv-swatch"><MarkerIcon kind={kind} /></span>{t(key)}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** A highest reading exactly as published, its decimal point in line with the column's (`frac`, Unit.tsx Num). */
function ppbCell(t: Translate, s: CoverageSite, v: number | null, frac: number) {
  if (!s.has_data) return <span className="cv-gap">{t('cv.noData')}</span>
  return v === null ? <span className="cv-gap">{t('cv.noValue')}</span> : <Num value={v} frac={frac} />
}

function regionText(lang: Lang, key: string | null): string {
  return key === null ? '' : replayable(key) ? REGIONS[key].name[lang] : key
}

function RegionCell({ s }: { s: CoverageSite }) {
  const t = useT()
  const lang = useLang()
  if (s.region_key === null) return <span className="cv-gap">{t('cv.notReplayed')}</span>
  const href = regionSpikesHref(BASE, s.region_key)
  if (!href) return <span className="cv-gap">{t('cv.unknownRegion', { key: s.region_key })}</span>
  return <a href={href}>{t('cv.regionLink', { region: REGIONS[s.region_key].name[lang] })}</a>
}

function SiteTable({ data }: { data: CoverageData }) {
  const t = useT()
  const lang = useLang()
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'spikes', dir: 'desc' })
  const rows = useMemo(
    () => sortSites(data.sites, sort.key, sort.dir, (k) => regionText(lang, k), lang === 'es' ? 'es' : 'en'),
    [data.sites, sort, lang],
  )
  const frac = useMemo(() => ({
    benzene: maxFracDigits(data.sites.map((s) => s.max_benzene_ppb)),
    butadiene: maxFracDigits(data.sites.map((s) => s.max_butadiene_ppb)),
  }), [data.sites])
  const choose = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) }))
  return (
    <section className="cv-table-section" aria-labelledby="cv-table-h">
      <h2 id="cv-table-h">{t('cv.tableTitle')}</h2>
      {/* Shown outside the scroll box (a caption is as wide as the table, so a phone cut it off); the caption says it to
          screen readers, so this copy is hidden from them. */}
      <p className="cv-small" aria-hidden="true">{t('cv.tableCaption', { n: data.sites.length })}</p>
      {/* A focusable, named scroll region: a keyboard reader can scroll the wide table sideways on a phone. */}
      <div className="cv-scroll" role="region" aria-label={t('cv.scrollLabel')} tabIndex={0}>
        <table className="cv-table">
          <caption className="sr-only">{t('cv.tableCaption', { n: data.sites.length })}</caption>
          <thead>
            <tr>
              {SORT_KEYS.map((k) => (
                <th key={k} scope="col" className={NUMERIC.has(k) ? 'num' : undefined}
                  aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="cv-sort" onClick={() => choose(k)}>
                    {t(COLUMN[k])}
                    <span className="cv-arrow" aria-hidden="true">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.site_id} className={s.has_data ? undefined : 'cv-row-gap'}>
                <th scope="row">
                  <span className="cv-site"><MarkerIcon kind={markerKind(s)} />{s.name}</span>
                  <span className="cv-id">{t('cv.siteId', { id: s.site_id })}</span>
                </th>
                <td>{s.county}</td>
                <td><RegionCell s={s} /></td>
                <td className="num">{ppbCell(t, s, s.max_benzene_ppb, frac.benzene)}</td>
                <td className="num">{ppbCell(t, s, s.max_butadiene_ppb, frac.butadiene)}</td>
                <td className="num">{s.has_data ? s.spikes : <span className="cv-gap">{t('cv.noData')}</span>}</td>
                <td>{t(s.wind_source ? `cv.wind.${s.wind_source}` : 'cv.wind.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Summary({ data }: { data: CoverageData }) {
  const t = useT()
  const lang = useLang()
  const s = coverageSummary(data)
  const years = s.years ? (s.years[0] === s.years[1] ? String(s.years[0]) : `${s.years[0]}–${s.years[1]}`) : t('cv.noYears')
  const list = s.regions.map((k) => REGIONS[k].name[lang]).join(', ')
  return (
    <section className="cv-summary" aria-labelledby="cv-sum-h">
      <h2 id="cv-sum-h" className="sr-only">{t('cv.summaryTitle')}</h2>
      <p>
        {t('cv.summary', { monitors: s.monitors, withData: s.withData, years, crossed: s.crossed, spikes: s.spikes })}
        {s.noData > 0 && <> {t('cv.summaryNoData', { n: s.noData })}</>}
        {' '}{s.regions.length ? t('cv.summaryRegions', { k: s.regions.length, list }) : t('cv.summaryNoRegions')}
        {s.crossedNotReplayed > 0 && <> {s.crossedNotReplayed === 1 ? t('cv.summaryOutsideOne') : t('cv.summaryOutside', { q: s.crossedNotReplayed })}</>}
      </p>
      <p className="cv-small">{t('cv.asOf', { generated: data.generated })}</p>
    </section>
  )
}

function Caveats({ trigger }: { trigger: string }) {
  const t = useT()
  return (
    <section className="cv-caveats" aria-labelledby="cv-cav-h">
      <h2 id="cv-cav-h">{t('cv.caveatsTitle')}</h2>
      <ul>
        <li>{t('cv.cvTrigger')} <code lang="en">{trigger}</code></li>
        <li>{t('cv.cvZero')}</li>
        <li>{t('cv.cvNoData')}</li>
        <li>{t('cv.cvProvisional')}</li>
        <li>{t('cv.cvQuestion')}</li>
        <li>{t('cv.cvWind')}</li>
        <li>{t('cv.cvNotAlert')}</li>
      </ul>
    </section>
  )
}

export default function Coverage() {
  const t = useT()
  const { data, error, retry } = useCoverage()
  useEffect(() => { document.title = t('cv.docTitle') }, [t])
  if (error) return <Failed error={error} retry={retry} />
  // The wait is drawn in the page's own column, with the same header: a full-width loading box that React then
  // restyles into the 1040px column moved the whole page sideways (CLS 0.21 at 1920px).
  if (!data) {
    return (
      <main className="cv-page" aria-busy="true">
        <Head><p className="cv-sub">{t('cv.sub')}</p></Head>
        <p>{t('cv.loading')}</p>
      </main>
    )
  }
  return (
    <main className="cv-page">
      <Head><p className="cv-sub">{t('cv.sub')}</p></Head>
      <Summary data={data} />
      <MapSection data={data} />
      <SiteTable data={data} />
      <Caveats trigger={data.trigger} />
    </main>
  )
}
