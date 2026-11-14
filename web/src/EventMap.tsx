import { useEffect, useRef } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck, MapView } from '@deck.gl/core'
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Facility, Monitor, PlumeEvent } from './types'
import { destination, mergeArcs, sectorRing } from './format'

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
  focus: [11, 87, 208, 255] as RGBA,
  corridorFill: [190, 30, 45, 22] as RGBA,
  corridorLine: [190, 30, 45, 140] as RGBA,
  corridorText: [140, 20, 30, 255] as RGBA,
}

const CORRIDOR_LABEL = 'Upwind corridor (wind direction only)'

// With dozens of facilities, only these get a standing label; the rest show their name on hover, tap, or
// focus in the Trace list (which stays the full text equivalent).
const NEAREST_LABELED = 3

interface Props {
  ev: PlumeEvent
  corridor: Facility[]
  labelId: string
  /** Facility id highlighted from the Trace list (hover or keyboard focus). */
  highlightId: string | null
}

export function EventMap({ ev, corridor, labelId, highlightId }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLUListElement>(null)
  const highlight = useRef(highlightId)
  const applyHighlight = useRef<(id: string | null) => void>(() => {})

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
    const standing = new Set([...corridor.slice(0, NEAREST_LABELED).map((f) => f.id), ...(matchedId ? [matchedId] : [])])
    let hoverId: string | null = null
    // Matched facility drawn last so neighbours never cover it.
    const drawOrder = [...ev.facilities.filter((f) => f.id !== matchedId), ...ev.facilities.filter((f) => f.id === matchedId)]

    // Line length: out to the farthest facility in the corridor, so the line spans what the list shows.
    const reachKm = corridor.length ? Math.max(...corridor.map((f) => f.distance_km)) : 0
    const upwindEnd = wind && reachKm > 0 ? destination(trigger.lat, trigger.lon, wind.from_deg, reachKm) : null

    // Corridor wedge straight from event.json: origin monitor, ±half_width_deg around each wind-from bearing.
    const cor = ev.corridor
    const origin = cor && ev.monitors.find((m) => m.site_id === cor.origin_site_id)
    const arcs = cor && origin ? mergeArcs(cor.wind_from_deg, cor.half_width_deg) : []
    const wedges = cor && origin ? arcs.map(([a, b]) => ({ ring: sectorRing(origin.lat, origin.lon, a, b, cor.max_km) })) : []
    const widest = arcs.reduce<[number, number] | null>((w, a) => (!w || a[1] - a[0] > w[1] - w[0] ? a : w), null)
    const corridorLabelAt = cor && origin && widest ? destination(origin.lat, origin.lon, (widest[0] + widest[1]) / 2, cor.max_km * 0.85) : null

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
    wedges.forEach((w) => w.ring.forEach((p) => bounds.extend(p)))
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

    const isRevealed = (f: Facility) => f.id === hoverId || f.id === highlight.current
    const labeled = () => {
      const seen = new Set<string>()
      // Facility ids can repeat in the data; label each id once.
      return ev.facilities.filter((f) => (standing.has(f.id) || isRevealed(f)) && !seen.has(f.id) && seen.add(f.id))
    }

    // Labels on the right part of the view grow leftwards so they don't run off the edge.
    let labelEpoch = 0
    const onRightSide = (f: Facility) => map.project([f.lon, f.lat]).x > el.clientWidth * 0.6

    const buildLayers = (narrow: boolean) => [
      wedges.length > 0 &&
        new PolygonLayer<{ ring: [number, number][] }>({
          id: 'corridor',
          data: wedges,
          getPolygon: (d) => d.ring,
          filled: true,
          getFillColor: C.corridorFill,
          stroked: true,
          getLineColor: C.corridorLine,
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
        }),
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
        data: drawOrder,
        pickable: true,
        getPosition: (f) => [f.lon, f.lat],
        getRadius: (f) => (isRevealed(f) ? 11 : f.id === matchedId ? 10 : 8),
        radiusUnits: 'pixels',
        getFillColor: facilityColor,
        stroked: true,
        getLineColor: (f) => (isRevealed(f) ? C.focus : C.white),
        getLineWidth: (f) => (isRevealed(f) ? 3 : 2),
        lineWidthUnits: 'pixels',
        updateTriggers: { getRadius: [hoverId, highlight.current], getLineColor: [hoverId, highlight.current], getLineWidth: [hoverId, highlight.current] },
      }),
      new TextLayer<Facility>({
        id: 'facility-numbers',
        data: drawOrder.filter((f) => order.has(f.id)),
        getPosition: (f) => [f.lon, f.lat],
        getText: (f) => String(order.get(f.id)),
        getSize: 10,
        getColor: C.white,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }),
      new TextLayer<Facility>({
        id: 'facility-labels',
        data: labeled(),
        getPosition: (f) => [f.lon, f.lat],
        getText: facilityLabel,
        getColor: (f) => (f.id === matchedId ? C.matched : C.text),
        getSize: narrow ? 11 : 12,
        getTextAnchor: (f) => (onRightSide(f) ? 'end' : 'start'),
        getAlignmentBaseline: 'center',
        getPixelOffset: (f) => (onRightSide(f) ? [-13, 0] : [13, 0]),
        updateTriggers: { getTextAnchor: labelEpoch, getPixelOffset: labelEpoch },
        background: true,
        getBackgroundColor: C.labelBg,
        backgroundPadding: [4, 2],
        fontFamily: 'system-ui, sans-serif',
        characterSet: 'auto',
      }),
      // Drawn last so dots never cover it; phones carry this label in the legend instead.
      !narrow &&
        corridorLabelAt &&
        new TextLayer({
          id: 'corridor-label',
          data: [{ pos: corridorLabelAt }],
          getPosition: (d: { pos: [number, number] }) => d.pos,
          getText: () => CORRIDOR_LABEL,
          getSize: 12,
          getColor: C.corridorText,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          background: true,
          getBackgroundColor: C.labelBg,
          backgroundPadding: [4, 2],
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
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
    const redraw = () => deck.setProps({ layers: buildLayers(narrow) })
    applyHighlight.current = (id) => {
      highlight.current = id
      redraw()
    }
    // Hover (mouse) and tap (touch) reveal a facility's name; picking runs on deck's own buffer.
    const pickAt = (x: number, y: number) =>
      (deck.pickObject({ x, y, radius: 6, layerIds: ['facilities'] })?.object as Facility | undefined)?.id ?? null
    const setHover = (id: string | null) => {
      if (id === hoverId) return
      hoverId = id
      map.getCanvas().style.cursor = id ? 'pointer' : ''
      redraw()
    }
    const onMove = (e: MapMouseEvent) => setHover(pickAt(e.point.x, e.point.y))
    const onClick = (e: MapMouseEvent) => setHover(pickAt(e.point.x, e.point.y))
    const onOut = () => setHover(null)
    map.on('mousemove', onMove)
    map.on('click', onClick)
    map.on('mouseout', onOut)
    const onMoveEnd = () => {
      labelEpoch++
      redraw()
    }
    map.on('moveend', onMoveEnd)
    const sync = () => {
      if (narrow !== isNarrow()) {
        narrow = isNarrow()
        redraw()
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
      map.off('mousemove', onMove)
      map.off('click', onClick)
      map.off('mouseout', onOut)
      map.off('moveend', onMoveEnd)
      applyHighlight.current = () => {}
      deck.finalize()
      map.remove()
    }
  }, [ev, corridor])

  useEffect(() => {
    applyHighlight.current(highlightId)
  }, [highlightId])

  return (
    <>
      <div ref={container} className="map-canvas" aria-labelledby={labelId} />
      <ul ref={legend} className="legend" aria-hidden="true">
        <li><span className="lg lg-trigger" /> Monitor that flagged</li>
        <li><span className="lg lg-monitor" /> Other monitor</li>
        <li><span className="lg lg-facility">1</span> Facility in corridor</li>
        {ev.record_check.matched_facility_id && <li><span className="lg lg-matched">1</span> Filed a report</li>}
        <li><span className="lg lg-line" /> Upwind direction</li>
        {ev.corridor && <li><span className="lg lg-corridor" /> {CORRIDOR_LABEL}</li>}
      </ul>
    </>
  )
}
