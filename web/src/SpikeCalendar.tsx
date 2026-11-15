import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { STATUS_FILL as FILL, hourLabel, statusLabel } from './format'
import { compoundLabel } from './region'
import { reasonKey, spikeKey, type SpikeRow } from './spikes'
import { T } from './LangSwitch'
import { useLang, useT } from './useT'
import { dateLabel, monthShort, translate, type Lang } from './i18n'

// A cell with two spikes (one per compound) shows the result that leaves the most open: no report first.
const RANK = ['no_report_after_deadline', 'reported_mismatch', 'not_yet_reported', 'reported_late', 'search_incomplete', 'reported_nrc', 'reported']
// Each status is a different mark shape inside its day cell (y0..y1 of the cell height, so the strip can stay
// preserveAspectRatio=none), so the calendar reads without colour: no matching report is a broken mark, an open question.
const SHAPE: Record<string, [number, number][]> = {
  reported: [[0, 1]],
  no_report_after_deadline: [[0, 0.4], [0.6, 1]],
  reported_mismatch: [[0.4, 1]],
  not_yet_reported: [[0, 0.6]],
  reported_late: [[0.2, 1]],
  search_incomplete: [[0.35, 0.65]],
  reported_nrc: [[0.1, 0.9]],
}
const shapeOf = (s: string) => SHAPE[s] ?? SHAPE.reported
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
// A mark's hit area reaches halfway to each neighbour, at most this far from its centre: neighbouring hit areas
// abut instead of overlapping, so the point under a mark's centre always belongs to that mark.
const HIT_HALF_PX = 5
// The tooltip touches the mark's hit area, so the pointer can move onto it (1.4.13); hiding waits this long anyway,
// so a diagonal move that clips a corner does not drop it.
const HIDE_MS = 150

function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000
}
const daysIn = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365)

interface Cell { key: string; site: string; name: string; year: string; rows: SpikeRow[]; top: SpikeRow }
interface Props {
  rows: SpikeRow[]
  monitors: [string, string][]
  years: string[]
  /** Opens a night's replay; the log passes its own region-aware navigation. */
  onOpen: (nightId: string) => void
}
interface Tip { cell: Cell; x: number; y: number }

/** Why a row's check stopped short, in the reader's language; an uncoded pipeline sentence stays English. */
const reasonText = (r: SpikeRow, lang: Lang): string => {
  const k = reasonKey(r)
  return k ? translate(lang, k) : r.reason ?? ''
}
const cellText = (c: Cell, lang: Lang) =>
  c.rows.map((r) => {
    const why = reasonText(r, lang)
    return `${compoundLabel(lang, r.compound)} ${r.value_ppb} ppb, ${hourLabel(r.hour_cst)}: ${statusLabel(r.status, lang)}${why ? ` – ${why}` : ''}`
  }).join('; ')

/** Centre of a day as a percentage of its year strip. */
const centre = (c: Cell, n: number) => ((dayOfYear(c.top.date) + 0.5) / n) * 100

interface MarkProps { cell: Cell; at: number; hl: number; hr: number; tab: boolean; label: string; onShow: (c: Cell, el: HTMLElement) => void; onLeave: () => void; onHide: () => void; onActivate: (c: Cell, e: React.MouseEvent) => void; onKey: (e: KeyboardEvent<HTMLElement>) => void; onFocusMark: (c: Cell) => void }

