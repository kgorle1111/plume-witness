import { useEffect, useId, useState } from 'react'
import './Rose.css'
import { unitTitle } from './format'
import { useLang, useT } from './useT'

// Mirrors pipeline/rose.py (web/public/rose.json). The pipeline owns the shape; change both together.
interface SectorStat { high_hours: number; high_days: number; cpf: number | null; share_of_high: number | null }
interface Sector {
  from_deg: number
  to_deg: number
  hours: number
  share_of_hours: number
  sparse: boolean
  p90: SectorStat
  p99: SectorStat
}
interface Headline {
  percentile: number
  from_deg: number
  to_deg: number
  share_of_high: number
  cpf: number
  share_of_hours: number
  high_hours: number
  high_days: number
  threshold_ppb: number
}
interface CompoundRose {
  name: string
  n_hours: number
  thresholds_ppb: { p90: number; p99: number }
  high_hours: { p90: number; p99: number }
  sectors: Sector[]
  headline: Headline | null
}
export interface RoseData {
  method: { years: string[]; min_speed_mph: number; units: string; trigger_floor_ppb: number }
  caveat: string
  sites: Record<string, { name: string; compounds: Record<string, CompoundRose> }>
  skipped_sites: { site_id: string; name: string; reason: string }[]
}

type Pct = 'p90' | 'p99'
const TOP_KEY = { p90: 'rose.top90', p99: 'rose.top99' } as const
const BASE_RATE: Record<Pct, number> = { p90: 0.1, p99: 0.01 }

