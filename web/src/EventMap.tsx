import { useEffect, useRef } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck, MapView } from '@deck.gl/core'
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Facility, Monitor, PlumeEvent } from './types'
import { compass, destination, hourLabel } from './format'

// MapLibre 6 ships its worker as a separate module; Vite needs its URL (per the OpenFreeMap quick start).
setWorkerUrl(workerUrl)

// Verified 2026-11-14 on openfreemap.org/quick_start: styles live at tiles.openfreemap.org/styles/<name>.
// Positron is a muted light basemap, so the colored markers stay readable.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
// The tile source's TileJSON already adds "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";
// this adds the standard OSM credit wording on top.
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'

type RGBA = [number, number, number, number]
const C = {
  monitor: [31, 94, 160, 255] as RGBA,
  trigger: [190, 30, 45, 255] as RGBA,
  facility: [45, 45, 52, 255] as RGBA,
  facilityOut: [140, 140, 150, 255] as RGBA,
  matched: [0, 110, 60, 255] as RGBA,
  white: [255, 255, 255, 255] as RGBA,
  upwind: [190, 30, 45, 200] as RGBA,
  labelBg: [255, 255, 255, 235] as RGBA,
  text: [20, 20, 24, 255] as RGBA,
}

interface Props {
  ev: PlumeEvent
  corridor: Facility[]
  labelId: string
}

