import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck, MapView } from '@deck.gl/core'
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Facility, Monitor, PlumeEvent } from './types'
import { destination, mergeArcs, readingText, sectorRing } from './format'

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
  // 3.9:1 on Positron land (#f2f3f0) and 3.4:1 over the corridor fill; the old 140,140,150 was 2.99:1.
  facilityOut: [120, 120, 130, 255] as RGBA,
  matched: [0, 110, 60, 255] as RGBA,
  white: [255, 255, 255, 255] as RGBA,
  upwind: [190, 30, 45, 200] as RGBA,
  labelBg: [255, 255, 255, 235] as RGBA,
  text: [20, 20, 24, 255] as RGBA,
  focus: [11, 87, 208, 255] as RGBA,
  noData: [110, 110, 120, 255] as RGBA,
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
  /** Facility id highlighted from the Trace list (hover or keyboard focus). */
  highlightId: string | null
  /** Replay hour (CST) whose readings and wind the map shows. */
  hour: number
}

export function EventMap({ ev, corridor, highlightId, hour }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLUListElement>(null)
  const highlight = useRef(highlightId)
  const applyHighlight = useRef<(id: string | null) => void>(() => {})
  const hourRef = useRef(hour)
  const [failure, setFailure] = useState<unknown>(null)
  const applyHour = useRef<(h: number) => void>(() => {})

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
    // The view is fitted to the detection-hour line so the camera doesn't jump while the replay plays.
    const upwindEnd = wind && reachKm > 0 ? destination(trigger.lat, trigger.lon, wind.from_deg, reachKm) : null

    // Replay: each monitor's circle grows and reddens with that hour's reading; a missing hour is a hollow ring.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const maxReading = Math.max(...ev.monitors.flatMap((m) => m.hourly.map((h) => h.value ?? 0)), 1e-9)
    const readingAt = (m: Monitor) => m.hourly.find((h) => h.hour_cst === hourRef.current)
    const share = (v: number) => Math.sqrt(Math.max(0, v) / maxReading)
    const monitorRadius = (m: Monitor, narrow = false) => {
      const v = readingAt(m)?.value
      return v == null ? 7 : 5 + (narrow ? 10 : 17) * share(v)
    }
    const monitorFill = (m: Monitor): RGBA => {
      const v = readingAt(m)?.value
      if (v == null) return [255, 255, 255, 0]
      const t = share(v)
      return [Math.round(120 + (190 - 120) * t), Math.round(165 + (30 - 165) * t), Math.round(215 + (45 - 215) * t), 255]
    }
    const monitorText = (m: Monitor) => {
      const h = readingAt(m)
      return `${m.name}\n${h ? readingText(h.value, h.flag, ev.compound.units) : 'no data'}`
    }
    // Upwind line and arrow for the replay hour: the line points to where the air came from, the arrow
    // points back toward the monitor (the direction the air moved).
    const upwindFor = (h: number) => {
      const w = ev.wind.hourly.find((x) => x.hour_cst === h)
      if (!w || reachKm <= 0) return null
      const end = destination(trigger.lat, trigger.lon, w.from_deg, reachKm)
      const tipKm = reachKm * 0.3, len = Math.max(reachKm * 0.07, 0.3)
      const tip = destination(trigger.lat, trigger.lon, w.from_deg, tipKm)
      const base = destination(trigger.lat, trigger.lon, w.from_deg, tipKm + len)
      const left = destination(base[1], base[0], w.from_deg - 90, len * 0.55)
      const right = destination(base[1], base[0], w.from_deg + 90, len * 0.55)
      return { path: [[trigger.lon, trigger.lat], end] as [number, number][], arrow: [tip, left, right, tip] as [number, number][] }
    }

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
      // The surrounding section already names the map; this names the interactive canvas inside it.
      locale: { 'Map.Title': 'Interactive map: arrow keys pan, plus and minus zoom' },
    })

    const bounds = new LngLatBounds()
    ev.monitors.forEach((m) => bounds.extend([m.lon, m.lat]))
    ev.facilities.forEach((f) => bounds.extend([f.lon, f.lat]))
    if (upwindEnd) bounds.extend(upwindEnd)
    wedges.forEach((w) => w.ring.forEach((p) => bounds.extend(p)))
    // Top padding clears the legend; side padding leaves room for the centred labels under each point.
    // Padding is clamped to the container: a map shorter or narrower than its padding has no room to fit
    // into (MapLibre warns, and older builds threw NaN coordinates). Below ~40px there's nothing to fit.
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w < 40 || h < 40) return
      const room = (want: number, size: number) => Math.min(want, Math.max(0, (size - 32) / 2))
      const side = room(isNarrow() ? 64 : 80, w)
      const wantTop = (legend.current?.offsetHeight ?? 0) + 28, wantBottom = 48
      const scale = Math.min(1, Math.max(0, h - 32) / (wantTop + wantBottom))
      map.fitBounds(bounds, { padding: { top: wantTop * scale, bottom: wantBottom * scale, left: side, right: side }, maxZoom: 14, duration: 0 })
    }
    fit()

    // Pulse ring on the trigger monitor is a CSS-animated DOM marker; CSS honours prefers-reduced-motion.
    // MapLibre positions a marker through its element's `transform`, so the animated ring is a child.
    const pulse = document.createElement('div')
    pulse.className = 'pulse-anchor'
    pulse.setAttribute('aria-hidden', 'true')
    pulse.appendChild(document.createElement('div')).className = 'pulse-ring'
    const pulseMarker = new Marker({ element: pulse }).setLngLat([trigger.lon, trigger.lat]).addTo(map)
    // The ring hugs the trigger circle, whose size now follows the replay hour.
    const sizePulse = () => {
      const d = 2 * monitorRadius(trigger, isNarrow()) + 8
      pulse.style.width = pulse.style.height = `${d}px`
    }

    const facilityColor = (f: Facility) =>
      f.id === matchedId ? C.matched : corridorIds.has(f.id) ? C.facility : C.facilityOut
    const facilityLabel = (f: Facility) => {
      const n = order.get(f.id)
      const tag = f.id === matchedId && ev.record_check.incident ? `\nFiled report #${ev.record_check.incident}` : ''
      return `${n ? `${n}. ` : ''}${f.name}${tag}`
    }

    const isRevealed = (f: Facility) => f.id === hoverId || f.id === highlight.current
    // Standing labels that would overlap an already placed label are dropped (the dot and the Trace list
    // still carry them); a label the reader asked for (hover, tap, focus) always shows.
    const labeled = () => {
      const seen = new Set<string>()
      // Facility ids can repeat in the data; label each id once.
      const wanted = ev.facilities.filter((f) => (standing.has(f.id) || isRevealed(f)) && !seen.has(f.id) && seen.add(f.id))
      const rank = (f: Facility) => (isRevealed(f) ? 0 : f.id === matchedId ? 1 : 2 + (order.get(f.id) ?? 99))
      wanted.sort((a, b) => rank(a) - rank(b))
      const placed: number[][] = []
      const tp = map.project([trigger.lon, trigger.lat])
      const tw = trigger.name.length * 6.6, tr = monitorRadius(trigger, isNarrow())
      placed.push([tp.x - tw / 2, tp.y + tr + 5, tp.x + tw / 2, tp.y + tr + 35])
      const hits = (b: number[]) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1])
      return wanted.filter((f) => {
        const lines = facilityLabel(f).split('\n')
        const w = Math.max(...lines.map((l) => l.length)) * 6.6, h = lines.length * 15
        const { x, y } = map.project([f.lon, f.lat])
        const where = placement(f)
        const box = where === 'right' ? [x + 13, y - h / 2, x + 13 + w, y + h / 2]
          : where === 'left' ? [x - 13 - w, y - h / 2, x - 13, y + h / 2]
          : [x - w / 2, y + 13, x + w / 2, y + 13 + h]
        if (!isRevealed(f) && hits(box)) return false
        placed.push(box)
        return true
      })
    }

    let labelEpoch = 0
    // kn: width estimated at ~6.6px per character of the longest label line; measure text if labels get styled.
    // Right of the dot if it fits, else left, else centred underneath.
    const placement = (f: Facility): 'right' | 'left' | 'below' => {
      const w = 13 + Math.max(...facilityLabel(f).split('\n').map((l) => l.length)) * 6.6
      const x = map.project([f.lon, f.lat]).x
      if (x + w <= el.clientWidth - 8) return 'right'
      if (x - w >= 8) return 'left'
      return 'below'
    }
    const ANCHOR = { right: 'start', left: 'end', below: 'middle' } as const
    const BASELINE = { right: 'center', left: 'center', below: 'top' } as const
    const OFFSET = { right: [13, 0], left: [-13, 0], below: [0, 13] } as const

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
      upwindFor(hourRef.current) &&
        new PathLayer({
          id: 'upwind',
          data: [upwindFor(hourRef.current)],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: C.upwind,
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
        }),
      upwindFor(hourRef.current) &&
        new PolygonLayer<{ arrow: [number, number][] }>({
          id: 'upwind-arrow',
          data: [upwindFor(hourRef.current) as { arrow: [number, number][] }],
          getPolygon: (d) => d.arrow,
          getFillColor: C.trigger,
          stroked: false,
        }),
      new ScatterplotLayer<Monitor>({
        id: 'monitors',
        data: ev.monitors,
        getPosition: (m) => [m.lon, m.lat],
        getRadius: (m) => monitorRadius(m, narrow),
        radiusUnits: 'pixels',
        getFillColor: monitorFill,
        stroked: true,
        getLineColor: (m) => (readingAt(m)?.value == null ? C.noData : C.white),
        getLineWidth: (m) => (readingAt(m)?.value == null ? 2.5 : 2),
        lineWidthUnits: 'pixels',
        updateTriggers: { getRadius: hourRef.current, getFillColor: hourRef.current, getLineColor: hourRef.current, getLineWidth: hourRef.current },
        transitions: reduceMotion ? undefined : { getRadius: 250, getFillColor: 250 },
      }),
      new TextLayer<Monitor>({
        id: 'monitor-labels',
        data: narrow ? [trigger] : ev.monitors,
        getPosition: (m) => [m.lon, m.lat],
        getText: monitorText,
        getSize: 12,
        getColor: (m) => (m.site_id === trigger.site_id ? C.trigger : C.monitor),
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        getPixelOffset: (m) => [0, monitorRadius(m, narrow) + 5],
        updateTriggers: { getText: hourRef.current, getPixelOffset: hourRef.current },
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
        getTextAnchor: (f) => ANCHOR[placement(f)],
        getAlignmentBaseline: (f) => BASELINE[placement(f)],
        getPixelOffset: (f) => [...OFFSET[placement(f)]],
        updateTriggers: { getTextAnchor: labelEpoch, getAlignmentBaseline: labelEpoch, getPixelOffset: labelEpoch },
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
      // deck's input manager makes its canvas a tab stop (tabIndex 0, no focus ring) even with no controller.
      // It does nothing for keyboard users, and the Trace list is the map's text equivalent, so take it out.
      onLoad: () => {
        const c = deckHost.querySelector('canvas')
        if (!c) return
        c.tabIndex = -1
        c.setAttribute('aria-hidden', 'true')
      },
    })
    let narrow = isNarrow()
    const redraw = () => deck.setProps({ layers: buildLayers(narrow) })
    applyHour.current = (h) => {
      hourRef.current = h
      sizePulse()
      redraw()
    }
    sizePulse()
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
        sizePulse()
        redraw()
      }
      deck.setProps({ viewState: camera() })
    }
    map.on('move', sync)
    map.on('resize', sync)

    // ResizeObserver runs outside React, so an error here would skip the error boundary; hand it over.
    const ro = new ResizeObserver(() => {
      try {
        map.resize()
        fit()
      } catch (e) {
        setFailure(e)
      }
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
      applyHour.current = () => {}
      deck.finalize()
      map.remove()
    }
  }, [ev, corridor])

  useEffect(() => {
    applyHighlight.current(highlightId)
  }, [highlightId])

  useEffect(() => {
    applyHour.current(hour)
  }, [hour])

  // Re-thrown during render (after every hook) so MapSlot's error boundary shows its fallback.
  if (failure) throw failure

  return (
    <>
      <div ref={container} className="map-canvas" />
      <ul ref={legend} className="legend" aria-hidden="true">
        <li><span className="lg lg-pulse" /> Flagged monitor</li>
        <li><span className="lg lg-scale" /> Monitor (size = {ev.compound.units})</li>
        <li><span className="lg lg-nodata" /> No data</li>
        <li><span className="lg lg-facility">1</span> Facility</li>
        {ev.record_check.matched_facility_id && <li><span className="lg lg-matched">1</span> Filed report</li>}
        <li><span className="lg lg-line" /> Wind this hour</li>
        {ev.corridor && <li><span className="lg lg-corridor" /> {CORRIDOR_LABEL}</li>}
      </ul>
    </>
  )
}
