import { STATUS_FILL as FILL, statusInfo } from './format'
import type { SpikeRow } from './spikes'
import { T } from './LangSwitch'
import { useLang } from './useT'
import { dateLabel, monthShort } from './i18n'

// A cell with two spikes (one per compound) shows the result that leaves the most open: no report first.
const RANK = ['no_report_after_deadline', 'reported_mismatch', 'not_yet_reported', 'search_incomplete', 'reported']
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000
}
const daysIn = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365)

interface Props {
  rows: SpikeRow[]
  monitors: [string, string][]
  years: string[]
}

/** Two years at a glance: one strip per monitor, one mark per day with a spike. The table is the accessible
 *  version of the same rows, so the drawing itself is hidden from screen readers. */
export function SpikeCalendar({ rows, monitors, years }: Props) {
  const lang = useLang()
  const MONTHS = Array.from({ length: 12 }, (_, i) => monthShort(i, lang).slice(0, 1).toUpperCase())
  const cells = new Map<string, SpikeRow[]>()
  for (const r of rows) {
    const k = `${r.site_id}|${r.date}`
    cells.set(k, [...(cells.get(k) ?? []), r])
  }
  const shown = new Set(rows.map((r) => r.status))
  return (
    <figure className="sl-cal">
      <figcaption>
        <T k="cal.caption" />
      </figcaption>
      <div className="sl-cal-scroll" aria-hidden="true">
        {years.map((year) => {
          const n = daysIn(Number(year))
          return (
            <div className="sl-cal-year" key={year}>
              <div className="sl-cal-row sl-cal-axis">
                <span className="sl-cal-name">{year}</span>
                <span className="sl-cal-months">
                  {MONTHS.map((m, i) => (
                    <span key={i} style={{ left: `${((MONTH_START[i] + (i > 1 && n === 366 ? 1 : 0)) / n) * 100}%` }}>{m}</span>
                  ))}
                </span>
              </div>
              {monitors.map(([site, name]) => (
                <div className="sl-cal-row" key={site}>
                  <span className="sl-cal-name">{name}</span>
                  <svg className="sl-cal-strip" viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" shapeRendering="crispEdges">
                    {[...cells].filter(([k]) => k.startsWith(`${site}|${year}`)).map(([k, rs]) => {
                      const top = [...rs].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))[0]
                      return (
                        <rect key={k} x={dayOfYear(top.date)} y={0} width={1} height={1} fill={FILL[top.status] ?? '#16161a'}>
                          <title>{`${dateLabel(top.date, lang)} · ${name}\n${rs.map((r) => `${r.compound} ${r.value_ppb} ppb: ${statusInfo(r.status)[lang]}`).join('\n')}`}</title>
                        </rect>
                      )
                    })}
                  </svg>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <ul className="sl-cal-legend">
        {RANK.filter((s) => shown.has(s)).map((s) => (
          <li key={s}><span className="sl-cal-swatch" style={{ background: FILL[s] }} aria-hidden="true" /><span lang={lang}>{statusInfo(s)[lang]}</span></li>
        ))}
      </ul>
    </figure>
  )
}
