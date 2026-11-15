import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Deck, MapView } from '@deck.gl/core'
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Facility, Monitor, PlumeEvent } from './types'
import { destination, mergeArcs, readingText, sectorRing } from './format'
import { placeReadout } from './geo'
import type { Place } from './PlaceSearch'

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

// Opening "global → local" intro: globe projection zoomed out to Earth, then a fly-in to the event.
// Only MapLibre-native pieces render on the globe; the deck.gl overlay is hidden until the flat replay is back.
type Phase = 'globe' | 'flying' | 'flat'
const INTRO_HOLD_MS = 900
const INTRO_FLY_MS = 2500
const INTRO_PIN_LABEL = 'Houston Ship Channel: 1 real night replayed'
const introPinLabel = (ev: PlumeEvent) => (ev.region ? `${ev.region.label}: new region, not backtested` : INTRO_PIN_LABEL)
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
// `?intro=0` opens straight on the flat replay (scripted captures such as demo/flows, deep links into a step).
const introOptedOut = () => new URLSearchParams(window.location.search).get('intro') === '0'
// The fly-in pulls tiles at every zoom on the way down: measured 5.7 MB on a 375px phone and 12.4 MB at
// 1440px, against 0.17 / 0.26 MB for the flat view alone. Decision (owner): it plays on load only on wide
// screens (the same 1024px breakpoint as the side-by-side layout); phones open flat and keep "Show globe".
// Browsers in Data Saver mode don't get it on load either.
const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
const wideScreen = () => window.matchMedia?.('(min-width: 1024px)').matches ?? false
const introOnLoad = () => wideScreen() && !prefersReducedMotion() && !introOptedOut() && !saveData()

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
  /** Searched or picked place; pinned only when it is inside the replay's coverage. */
  place: Place | null
}

const PIN_SVG = '<svg width="26" height="32" viewBox="0 0 26 32" aria-hidden="true"><path d="M13 31s11-10.4 11-18.5A11 11 0 0 0 2 12.5C2 20.6 13 31 13 31z" fill="#6d28d9" stroke="#fff" stroke-width="2"/><circle cx="13" cy="12.5" r="4" fill="#fff"/></svg>'