export function EventMap({ ev, corridor, labelId }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    // Narrow maps (phones) drop the labels that collide; the Trace step's list carries every name.
    const isNarrow = () => el.clientWidth < 600
    const trigger = ev.monitors.find((m) => m.site_id === ev.detection.site_id) as Monitor
    const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)
    const matchedId = ev.record_check.matched_facility_id
    const corridorIds = new Set(corridor.map((f) => f.id))
    const order = new Map(corridor.map((f, i) => [f.id, i + 1]))

    // Line length: out to the farthest facility in the corridor, so the line spans what the list shows.
    const reachKm = corridor.length ? Math.max(...corridor.map((f) => f.distance_km)) : 0
    const upwindEnd = wind && reachKm > 0 ? destination(trigger.lat, trigger.lon, wind.from_deg, reachKm) : null

    const map = new MlMap({
      container: el,
      style: STYLE_URL,
      center: [trigger.lon, trigger.lat],
      zoom: 11,
      attributionControl: { compact: false, customAttribution: ATTRIBUTION },
      locale: { 'Map.Title': 'Map of monitors and facilities. The same facilities are listed as text in the Trace step.' },
    })

    const bounds = new LngLatBounds()
    ev.monitors.forEach((m) => bounds.extend([m.lon, m.lat]))
    ev.facilities.forEach((f) => bounds.extend([f.lon, f.lat]))
    if (upwindEnd) bounds.extend(upwindEnd)
    // Top padding clears the legend; side padding leaves room for the centred labels under each point.
    const fit = () => {
      const side = isNarrow() ? 64 : 80
      const top = (legend.current?.offsetHeight ?? 0) + 28
      map.fitBounds(bounds, { padding: { top, bottom: 48, left: side, right: side }, maxZoom: 14, duration: 0 })
    }
    fit()

    // Pulse ring on the trigger monitor is a CSS-animated DOM marker; CSS honours prefers-reduced-motion.
    // MapLibre positions a marker through its element's `transform`, so the animated ring is a child.
    const pulse = document.createElement('div')
    pulse.className = 'pulse-anchor'
    pulse.setAttribute('aria-hidden', 'true')
    pulse.appendChild(document.createElement('div')).className = 'pulse-ring'
    const pulseMarker = new Marker({ element: pulse }).setLngLat([trigger.lon, trigger.lat]).addTo(map)

    const facilityColor = (f: Facility) =>
      f.id === matchedId ? C.matched : corridorIds.has(f.id) ? C.facility : C.facilityOut
    const facilityLabel = (f: Facility) => {
      const n = order.get(f.id)
      const tag = f.id === matchedId && ev.record_check.incident ? `\nFiled report #${ev.record_check.incident}` : ''
      return `${n ? `${n}. ` : ''}${f.name}${tag}`
    }

    const buildLayers = (narrow: boolean) => [
      upwindEnd &&
        new PathLayer({
          id: 'upwind',
          data: [{ path: [[trigger.lon, trigger.lat], upwindEnd] }],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: C.upwind,
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
        }),
      !narrow &&
        upwindEnd &&
        wind &&
        new TextLayer({
          id: 'upwind-label',
          data: [{ pos: [(trigger.lon + upwindEnd[0]) / 2, (trigger.lat + upwindEnd[1]) / 2] }],
          getPosition: (d: { pos: [number, number] }) => d.pos,
          getText: () => `Upwind at ${hourLabel(wind.hour_cst)}: wind from ${compass(wind.from_deg)} (${wind.from_deg}°)`,
          getSize: 12,
          getColor: C.trigger,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: [0, -8],
          background: true,
          getBackgroundColor: C.labelBg,
          backgroundPadding: [4, 2],
          fontFamily: 'system-ui, sans-serif',
          characterSet: 'auto',
        }),
      new ScatterplotLayer<Monitor>({
        id: 'monitors',
        data: ev.monitors,
        getPosition: (m) => [m.lon, m.lat],
        getRadius: (m) => (m.site_id === trigger.site_id ? 9 : 6),
        radiusUnits: 'pixels',
        getFillColor: (m) => (m.site_id === trigger.site_id ? C.trigger : C.monitor),
        stroked: true,
        getLineColor: C.white,
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
      }),
      new TextLayer<Monitor>({
        id: 'monitor-labels',
        data: narrow ? [trigger] : ev.monitors,
        getPosition: (m) => [m.lon, m.lat],
        getText: (m) => m.name,
        getSize: 12,
        getColor: (m) => (m.site_id === trigger.site_id ? C.trigger : C.monitor),
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        getPixelOffset: [0, 13],
        background: true,
        getBackgroundColor: C.labelBg,
        backgroundPadding: [4, 2],
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
        characterSet: 'auto',
      }),
      new ScatterplotLayer<Facility>({
        id: 'facilities',
        data: ev.facilities,
        getPosition: (f) => [f.lon, f.lat],
        getRadius: (f) => (f.id === matchedId ? 10 : 8),
        radiusUnits: 'pixels',
        getFillColor: facilityColor,
        stroked: true,
        getLineColor: C.white,
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
      }),
      new TextLayer<Facility>({
        id: 'facility-numbers',
        data: ev.facilities.filter((f) => order.has(f.id)),
        getPosition: (f) => [f.lon, f.lat],
        getText: (f) => String(order.get(f.id)),
        getSize: 11,
        getColor: C.white,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }),
      new TextLayer<Facility>({
        id: 'facility-labels',
        data: ev.facilities,
        getPosition: (f) => [f.lon, f.lat],
        getText: facilityLabel,
        getSize: 12,
        getColor: (f) => (f.id === matchedId ? C.matched : C.text),
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        getPixelOffset: [0, 13],
        background: true,
        getBackgroundColor: C.labelBg,
        backgroundPadding: [4, 2],
        fontFamily: 'system-ui, sans-serif',
        characterSet: 'auto',
      }),
    ].filter(Boolean)

    // kn: standalone Deck synced to the MapLibre camera, because @deck.gl/mapbox 9.4.1 reads map.transform,
    // which MapLibre 6 removed (throws inside MapLibre's render loop). Swap back to MapboxOverlay once a
    // deck.gl release supports MapLibre 6; fine at pitch 0, may drift if the map is ever pitched or globed.
    const deckHost = document.createElement('div')
    deckHost.className = 'deck-host'
    map.getCanvasContainer().appendChild(deckHost)
    const camera = () => {
      const c = map.getCenter()
      return { longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
    }
    const deck = new Deck({
      parent: deckHost,
      views: new MapView({ repeat: true }),
      viewState: camera(),
      controller: false,
      layers: buildLayers(isNarrow()),
    })
    let narrow = isNarrow()
    const sync = () => {
      if (narrow !== isNarrow()) {
        narrow = isNarrow()
        deck.setProps({ layers: buildLayers(narrow) })
      }
      deck.setProps({ viewState: camera() })
    }
    map.on('move', sync)
    map.on('resize', sync)

    const ro = new ResizeObserver(() => {
      map.resize()
      fit()
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      pulseMarker.remove()
      map.off('move', sync)
      map.off('resize', sync)
      deck.finalize()
      map.remove()
    }
  }, [ev, corridor])

  return (
    <>
      <div ref={container} className="map-canvas" aria-labelledby={labelId} />
      <ul ref={legend} className="legend" aria-hidden="true">
        <li><span className="lg lg-trigger" /> Monitor that flagged</li>
        <li><span className="lg lg-monitor" /> Other monitor</li>
        <li><span className="lg lg-facility">1</span> Facility in corridor</li>
        {ev.record_check.matched_facility_id && <li><span className="lg lg-matched">1</span> Filed a report</li>}
        <li><span className="lg lg-line" /> Upwind direction</li>
      </ul>
    </>
  )
}