// memo: hover moves the tooltip on every mark change, and 415 marks should not re-render with it.
// Positions are in cqw (1% of the strip, a size container), so the drawn 4 px mark can sit inside a hit area whose
// sides are percentages of the strip, not of the button.
const Mark = memo(function Mark({ cell, at, hl, hr, tab, label, onShow, onLeave, onHide, onActivate, onKey, onFocusMark }: MarkProps) {
  const style = { '--hl': `min(${hl}cqw, ${HIT_HALF_PX}px)`, '--hr': `min(${hr}cqw, ${HIT_HALF_PX}px)`, left: `calc(${at}cqw - var(--hl))` } as CSSProperties
  return (
    <button type="button" className="sl-cal-mark" data-cell={cell.key} tabIndex={tab ? 0 : -1} aria-label={label}
      style={style}
      onMouseEnter={(e) => onShow(cell, e.currentTarget)} onMouseLeave={onLeave}
      onFocus={(e) => { onFocusMark(cell); if (e.currentTarget.matches(':focus-visible')) onShow(cell, e.currentTarget) }}
      onBlur={onHide} onClick={(e) => onActivate(cell, e)} onKeyDown={onKey}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false" fill={FILL[cell.top.status] ?? '#16161a'}>
        {shapeOf(cell.top.status).map(([y0, y1]) => <rect key={y0} x={0} y={y0} width={1} height={y1 - y0} />)}
      </svg>
    </button>
  )
})

/** Two years at a glance: one strip per monitor, one mark per day with a spike. Marks are drawn 4 px wide inside
 *  buttons that reach halfway to each neighbour: hover or focus shows the reading, a click opens that night.
 *  Keyboard: the marks are one tab stop (roving tabindex, arrows move, Enter opens); the list stays the full
 *  accessible version of the same rows. */