export function EventMap({ ev, corridor, highlightId, hour, place }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLUListElement>(null)
  const highlight = useRef(highlightId)
  const applyHighlight = useRef<(id: string | null) => void>(() => {})
  const hourRef = useRef(hour)
  const [failure, setFailure] = useState<unknown>(null)
  const [phase, setPhase] = useState<Phase>(() => (introOnLoad() ? 'globe' : 'flat'))
  const skipIntro = useRef<() => void>(() => {})
  const replayIntro = useRef<() => void>(() => {})
  const applyHour = useRef<(h: number) => void>(() => {})
  const placeRef = useRef(place)
  const applyPlace = useRef<(p: Place | null) => void>(() => {})

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
    const reduceMotion = prefersReducedMotion()
    // Mirrors the React `phase` state for code running inside MapLibre/deck callbacks.
    let phaseNow: Phase = introOnLoad() ? 'globe' : 'flat'
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
      // The intro starts zoomed out to Earth (projection switches to globe once the style loads).
      center: phaseNow === 'flat' ? [trigger.lon, trigger.lat] : [trigger.lon - 35, trigger.lat - 8],
      zoom: phaseNow === 'flat' ? 11 : 1.4,
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
    const fitPadding = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w < 40 || h < 40) return null
      const room = (want: number, size: number) => Math.min(want, Math.max(0, (size - 32) / 2))
      const side = room(isNarrow() ? 64 : 80, w)
      const wantTop = (legend.current?.offsetHeight ?? 0) + 28, wantBottom = 48
      const scale = Math.min(1, Math.max(0, h - 32) / (wantTop + wantBottom))
      return { top: wantTop * scale, bottom: wantBottom * scale, left: side, right: side }
    }
    const fit = () => {
      const padding = fitPadding()
      if (padding) map.fitBounds(bounds, { padding, maxZoom: 14, duration: 0 })
    }
    // With the intro, the flat view is fitted when the intro ends (finishIntro), by this same fit().
    if (phaseNow === 'flat') fit()

    // Pulse ring on the trigger monitor is a CSS-animated DOM marker; CSS honours prefers-reduced-motion.
    // MapLibre positions a marker through its element's `transform`, so the animated ring is a child.
    const pulse = document.createElement('div')
    pulse.className = 'pulse-anchor'
    pulse.setAttribute('aria-hidden', 'true')
    pulse.appendChild(document.createElement('div')).className = 'pulse-ring'
    if (phaseNow !== 'flat') pulse.style.display = 'none'
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
      phaseNow !== 'flat' ? null : (deck.pickObject({ x, y, radius: 6, layerIds: ['facilities'] })?.object as Facility | undefined)?.id ?? null
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
      showDeck()
    }
    // kn: the standalone deck overlay only matches MapLibre's camera when flat and untilted; it is hidden on the
    // globe and while the map is pitched, and shown again the moment the flat, untilted replay is back.
    const showDeck = () => {
      deckHost.style.visibility = phaseNow === 'flat' && map.getPitch() === 0 ? '' : 'hidden'
    }
    showDeck()
    map.on('move', sync)
    map.on('resize', sync)

    // ResizeObserver runs outside React, so an error here would skip the error boundary; hand it over.
    const ro = new ResizeObserver(() => {
      try {
        map.resize()
        if (phaseNow === 'flat') fit()
      } catch (e) {
        setFailure(e)
      }
    })
    ro.observe(el)

    // Intro: one MapLibre marker on the globe, a hold, a fly-in, then the exact flat replay (same fit()).
    const pin = document.createElement('div')
    pin.className = 'intro-pin'
    pin.setAttribute('aria-hidden', 'true')
    pin.innerHTML = '<span class="intro-dot"></span><span class="intro-label"></span>'
    ;(pin.querySelector('.intro-label') as HTMLElement).textContent = introPinLabel(ev)
    const pinMarker = new Marker({ element: pin, anchor: 'bottom' }).setLngLat([trigger.lon, trigger.lat])
    let introTimer = 0
    const setIntroPhase = (p: Phase) => {
      phaseNow = p
      setPhase(p)
      showDeck()
    }
    const finishIntro = () => {
      if (phaseNow === 'flat') return
      setIntroPhase('flat')
      window.clearTimeout(introTimer)
      map.stop()
      pinMarker.remove()
      map.setProjection({ type: 'mercator' })
      pulse.style.display = ''
      fit()
      sizePulse()
      redraw()
    }
    const startIntro = () => {
      setIntroPhase('globe')
      pulse.style.display = 'none'
      // Target computed on the flat projection, so the fly lands where fit() will put the camera.
      const padding = fitPadding()
      const target = (padding && map.cameraForBounds(bounds, { padding, maxZoom: 14 })) || { center: [trigger.lon, trigger.lat] as [number, number], zoom: 10 }
      map.setProjection({ type: 'globe' })
      map.jumpTo({ center: [trigger.lon - 35, trigger.lat - 8], zoom: 1.4, pitch: 0, bearing: 0 })
      pinMarker.addTo(map)
      introTimer = window.setTimeout(() => {
        setIntroPhase('flying')
        map.once('moveend', finishIntro)
        map.flyTo({ center: target.center, zoom: target.zoom, bearing: 0, pitch: 0, duration: INTRO_FLY_MS, essential: true })
      }, INTRO_HOLD_MS)
    }
    if (phaseNow !== 'flat') map.once('style.load', startIntro)
    skipIntro.current = finishIntro

    // Searched place: a violet teardrop (no data point on this map is a teardrop), framed with the nearest
    // monitor and facility so the readout's distances are on screen. Far places get no pin and no camera move.
    const placeEl = document.createElement('div')
    placeEl.className = 'place-pin'
    placeEl.setAttribute('aria-hidden', 'true')
    placeEl.innerHTML = `${PIN_SVG}<span class="place-label"></span>`
    const placeMarker = new Marker({ element: placeEl, anchor: 'bottom' })
    applyPlace.current = (p) => {
      placeMarker.remove()
      if (!p) return
      const r = placeReadout(ev, p)
      if (r.kind === 'far') return
      if (phaseNow !== 'flat') finishIntro()
      ;(placeEl.querySelector('.place-label') as HTMLElement).textContent = p.label
      placeMarker.setLngLat([p.lon, p.lat]).addTo(map)
      const frame = new LngLatBounds([p.lon, p.lat], [p.lon, p.lat])
      frame.extend([r.monitorAt.lon, r.monitorAt.lat])
      if (r.facility) frame.extend([r.facility.lon, r.facility.lat])
      // The flagged monitor stays in frame so the place is always seen against the spike.
      frame.extend([trigger.lon, trigger.lat])
      const padding = fitPadding()
      const flipLabel = () => placeEl.classList.toggle('label-left', map.project([p.lon, p.lat]).x > el.clientWidth - 220)
      if (!padding) return flipLabel()
      // Near the right edge the label goes on the pin's left so it isn't clipped (checked once the camera lands).
      map.once('moveend', flipLabel)
      // Extra top room for the pin, which stands above its point, kept inside the same clamp fitPadding() applies.
      const top = Math.min(padding.top + 36, Math.max(0, el.clientHeight - 32 - padding.bottom))
      map.fitBounds(frame, { padding: { ...padding, top }, maxZoom: 12, duration: reduceMotion ? 0 : 1200 })
    }
    if (placeRef.current) applyPlace.current(placeRef.current)
    replayIntro.current = () => {
      if (phaseNow === 'flat') startIntro()
    }

    return () => {
      ro.disconnect()
      window.clearTimeout(introTimer)
      skipIntro.current = () => {}
      replayIntro.current = () => {}
      applyPlace.current = () => {}
      placeMarker.remove()
      pinMarker.remove()
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

  useEffect(() => {
    placeRef.current = place
    applyPlace.current(place)
  }, [place])

  const placeShown = place !== null && placeReadout(ev, place).kind === 'near'

  // Re-thrown during render (after every hook) so MapSlot's error boundary shows its fallback.
  if (failure) throw failure

  return (
    <>
      <div ref={container} className="map-canvas" data-phase={phase} />
      {phase !== 'flat' && (
        <p className="intro-caption" role="status">
          {/* The pin is aria-hidden, so its words are repeated here for screen readers only. */}
          <span className="sr-only">{introPinLabel(ev)}. </span>More cities later. One real night replayed here.
        </p>
      )}
      <div className={phase === 'flat' ? 'intro-ctl is-flat' : 'intro-ctl'}>
        {phase !== 'flat'
          ? <button type="button" className="btn" onClick={() => skipIntro.current()}>Skip intro</button>
          : !prefersReducedMotion() && (
            <button type="button" className="btn" aria-label="Show globe" onClick={() => replayIntro.current()}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="10" cy="10" r="8" /><ellipse cx="10" cy="10" rx="3.6" ry="8" /><path d="M2 10h16M3.5 5.5h13M3.5 14.5h13" />
              </svg>
              {/* Phones show the icon only so the button covers less of the map. */}
              <span className="wide-only"> Show globe</span>
            </button>
          )}
      </div>
      {/* Hidden (not removed) during the intro: fit() measures its height for the top padding. */}
      <ul ref={legend} className={phase === 'flat' ? 'legend' : 'legend is-hidden'} aria-hidden="true">
        <li><span className="lg lg-pulse" /> Flagged monitor</li>
        <li><span className="lg lg-scale" /> Monitor (size = {ev.compound.units})</li>
        <li><span className="lg lg-nodata" /> No data</li>
        <li><span className="lg lg-facility">1</span> Facility</li>
        {ev.record_check.matched_facility_id && <li><span className="lg lg-matched">1</span> Filed report</li>}
        <li><span className="lg lg-line" /> Wind this hour</li>
        {ev.corridor && <li><span className="lg lg-corridor" /> {CORRIDOR_LABEL}</li>}
        {placeShown && <li><span className="lg lg-place" /> Searched place</li>}
      </ul>
    </>
  )
}
