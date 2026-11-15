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
const NEUTRAL: [number, number, number] = [138, 138, 148]

/** What the map shows: the rain (spikes fading in time), or a static month for reduced motion. */
export type Frame = { kind: 'rain'; visible: readonly Visible[] } | { kind: 'month'; month: number }

export interface RainMapApi {
  draw(frame: Frame): void
}

interface Dot {
  /** Index into the sorted spikes, for the hover label. */
  i: number
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
        i, night: s.night_id, lon: s.lon, lat: s.lat, r: radiusPx(s.ratio) * (1 + 0.7 * age),
        fill: [r, g, b, s.status === OPEN_QUESTION ? 0 : Math.round(150 * a)], line: [r, g, b, Math.round(255 * a)], live: age < 0.75, ring: s.status === OPEN_QUESTION,
      }
    })
  }
  // Static month: every spike is a dot; the chosen month in its status color, the rest quiet grey.
  return spikes.map((sp, i) => {
    const s = sp.row
    const on = sp.month === frame.month
    const [r, g, b] = on ? rgb(s.status) : NEUTRAL
    return {
      i, night: s.night_id, lon: s.lon, lat: s.lat, r: on ? radiusPx(s.ratio) : 3,
      fill: [r, g, b, s.status === OPEN_QUESTION && on ? 0 : on ? 190 : 70], line: [r, g, b, on ? 255 : 0], live: on, ring: on && s.status === OPEN_QUESTION,
    }
  })
}

interface Props {
  spikes: readonly Timed[]
  /** The canvas's accessible name, in the reader's language. */
  label: string
  /** Hover text for one spike's dot. */
  tipFor: (row: Timed['row']) => string
  onApi: (api: RainMapApi | null) => void
  onPick: (nightId: string) => void
  onError: (e: unknown) => void
  /** The basemap style failed before the first render: the dots still draw, on a blank background. */
  onBasemapError: () => void
}