let cache: Promise<RoseData> | null = null
function loadRose(): Promise<RoseData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}rose.json`, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`Could not load rose.json (HTTP ${r.status}). Run: uv run python -m pipeline.rose`)
    return r.json().then((raw: RoseData) => {
      if (!raw || typeof raw.sites !== 'object' || !Array.isArray(raw.skipped_sites)) {
        throw new Error('rose.json is not in the expected shape; rerun: uv run python -m pipeline.rose')
      }
      return raw
    })
  })
  cache.catch(() => { cache = null })
  return cache
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const ppb = (x: number) => `${Number(x.toPrecision(3))} ppb`

const C = 150
const R = 104
function pt(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}
function wedge(from: number, to: number, r: number): string {
  const [x0, y0] = pt(from, r)
  const [x1, y1] = pt(to, r)
  return `M${C},${C} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`
}

export function Rose({ siteId, param }: { siteId: string; param: string }) {
  const [data, setData] = useState<RoseData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [p, setP] = useState<Pct>('p99')
  const id = useId()
  const t = useT()
  const lang = useLang()
  const TOP: Record<Pct, string> = { p90: t(TOP_KEY.p90), p99: t(TOP_KEY.p99) }
  // Words, not 'NE': read aloud and plain for a first-time reader.
  const compass = (deg: number) => t('rose.compass').split(',')[Math.round(deg / 45) % 8]
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1)

  useEffect(() => {
    let live = true
    loadRose().then(
      (d) => { if (live) setData(d) },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false }
  }, [])

  if (error) return <p className="muted small">{t('rose.unavailable', { err: error })}</p>
  if (!data) return <p className="muted small">{t('rose.loading')}</p>

  const site = data.sites[siteId]
  const rose = site?.compounds[param]
  if (!site || !rose) {
    const skip = data.skipped_sites.find((s) => s.site_id === siteId)
    const name = skip?.name ?? site?.name ?? siteId
    return (
      <p className="muted small">
        {t('rose.none', { name, reason: skip ? skip.reason.split(' (')[0] : t('rose.noReadings') })}
      </p>
    )
  }

  const years = `${data.method.years[0]}–${data.method.years[data.method.years.length - 1]}`
  const thr = rose.thresholds_ppb[p]
  const unitTip = unitTitle(data.method.units)
  const cpfs = rose.sectors.map((s) => s[p].cpf ?? 0)
  const max = Math.max(...cpfs, BASE_RATE[p])
  const scale = (v: number) => (v / max) * R
  const top = rose.sectors.filter((s) => !s.sparse && s[p].share_of_high !== null)
    .reduce<Sector | null>((a, s) => (!a || (s[p].share_of_high ?? 0) > (a[p].share_of_high ?? 0) ? s : a), null)
  const summaryId = `${id}-summary`
  // Compound names come from rose.json in English; the two this tool tracks have Spanish names in i18n.
  const cmpName = lang === 'es' ? ({ benzene: 'benceno', '1,3-butadiene': '1,3-butadieno' } as Record<string, string>)[rose.name] ?? rose.name : rose.name

  let summary = t('rose.summaryNone', { site: site.name })
  if (top) {
    const share = top[p].share_of_high ?? 0
    summary = t(share >= 0.5 ? 'rose.summaryMost' : 'rose.summaryLargest', {
      cmp: cmpName, top: TOP[p], site: site.name, share: pct(share), from: top.from_deg, to: top.to_deg,
      dir: compass((top.from_deg + top.to_deg) / 2), blow: pct(top.share_of_hours),
    })
  }

  return (
    <figure className="rose" aria-labelledby={summaryId}>
      <figcaption>
        <h3 className="rose-title">{t('rose.title', { cmp: cmpName, years })}</h3>
        <p id={summaryId} className="rose-summary">{summary}</p>
      </figcaption>

      <fieldset className="rose-toggle">
        <legend className="sr-only">{t('rose.which')}</legend>
        {(['p99', 'p90'] as Pct[]).map((k) => (
          <label key={k}>
            <input type="radio" name={`${id}-pct`} value={k} checked={p === k} onChange={() => setP(k)} />
            {cap(TOP[k])}
          </label>
        ))}
      </fieldset>

      <svg className="rose-svg" viewBox="0 0 300 300" role="img"
        aria-label={t('rose.aria', { top: TOP[p] })}>
        {[0.5, 1].map((f) => <circle key={f} className="rose-ring" cx={C} cy={C} r={R * f} />)}
        {[0, 90, 180, 270].map((d) => {
          const [x, y] = pt(d, R)
          return <line key={d} className="rose-axis" x1={C} y1={C} x2={x} y2={y} />
        })}
        {rose.sectors.map((s) => (
          <path
            key={s.from_deg}
            className={`rose-wedge${s === top ? ' is-top' : ''}${s.sparse ? ' is-sparse' : ''}`}
            d={wedge(s.from_deg, s.to_deg, scale(s[p].cpf ?? 0))}
          />
        ))}
        <circle className="rose-base" cx={C} cy={C} r={scale(BASE_RATE[p])} />
        {[0.5, 1].map((f) => (
          <text key={f} className="rose-ring-label" x={C - 4} y={C - R * f + 11} textAnchor="end">{pct(max * f)}</text>
        ))}
        {t('rose.compassShort').split(',').map((l, i) => {
          const [x, y] = pt(i * 90, R + 18)
          return <text key={l} className="rose-compass" x={x} y={y} textAnchor="middle" dominantBaseline="central">{l}</text>
        })}
      </svg>

      <p className="small rose-key">
        {t('rose.key', { top: TOP[p], base: pct(BASE_RATE[p]) })}
        {top && t('rose.keyTop', { from: top.from_deg, to: top.to_deg, cpf: pct(top[p].cpf ?? 0), top: TOP[p], hours: top[p].high_hours, days: top[p].high_days })}
      </p>

      <div className="rose-caveat">
        <p><strong>{t('rose.notSay')}</strong> {lang === 'es' ? t('rose.caveat') /* kn: fixed ES copy of rose.json's caveat; re-translate if the pipeline text changes */ : data.caveat} {t('rose.caveatTail')}</p>
        <p>
          {t('rose.starts', { top: cap(TOP[p]), thr: ppb(thr) })} ({unitTip ? <abbr title={unitTip}>{data.method.units}</abbr> : data.method.units}, {t('rose.hourly')})
          {thr < data.method.trigger_floor_ppb ? t('rose.low', { floor: data.method.trigger_floor_ppb }) : '.'}
          {' '}{t('rose.based', { n: rose.n_hours.toLocaleString(lang === 'es' ? 'es-US' : 'en-US'), mph: data.method.min_speed_mph })}
        </p>
      </div>

      <details className="rose-table">
        <summary>{t('rose.tableSum')}</summary>
        <table>
          <caption className="sr-only">{t('rose.caption', { cmp: cmpName, site: site.name, years, top: TOP[p], thr: ppb(thr) })}</caption>
          <thead>
            <tr><th scope="col">{t('rose.colFrom')}</th><th scope="col">{t('rose.colShare')}</th><th scope="col">{t('rose.colChance', { top: TOP[p] })}</th><th scope="col">{cap(t('rose.colHours', { top: TOP[p] }))}</th></tr>
          </thead>
          <tbody>
            {rose.sectors.map((s) => (
              <tr key={s.from_deg} className={s === top ? 'is-top' : undefined}>
                <th scope="row">{s.from_deg}–{s.to_deg}°</th>
                <td>{pct(s.share_of_hours)}</td>
                <td>{s[p].cpf === null ? '—' : `${(s[p].cpf * 100).toFixed(1)}%`}{s.sparse ? t('rose.few') : ''}</td>
                <td>{s[p].high_hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
