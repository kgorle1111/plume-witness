import { useEffect, useRef, useState } from 'react'
import type { Monitor, PlumeEvent } from './types'
import { compass, hourLabel, readingText, unitShort } from './format'
import { useLang, useT } from './useT'
import { playWindow } from './playWindow'

const STEP_MS = 600

interface Props {
  ev: PlumeEvent
  hour: number
  onHour: (h: number) => void
}

export function Timeline({ ev, hour, onHour }: Props) {
  const t = useT()
  const lang = useLang()
  const NOTE = t('tl.note')
  const [playing, setPlaying] = useState(false)
  const hourRef = useRef(hour)
  useEffect(() => {
    hourRef.current = hour
  }, [hour])
  const trigger = ev.monitors.find((m) => m.site_id === ev.detection.site_id) as Monitor
  const hours = trigger.hourly.map((h) => h.hour_cst)
  const first = Math.min(...hours)
  const last = Math.max(...hours)
  const { from, to } = playWindow(ev.detection.hour_cst, hours)
  const units = ev.compound.units

  useEffect(() => {
    if (!playing) return
    // Reduced motion still plays when asked (it's user-initiated), but the map steps without tweening.
    const id = window.setInterval(() => {
      const next = hourRef.current + 1
      if (next > to) {
        setPlaying(false)
        return
      }
      onHour(next)
    }, STEP_MS)
    return () => window.clearInterval(id)
  }, [playing, to, onHour])

  const togglePlay = () => {
    if (playing) return setPlaying(false)
    if (hour < from || hour >= to) onHour(from)
    setPlaying(true)
  }

  const reading = (m: Monitor) => {
    const h = m.hourly.find((x) => x.hour_cst === hour)
    if (!h) return t('tl.noData')
    return h.value === null ? (h.flag ? `${t('tl.noData')} (${h.flag})` : t('tl.noData')) : readingText(h.value, h.flag, unitShort(units))
  }
  const wind = ev.wind.hourly.find((w) => w.hour_cst === hour)
  const windText = wind ? t('tl.wind', { dir: compass(wind.from_deg, lang), deg: wind.from_deg, mph: wind.speed_mph }) : t('tl.noWind')
  const status = `${hourLabel(hour)}: ${trigger.name} ${reading(trigger)}, ${windText}`

  return (
    <div className="timeline" role="group" aria-label={t('tl.group')}>
      <div className="tl-controls">
        <button type="button" className="btn tl-play" onClick={togglePlay} aria-pressed={playing}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" fill="currentColor">
            {playing ? <path d="M3 2h3v10H3zM8 2h3v10H8z" /> : <path d="M3.5 1.8v10.4L12 7z" />}
          </svg>
          {playing ? t('tl.pause') : <>{t('tl.play')}<span className="wide-only"> {hourLabel(from).slice(0, 5)}–{hourLabel(to).slice(0, 5)}</span></>}
        </button>
        <label className="tl-slider">
          <span className="sr-only">{t('tl.slider', { date: ev.date_local })}</span>
          <input
            type="range"
            min={first}
            max={last}
            step={1}
            value={hour}
            aria-valuetext={status}
            onChange={(e) => {
              setPlaying(false)
              onHour(Number(e.target.value))
            }}
          />
        </label>
        {hour !== ev.detection.hour_cst && (
          <button type="button" className="btn tl-jump" onClick={() => { setPlaying(false); onHour(ev.detection.hour_cst) }}>
            {t('tl.jumpA')}<span className="wide-only">{t('tl.jumpB')}</span>
          </button>
        )}
      </div>
      {/* Visible status doubles as the text equivalent of what the map shows for this hour. */}
      <p className="tl-status" aria-live={playing ? 'off' : 'polite'}>
        <strong>{hourLabel(hour)}</strong> · {trigger.name}: <strong>{reading(trigger)}</strong> · {windText}
      </p>
      {/* Phones keep the note inside the details to save height; only one copy is ever displayed. */}
      {ev.corridor && <p className="tl-note wide-only">{NOTE}</p>}
      <details className="tl-all">
        <summary>{t('tl.all', { hour: hourLabel(hour) })}</summary>
        {ev.corridor && <p className="tl-note narrow-only">{NOTE}</p>}
        <ul>
          {ev.monitors.map((m) => <li key={m.site_id}>{m.name}: {reading(m)}</li>)}
        </ul>
      </details>
    </div>
  )
}