export default function RainMap({ spikes, label, tipFor, onApi, onPick, onError, onBasemapError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const tip = useRef(tipFor)
  tip.current = tipFor
  const basemapError = useRef(onBasemapError)
  basemapError.current = onBasemapError
  const initialLabel = useRef(label)

  // A language switch renames the canvas in place; the map itself is built once.
  useEffect(() => { mapRef.current?.getCanvas().setAttribute('aria-label', label) }, [label])

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
        // Fixed camera: the page scrolls, and a 50svh map would otherwise trap touch scrolling on a phone.
        interactive: false,
        // The credit is a line of page text under the map (SpikeRain.tsx .rn-credit): readable in both themes, 44px
        // targets, and no late expand when the source attribution arrives.
        attributionControl: false,
        locale: { 'Map.Title': initialLabel.current },
        // The third-party Positron style logs two filter warnings (highway shields) on every load; they draw nothing here.
        validateStyle: false,
      })
      const m = map
      mapRef.current = m
      let loaded = false
      m.on('load', () => {
        loaded = true
        // A monitor's own label already names its place ("Galena Park", "HRM-16 Deer Park"): fade the basemap's
        // matching place label instead of printing the name twice, one over the other.
        const dupes = new Set<string>()
        for (const row of sites.values()) {
          const words = row.site.split(' ')
          dupes.add(row.site)
          for (let k = 1; k <= words.length - 2; k++) dupes.add(words.slice(k).join(' '))
        }
        for (const layer of m.getStyle().layers) {
          if (layer.type !== 'symbol' || layer['source-layer'] !== 'place') continue
          try {
            m.setPaintProperty(layer.id, 'text-opacity', ['case', ['in', ['get', 'name'], ['literal', [...dupes]]], 0, 1])
          } catch (e) { console.warn('Timeline base map: could not fade', layer.id, e) }
        }
      })
      m.on('error', (e) => {
        // Before the first render this is the style or its tiles: say so on the map. Later, a single tile: log only.
        console.warn('Timeline base map:', e.error?.message ?? e)
        if (!loaded) basemapError.current()
      })
      const bounds = new LngLatBounds()
      const sites = new Map<string, Timed['row']>()
      for (const s of spikes) {
        bounds.extend([s.row.lon, s.row.lat])
        if (!sites.has(s.row.site_id)) sites.set(s.row.site_id, s.row)
      }
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
      const fit = () => {
        if (bounds.isEmpty() || el.clientWidth < 40 || el.clientHeight < 40) return
        const w = el.clientWidth, h = el.clientHeight
        const room = (want: number, size: number) => Math.min(want, Math.max(0, (size - 40) / 2))
        // The date box (SpikeRain's .rn-hud) sits over the top-left corner of this map.
        const hud = el.parentElement?.querySelector<HTMLElement>('.rn-hud')
        const hudW = (hud?.offsetWidth ?? 220) + 16, hudH = (hud?.offsetHeight ?? 70) + 16
        // Wide maps: room on the right for the monitor names that run right of each dot. Bottom: a spike's ring.
        const right = w >= 600 ? 120 : 36, bottom = 40
        // Clear the date box from above or from the left, whichever leaves the monitors drawn larger: the cluster
        // is wider than tall, so on a wide, short map clearing it from the left spreads the monitors further apart.
        const pads = [{ top: hudH, bottom, left: 36, right }, { top: 24, bottom, left: hudW, right }]
          .map((p) => ({ top: room(p.top, h), bottom: room(p.bottom, h), left: room(p.left, w), right: room(p.right, w) }))
        const zoom = (padding: (typeof pads)[number]) => m.cameraForBounds(bounds, { padding, maxZoom: 11 })?.zoom ?? -Infinity
        m.fitBounds(bounds, { padding: zoom(pads[1]) > zoom(pads[0]) ? pads[1] : pads[0], maxZoom: 11, duration: 0 })
        placeLabels()
      }
      // Each name goes right of its dot unless that covers another monitor's dot or an already placed name; then left,
      // below or above. If no side is clear it stays right.
      const SIDES = ['rain-r', 'rain-l', 'rain-b', 'rain-t']
      const placeLabels = () => {
        const box = el.getBoundingClientRect()
        const dots = markers.map((mk) => mk.getElement().getBoundingClientRect())
        const names: DOMRect[] = []
        const hits = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        markers.forEach((mk, i) => {
          const dot = mk.getElement(), label = dot.querySelector('span')
          if (!label) return
          const clear = (side: string) => {
            dot.classList.remove(...SIDES)
            dot.classList.add(side)
            const r = label.getBoundingClientRect()
            if (!r.width) return true // names are hidden on narrow screens
            const inside = r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
            return inside && !dots.some((d, j) => j !== i && hits(r, d)) && !names.some((n) => hits(r, n))
          }
          if (!SIDES.some(clear)) clear(SIDES[0])
          const placed = label.getBoundingClientRect()
          if (placed.width) names.push(placed)
        })
      }
      fit()

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
      // Mouse-only label for the dot under the pointer (touch and keyboard readers have the Latest list).
      const tipEl = document.createElement('div')
      tipEl.className = 'rn-tip'
      tipEl.setAttribute('aria-hidden', 'true')
      tipEl.hidden = true
      el.append(tipEl)
      const hideTip = () => { tipEl.hidden = true; el.style.cursor = '' }
      const sync = () => d.setProps({ viewState: camera() })
      m.on('move', sync)
      m.on('resize', () => { fit(); sync() })

      const api: RainMapApi = {
        draw(frame) {
          // The dots move under a still pointer during playback; a stale label would name the wrong spike.
          hideTip()
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
        const x = e.clientX - r.left, y = e.clientY - r.top
        const hit = d.pickObject({ x, y, radius: 8 })?.object as Dot | undefined
        if (!hit?.live) return hideTip()
        el.style.cursor = hit.night ? 'pointer' : ''
        tipEl.textContent = tip.current(spikes[hit.i].row)
        tipEl.hidden = false
        // Above and right of the pointer, flipped inward near the right and top edges.
        const w = tipEl.offsetWidth, h = tipEl.offsetHeight
        tipEl.style.left = `${Math.max(4, x + 14 + w > r.width ? x - 14 - w : x + 14)}px`
        tipEl.style.top = `${Math.max(4, y - 14 - h < 0 ? y + 14 : y - 14 - h)}px`
      }
      el.addEventListener('click', onClick)
      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', hideTip)
      onApi(api)
      return () => {
        el.removeEventListener('click', onClick)
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', hideTip)
        tipEl.remove()
        mapRef.current = null
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
