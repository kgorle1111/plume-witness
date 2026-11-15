import { useEffect, useId, useState } from 'react'
import './Rose.css'

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
const TOP: Record<Pct, string> = { p90: 'top 10%', p99: 'top 1%' }
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

// Words, not 'NE': read aloud and plain for a first-time reader.
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]
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

  useEffect(() => {
    let live = true
    loadRose().then(
      (d) => { if (live) setData(d) },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { live = false }
  }, [])

  if (error) return <p className="muted small">Pollution rose unavailable: {error}</p>
  if (!data) return <p className="muted small">Loading the two-year wind pattern…</p>

  const site = data.sites[siteId]
  const rose = site?.compounds[param]
  if (!site || !rose) {
    const skip = data.skipped_sites.find((s) => s.site_id === siteId)
    const name = skip?.name ?? site?.name ?? siteId
    return (
      <p className="muted small">
        No pollution rose for {name}: {skip ? skip.reason.split(' (')[0] : 'no readings for this compound'}.
        A rose needs the monitor's own wind; another site's wind would point at the wrong place.
      </p>
    )
  }

  const years = `${data.method.years[0]}–${data.method.years[data.method.years.length - 1]}`
  const thr = rose.thresholds_ppb[p]
  const cpfs = rose.sectors.map((s) => s[p].cpf ?? 0)
  const max = Math.max(...cpfs, BASE_RATE[p])
  const scale = (v: number) => (v / max) * R
  const top = rose.sectors.filter((s) => !s.sparse && s[p].share_of_high !== null)
    .reduce<Sector | null>((a, s) => (!a || (s[p].share_of_high ?? 0) > (a[p].share_of_high ?? 0) ? s : a), null)
  const summaryId = `${id}-summary`

  let summary = `Not enough hours in any direction for a summary at ${site.name}.`
  if (top) {
    const share = top[p].share_of_high ?? 0
    const lead = share >= 0.5 ? `Most ${rose.name} readings in the ${TOP[p]}` : `The largest share of ${rose.name} readings in the ${TOP[p]}`
    summary = `${lead} at ${site.name} (${pct(share)}) ${share >= 0.5 ? 'arrive' : 'arrives'} with wind from ${top.from_deg}–${top.to_deg}° ` +
      `(roughly ${compass((top.from_deg + top.to_deg) / 2)}), which blows ${pct(top.share_of_hours)} of the time.`
  }

  return (
    <figure className="rose" aria-labelledby={summaryId}>
      <figcaption>
        <h3 className="rose-title">Where high {rose.name} readings arrive from, {years}</h3>
        <p id={summaryId} className="rose-summary">{summary}</p>
      </figcaption>

      <fieldset className="rose-toggle">
        <legend className="sr-only">Which readings count as high</legend>
        {(['p99', 'p90'] as Pct[]).map((k) => (
          <label key={k}>
            <input type="radio" name={`${id}-pct`} value={k} checked={p === k} onChange={() => setP(k)} />
            {TOP[k][0].toUpperCase() + TOP[k].slice(1)}
          </label>
        ))}
      </fieldset>

      <svg className="rose-svg" viewBox="0 0 300 300" role="img"
        aria-label={`Pollution rose chart for the ${TOP[p]}; the same numbers are in the table below.`}>
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
        {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
          const [x, y] = pt(i * 90, R + 18)
          return <text key={l} className="rose-compass" x={x} y={y} textAnchor="middle" dominantBaseline="central">{l}</text>
        })}
      </svg>

      <p className="small rose-key">
        Each wedge is a wind direction. Its length is the chance that an hour with wind from there is in the {TOP[p]}.
        The dashed circle is {pct(BASE_RATE[p])}, what every direction would show if direction did not matter.
        {top && <> From {top.from_deg}–{top.to_deg}°, {pct(top[p].cpf ?? 0)} of hours are in the {TOP[p]}: {top[p].high_hours} hours on {top[p].high_days} days.</>}
      </p>

      <div className="rose-caveat">
        <p><strong>What this does not say.</strong> {data.caveat} Anything in that direction, near or far, could contribute.</p>
        <p>
          The {TOP[p]} at this monitor starts at {ppb(thr)} ({data.method.units}, hourly)
          {thr < data.method.trigger_floor_ppb
            ? <>: low levels, below the {data.method.trigger_floor_ppb} ppb at which this tool starts a trace.</>
            : '.'}
          {' '}Based on {rose.n_hours.toLocaleString('en-US')} hours with wind of {data.method.min_speed_mph} mph or more.
        </p>
      </div>

      <details className="rose-table">
        <summary>Rose as a table</summary>
        <table>
          <caption className="sr-only">{rose.name} at {site.name}, {years}, {TOP[p]} = {ppb(thr)} or more</caption>
          <thead>
            <tr><th scope="col">Wind from</th><th scope="col">Share of hours</th><th scope="col">Chance of {TOP[p]}</th><th scope="col">{TOP[p]} hours</th></tr>
          </thead>
          <tbody>
            {rose.sectors.map((s) => (
              <tr key={s.from_deg} className={s === top ? 'is-top' : undefined}>
                <th scope="row">{s.from_deg}–{s.to_deg}°</th>
                <td>{pct(s.share_of_hours)}</td>
                <td>{s[p].cpf === null ? '—' : `${(s[p].cpf * 100).toFixed(1)}%`}{s.sparse ? ' (few hours)' : ''}</td>
                <td>{s[p].high_hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