export function SpikeCalendar({ rows, monitors, years, onOpen }: Props) {
  const lang = useLang()
  const t = useT()
  const MONTHS = Array.from({ length: 12 }, (_, i) => monthShort(i, lang))
  const figRef = useRef<HTMLElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [tabKey, setTabKey] = useState<string | null>(null)
  const lastPointer = useRef('mouse')

  const { cells, order } = useMemo(() => {
    const by = new Map<string, SpikeRow[]>()
    for (const r of rows) by.set(`${r.site_id}|${r.date}`, [...(by.get(`${r.site_id}|${r.date}`) ?? []), r])
    const names = new Map(monitors)
    const cells = new Map<string, Cell>()
    for (const [key, rs] of by) {
      const site = rs[0].site_id
      if (!names.has(site)) continue
      const sorted = [...rs].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status))
      cells.set(key, { key, site, name: names.get(site)!, year: rs[0].date.slice(0, 4), rows: sorted, top: sorted[0] })
    }
    // DOM order = tab/arrow order: year, then monitor strip, then date.
    const order: string[] = []
    for (const y of years) for (const [site] of monitors)
      order.push(...[...cells.values()].filter((c) => c.site === site && c.year === y).sort((a, b) => a.top.date.localeCompare(b.top.date)).map((c) => c.key))
    return { cells, order }
  }, [rows, monitors, years])
  const shown = new Set(rows.map((r) => r.status))
  const tabStop = tabKey && cells.has(tabKey) ? tabKey : order[0]

  const hideTimer = useRef<number | undefined>(undefined)
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), [])
  useEffect(() => keep, [keep])
  const onShow = useCallback((cell: Cell, el: HTMLElement) => {
    keep()
    const fig = figRef.current
    if (!fig) return
    const f = fig.getBoundingClientRect(), r = (el.querySelector('svg') ?? el).getBoundingClientRect()
    setTip({ cell, x: r.left - f.left + r.width / 2, y: r.bottom - f.top })
  }, [keep])
  const onHide = useCallback(() => { keep(); setTip(null) }, [keep])
  const onLeave = useCallback(() => { keep(); hideTimer.current = window.setTimeout(() => setTip(null), HIDE_MS) }, [keep])
  const onFocusMark = useCallback((c: Cell) => setTabKey(c.key), [])
  const openCell = useCallback((c: Cell) => {
    const night = c.rows.find((r) => r.night_id)?.night_id
    if (night) onOpen(night)
  }, [onOpen])
  const armed = useRef<string | null>(null)
  const onActivate = useCallback((c: Cell, e: React.MouseEvent) => {
    // A touch has no hover (and the emulated mouseenter fires before the click, so the tooltip cannot tell us):
    // the first tap on a mark shows the reading, a second tap on the same mark opens the night.
    if (lastPointer.current === 'touch' && armed.current !== c.key) {
      armed.current = c.key
      return onShow(c, e.currentTarget as HTMLElement)
    }
    openCell(c)
  }, [onShow, openCell])
  const onKey = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    const i = order.indexOf((e.currentTarget as HTMLElement).dataset.cell ?? '')
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : move ? i + move : -1
    if (e.key === 'Escape') return setTip(null)
    if (to < 0 || to >= order.length) return
    e.preventDefault()
    const el = figRef.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(order[to])}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    el?.focus()
  }, [order])

  const label = (c: Cell) => `${dateLabel(c.top.date, lang)}, ${c.name}: ${cellText(c, lang)}. ${c.rows.some((r) => r.night_id) ? t('spikes.replayLink') : t('spikes.noReplay')}`

  return (
    <figure className="sl-cal" ref={figRef} aria-labelledby="sl-cal-h" onPointerDown={(e) => { lastPointer.current = e.pointerType }}>
      <h2 id="sl-cal-h" className="sr-only">{t('spikes.hCalendar')}</h2>
      <figcaption>
        <T k="cal.caption" />
      </figcaption>
      <div className="sl-cal-scroll" role="group" aria-label={t('cal.group')} onScroll={onHide}>
        {years.map((year) => {
          const n = daysIn(Number(year))
          return (
            <div className="sl-cal-year" key={year}>
              <div className="sl-cal-row sl-cal-axis" aria-hidden="true">
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
                  <div className="sl-cal-strip">
                    {order.filter((k) => k.startsWith(`${site}|${year}`)).map((k, i, strip) => {
                      const c = cells.get(k)!
                      const at = centre(c, n)
                      const prev = i > 0 ? centre(cells.get(strip[i - 1])!, n) : 0
                      const next = i < strip.length - 1 ? centre(cells.get(strip[i + 1])!, n) : 100
                      return <Mark key={spikeKey(c.top)} cell={c} at={at} hl={i > 0 ? (at - prev) / 2 : at} hr={i < strip.length - 1 ? (next - at) / 2 : next - at}
                        tab={k === tabStop} label={label(c)}
                        onShow={onShow} onLeave={onLeave} onHide={onHide} onActivate={onActivate} onKey={onKey} onFocusMark={onFocusMark} />
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {tip && (
        <div className="sl-cal-tip" role="presentation" aria-hidden="true" onMouseEnter={keep} onMouseLeave={onLeave}
          style={{ left: `clamp(var(--tip-half), ${tip.x}px, calc(100% - var(--tip-half)))`, top: tip.y + 1 }}>
          <strong>{dateLabel(tip.cell.top.date, lang)}</strong> · {tip.cell.name}
          {tip.cell.rows.map((r) => (
            <span className="sl-cal-tip-row" key={r.param}>
              {compoundLabel(lang, r.compound)}: {r.value_ppb} ppb ({r.ratio === null ? '—' : `${r.ratio}×`}) · {hourLabel(r.hour_cst)}
              <span className={`sl-status sl-status-${r.status}`} lang={lang}>{statusLabel(r.status, lang)}</span>
              {reasonText(r, lang) && <span className="sl-reason" lang={reasonKey(r) ? undefined : 'en'}>{reasonText(r, lang)}</span>}
            </span>
          ))}
          <span className="sl-cal-tip-hint">{tip.cell.rows.some((r) => r.night_id) ? t('cal.hint') : t('spikes.noReplay')}</span>
        </div>
      )}
      <ul className="sl-cal-legend">
        {RANK.filter((s) => shown.has(s)).map((s) => (
          <li key={s}><svg className="sl-cal-swatch" viewBox="0 0 1 1" preserveAspectRatio="none" fill={FILL[s]} aria-hidden="true" focusable="false">{shapeOf(s).map(([y0, y1]) => <rect key={y0} x={0} y={y0} width={1} height={y1 - y0} />)}</svg><span lang={lang}>{statusLabel(s, lang)}</span></li>
        ))}
      </ul>
    </figure>
  )
}
