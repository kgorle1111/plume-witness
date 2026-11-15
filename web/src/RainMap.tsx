import { useEffect, useRef } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck, MapView } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { STATUS_FILL } from './format'
import { fadeAlpha, hexToRgb, radiusPx, type Timed, type Visible } from './rain'

setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
const NEUTRAL: [number, number, number] = [138, 138, 148]

/** What the map shows: the rain (spikes fading in time), or a static month for reduced motion. */
export type Frame = { kind: 'rain'; visible: readonly Visible[] } | { kind: 'month'; month: number }

export interface RainMapApi {
  draw(frame: Frame): void
}

interface Dot {
  night: string | null
  lon: number
  lat: number
  r: number
  fill: [number, number, number, number]
  line: [number, number, number, number]
  /** Picking is off for dots that have all but faded, so a click never lands on something you can't see. */
  live: boolean
  /** No matching report is a hollow ring (an open question); every other status is a filled disc. */
  ring: boolean
}
const OPEN_QUESTION = 'no_report_after_deadline'

const rgb = (status: string) => hexToRgb(STATUS_FILL[status] ?? '#16161a')

function dotsFor(spikes: readonly Timed[], frame: Frame): Dot[] {
  if (frame.kind === 'rain') {
    return frame.visible.map(({ i, age }) => {
      const s = spikes[i].row
      const a = fadeAlpha(age)
      const [r, g, b] = rgb(s.status)
      // The ring swells to 1.7x as the spike ages; the fill thins faster than the outline so the position stays readable.
      return {
        night: s.night_id, lon: s.lon, lat: s.lat, r: radiusPx(s.ratio) * (1 + 0.7 * age),
        fill: [r, g, b, s.status === OPEN_QUESTION ? 0 : Math.round(150 * a)], line: [r, g, b, Math.round(255 * a)], live: age < 0.75, ring: s.status === OPEN_QUESTION,
      }
    })
  }
  // Static month: every spike is a dot; the chosen month in its status color, the rest quiet grey.
  return spikes.map((sp) => {
    const s = sp.row
    const on = sp.month === frame.month
    const [r, g, b] = on ? rgb(s.status) : NEUTRAL
    return {
      night: s.night_id, lon: s.lon, lat: s.lat, r: on ? radiusPx(s.ratio) : 3,
      fill: [r, g, b, s.status === OPEN_QUESTION && on ? 0 : on ? 190 : 70], line: [r, g, b, on ? 255 : 0], live: on, ring: on && s.status === OPEN_QUESTION,
    }
  })
}

interface Props {
  spikes: readonly Timed[]
  onApi: (api: RainMapApi | null) => void
  onPick: (nightId: string) => void
  onError: (e: unknown) => void
}

export default function RainMap({ spikes, onApi, onPick, onError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const pick = useRef(onPick)
  pick.current = onPick

  useEffect(() => {
    const el = container.current
    if (!el) return
    let map: MlMap | undefined
    let deck: { finalize(): void } | undefined
    const markers: Marker[] = []
    try {
      map = new MlMap({
        container: el,
        style: STYLE_URL,
        center: [-95.2, 29.75],
        zoom: 9,
        // Fixed camera: the page scrolls, and a 50dvh map would otherwise trap touch scrolling on a phone.
        interactive: false,
        attributionControl: { compact: false, customAttribution: ATTRIBUTION },
        locale: { 'Map.Title': 'Map of the Houston Ship Channel state monitors' },
      })
      const m = map
      const bounds = new LngLatBounds()
      const sites = new Map<string, Timed['row']>()
      for (const s of spikes) {
        bounds.extend([s.row.lon, s.row.lat])
        if (!sites.has(s.row.site_id)) sites.set(s.row.site_id, s.row)
      }
      const fit = () => {
        if (bounds.isEmpty() || el.clientWidth < 40 || el.clientHeight < 40) return
        // Room for the date HUD (top-left) and, on wide maps, the monitor labels that run right of each dot.
        const wide = el.clientWidth >= 600
        const room = (want: number, size: number) => Math.min(want, Math.max(0, (size - 40) / 2))
        const w = el.clientWidth, h = el.clientHeight
        m.fitBounds(bounds, {
          padding: { top: room(wide ? 90 : 76, h), bottom: room(30, h), left: room(36, w), right: room(wide ? 120 : 36, w) },
          maxZoom: 11, duration: 0,
        })
      }
      fit()
      // Monitors stay on the map all the time, so a quiet month still shows where the instruments are.
      for (const row of sites.values()) {
        const dot = document.createElement('div')
        dot.className = 'rain-monitor'
        dot.setAttribute('aria-hidden', 'true')
        const label = document.createElement('span')
        label.textContent = row.site
        dot.append(label)
        markers.push(new Marker({ element: dot }).setLngLat([row.lon, row.lat]).addTo(m))
      }

      // kn: standalone Deck synced to the MapLibre camera (same workaround as EventMap.tsx: @deck.gl/mapbox 9.4.1
      // reads map.transform, which MapLibre 6 removed). Fine because this map is flat and never pitched.
      const host = document.createElement('div')
      host.className = 'deck-host'
      m.getCanvasContainer().appendChild(host)
      const camera = () => {
        const c = m.getCenter()
        return { longitude: c.lng, latitude: c.lat, zoom: m.getZoom(), bearing: 0, pitch: 0 }
      }
      const d = new Deck({
        parent: host,
        views: new MapView({ repeat: true }),
        viewState: camera(),
        controller: false,
        layers: [],
        onLoad: () => {
          const c = host.querySelector('canvas')
          if (!c) return
          c.tabIndex = -1
          c.setAttribute('aria-hidden', 'true')
        },
      })
      deck = d
      const sync = () => d.setProps({ viewState: camera() })
      m.on('move', sync)
      m.on('resize', () => { fit(); sync() })

      const api: RainMapApi = {
        draw(frame) {
          d.setProps({
            layers: [new ScatterplotLayer<Dot>({
              id: 'rain',
              data: dotsFor(spikes, frame),
              getPosition: (x) => [x.lon, x.lat],
              getRadius: (x) => x.r,
              getFillColor: (x) => x.fill,
              getLineColor: (x) => x.line,
              radiusUnits: 'pixels',
              lineWidthUnits: 'pixels',
              getLineWidth: (x) => (x.ring ? 3.5 : 1.5),
              stroked: true,
              filled: true,
              pickable: true,
              parameters: { depthCompare: 'always' },
            })],
          })
        },
      }
      // The pane's own click, not MapLibre's (the map is non-interactive); deck picks on its own buffer.
      const onClick = (e: MouseEvent) => {
        const r = el.getBoundingClientRect()
        const hit = d.pickObject({ x: e.clientX - r.left, y: e.clientY - r.top, radius: 8 })?.object as Dot | undefined
        if (hit?.live && hit.night) pick.current(hit.night)
      }
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect()
        const hit = d.pickObject({ x: e.clientX - r.left, y: e.clientY - r.top, radius: 8 })?.object as Dot | undefined
        el.style.cursor = hit?.live ? 'pointer' : ''
      }
      el.addEventListener('click', onClick)
      el.addEventListener('mousemove', onMove)
      onApi(api)
      return () => {
        el.removeEventListener('click', onClick)
        el.removeEventListener('mousemove', onMove)
        onApi(null)
        d.finalize()
        markers.forEach((mk) => mk.remove())
        m.remove()
      }
    } catch (e) {
      onError(e)
      deck?.finalize()
      map?.remove()
    }
    // spikes is stable for the page's life; callbacks are read through refs or are state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spikes])

  return <div ref={container} className="rain-canvas" />
}
