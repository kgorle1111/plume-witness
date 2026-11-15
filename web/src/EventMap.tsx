import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './EventMap.css'
import { Deck, MapView } from '@deck.gl/core'
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Facility, Monitor, PlumeEvent } from './types'
import { destination, mergeArcs, readingText, sectorRing, unitShort } from './format'
import { placeReadout } from './geo'
import type { Place } from './PlaceSearch'
import { tintBasemap } from './basemapTint'
import { dotsNear, hit, layoutLabels, numberedDots, type Box, type LabelAsk, type Placed } from './labelLayout'
import { LANDING_METRICS } from './landingMetrics'
import { introOnLoad as introRule } from './mapIntro'
import { REGIONS } from './region'
import { useT, type Translate } from './useT'

// MapLibre 6 ships its worker as a separate module; Vite needs its URL (per the OpenFreeMap quick start).
setWorkerUrl(workerUrl)

// Verified 2026-11-14 on openfreemap.org/quick_start: styles live at tiles.openfreemap.org/styles/<name>.
// Positron is a muted light basemap, so the colored markers stay readable.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
// The tile source's TileJSON already adds "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";
// this adds the standard OSM credit wording on top.
const ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'

type RGBA = [number, number, number, number]
// The teal / coral / sage palette (index.css tokens; the tiles stay light in both themes, so these do too). Marks are
// 3:1 or more on the retinted land (#eef4f2, basemapTint.ts): coral trigger 3.45, monitor teal 7.0, facility 11.3,
// out-of-corridor facility 4.0 (3.4 over the corridor fill and over peach industrial land), filed facility 5.6,
// no-data ring 4.7. Label text sits on a near-opaque white plate:
// coral ink 6.0, teal ink 7.8, sage ink 6.3, ink 15.
const C = {
  monitor: [51, 88, 93, 255] as RGBA,
  trigger: [208, 96, 77, 255] as RGBA,
  triggerText: [169, 67, 47, 255] as RGBA,
  // Soft coral disc under the flagged monitor, so the spike is the first thing the eye finds.
  triggerHalo: [208, 96, 77, 56] as RGBA,
  facility: [36, 54, 59, 255] as RGBA,
  facilityOut: [110, 121, 124, 255] as RGBA,
  matched: [47, 107, 87, 255] as RGBA,
  white: [255, 255, 255, 255] as RGBA,
  upwind: [208, 96, 77, 235] as RGBA,
  labelBg: [255, 255, 255, 240] as RGBA,
  text: [20, 41, 46, 255] as RGBA,
  focus: [78, 122, 128, 255] as RGBA,
  noData: [98, 111, 114, 255] as RGBA,
  corridorFill: [224, 122, 104, 44] as RGBA,
  corridorLine: [208, 96, 77, 200] as RGBA,
  corridorText: [169, 67, 47, 255] as RGBA,
  // Violet: the triangulation overlay (other monitors' wedges, facilities inside every wedge).
  triLine: [109, 40, 217, 200] as RGBA,
  triFill: [109, 40, 217, 14] as RGBA,
}

// Opening "global → local" intro: globe projection zoomed out to Earth, then a fly-in to the event.
// Only MapLibre-native pieces render on the globe; the deck.gl overlay is hidden until the flat replay is back.
type Phase = 'globe' | 'flying' | 'flat'
const INTRO_HOLD_MS = 900
const INTRO_FLY_MS = 2500
// The pin names the place; the caption says what the replay is one of. Houston's numbers are the landing page's own
// (landingMetrics.ts, tested against spikes.json), so the two pages can't disagree.
const introPinLabel = (ev: PlumeEvent, t: Translate) => (ev.region ? t('map.introPinNew', { region: ev.region.label }) : REGIONS.houston.place)
const introCaption = (ev: PlumeEvent, t: Translate) =>
  ev.region ? t('map.introCaptionNew') : t('map.introCaption', { spikes: LANDING_METRICS.spikes, monitors: LANDING_METRICS.monitors })
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
// The fly-in pulls tiles at every zoom on the way down: measured 5.7 MB on a 375px phone and 12.4 MB at
// 1440px, against 0.17 / 0.26 MB for the flat view alone. Decision (owner): it plays on load only on wide
// screens (the same 1024px breakpoint as the side-by-side layout); phones open flat and keep "Show globe".
// mapIntro.ts has the rest of the rule (night links, embeds, ?intro=0, Data Saver).
const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
const wideScreen = () => window.matchMedia?.('(min-width: 1024px)').matches ?? false
const introOnLoad = () => introRule(window.location.search, { wide: wideScreen(), reducedMotion: prefersReducedMotion(), saveData: saveData() })
// Phones and tablets: one finger scrolls the page, two move the map (a reader scrolling past the map got stuck panning it).
const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false
// Basemap symbol layers whose filter compares `ref_length` with a number; tiles without it logged a type warning on
// every map load. Missing becomes "too long", so those shields still don't draw.
const SHIELD_LEN = ['<=', ['get', 'ref_length'], 6]
const quietShieldFilters = (style: StyleSpecification, monitorNames: string[]): StyleSpecification => ({
  ...style,
  layers: style.layers.map((l) => {
    let out = l
    if ('filter' in l && JSON.stringify(l.filter).includes(JSON.stringify(SHIELD_LEN))) {
      const swap = (x: unknown): unknown => (JSON.stringify(x) === JSON.stringify(SHIELD_LEN) ? ['<=', ['coalesce', ['get', 'ref_length'], 99], 6] : Array.isArray(x) ? x.map(swap) : x)
      out = { ...out, filter: swap(l.filter) } as typeof l
    }
    // A basemap place name that repeats a monitor's own label ("Galena Park" twice) is left to the monitor label.
    if (l.type === 'symbol' && 'source-layer' in l && l['source-layer'] === 'place' && l.layout?.['text-field'] && monitorNames.length) {
      const name = ['coalesce', ['get', 'name_en'], ['get', 'name']]
      const field = ['case', ['in', ['downcase', ['to-string', name]], ['literal', monitorNames]], '', l.layout['text-field']]
      out = { ...out, layout: { ...l.layout, 'text-field': field } } as typeof l
    }
    return out
  }),
})

// With dozens of facilities, only these get a standing label on wide maps; the rest show their name on hover,
// tap, or focus in the Trace list (which stays the full text equivalent). Narrow maps label only the filed-report
// facility (see numbered() below).
const NEAREST_LABELED = 3
// Projector-size screens get map labels 2px larger (the page text scales up at the same width in index.css).
const bigLabels = () => window.matchMedia?.('(min-width: 1600px)').matches ?? false
// Map text sizes in px: a 12px floor on phones, 14 on laptops (read from the back of a room), 16 on projectors.
const textPx = (narrow: boolean) => (narrow ? 12 : bigLabels() ? 16 : 14)
// A phone tap lists every facility dot within this many px instead of guessing the nearest.
const TAP_CHOOSE_PX = 20

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
  const keyBtn = useRef<HTMLButtonElement>(null)
  const ctl = useRef<HTMLDivElement>(null)
  const t = useT()
  const tRef = useRef(t)
  const applyLang = useRef<() => void>(() => {})
  // Below 1440px wide the legend folds behind "Key" so the map keeps its height (App.css hides the button wider up).
  const [keyOpen, setKeyOpen] = useState(false)
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
  const applyKey = useRef<(open: boolean) => void>(() => {})
  const reveal = useRef<(id: string | null) => void>(() => {})
  // Shown when the basemap style or its tiles fail: the dots still draw, on white, and the Trace list has every name.
  const [baseFailed, setBaseFailed] = useState(false)
  // A phone tap that lands on several facility dots lists them here (nearest first) instead of guessing one.
  const [choices, setChoices] = useState<{ id: string; label: string }[] | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    // Narrow maps (phones) drop the labels that collide; the Trace step's list carries every name. One breakpoint
    // for all narrow-map rules: at 500-600px the facility cluster is as crowded as at 375px.
    const isNarrow = () => el.clientWidth < 600
    const trigger = ev.monitors.find((m) => m.site_id === ev.detection.site_id) as Monitor
    const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)
    const matchedId = ev.record_check.matched_facility_id
    const corridorIds = new Set(corridor.map((f) => f.id))
    const order = new Map(corridor.map((f, i) => [f.id, i + 1]))
    const standing = new Set([...corridor.slice(0, NEAREST_LABELED).map((f) => f.id), ...(matchedId ? [matchedId] : [])])
    let hoverId: string | null = null
    // Farthest first, so where dots overlap the nearer one is on top (and keeps its number, see numberedDots);
    // the matched facility is drawn last so neighbours never cover it.
    const far = (f: Facility) => order.get(f.id) ?? Infinity
    const drawOrder = [...ev.facilities.filter((f) => f.id !== matchedId).sort((a, b) => far(b) - far(a)), ...ev.facilities.filter((f) => f.id === matchedId)]

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
      // Light teal (low) to coral (high), the legend's lg-scale swatch.
      return [Math.round(157 + (208 - 157) * t), Math.round(191 + (96 - 191) * t), Math.round(195 + (77 - 195) * t), 255]
    }
    const monitorText = (m: Monitor) => {
      const h = readingAt(m)
      return `${m.name}\n${h ? readingText(h.value, h.flag, unitShort(ev.compound.units)) : tRef.current('map.noData')}`
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
    // Triangulation (informational): drawn only when the pipeline says intersecting the wedges narrows the list.
    const tri = ev.triangulation?.verdict === 'narrows' ? ev.triangulation : null
    const triWedges = tri
      ? tri.monitors.slice(1).flatMap((m) => mergeArcs(m.wind_from_deg, tri.half_width_deg).map(([a, b]) => ({ ring: sectorRing(m.lat, m.lon, a, b, tri.max_km) })))
      : []
    const triIds = new Set(tri ? tri.intersection_ids : [])

    const monitorNames = ev.monitors.map((m) => m.name.toLowerCase())
    const coop = coarsePointer()
    const map = new MlMap({
      container: el,
      style: STYLE_URL,
      transformStyle: (_prev, next) => tintBasemap(quietShieldFilters(next, monitorNames)),
      // The intro starts zoomed out to Earth (projection switches to globe once the style loads).
      center: phaseNow === 'flat' ? [trigger.lon, trigger.lat] : [trigger.lon - 35, trigger.lat - 8],
      zoom: phaseNow === 'flat' ? 11 : 1.4,
      // MapLibre's responsive default: full credit on wide maps; at 640px and under it starts open and folds to its
      // (i) button once the reader moves or taps the map (two wrapped lines covered 11% of a 240px phone map).
      attributionControl: { customAttribution: ATTRIBUTION },
      cooperativeGestures: coop,
      // The surrounding section already names the map; this names the interactive canvas inside it.
      locale: {
        'Map.Title': tRef.current('map.title'),
        'CooperativeGesturesHandler.MobileHelpText': tRef.current('map.twoFingers'),
        'CooperativeGesturesHandler.WindowsHelpText': tRef.current('map.zoomKey', { key: 'Ctrl' }),
        'CooperativeGesturesHandler.MacHelpText': tRef.current('map.zoomKey', { key: '⌘' }),
      },
    })
    // The credit stays hidden until the tile source adds its line: it used to show the short custom line first and
    // then grow to two lines ~5s in, the replay's largest layout shift on a phone.
    el.classList.add('attrib-pending')
    const foldAttrib = () => el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')?.classList.remove('maplibregl-compact-show')
    // On a phone the full credit shows when the map first appears, then folds to its (i) button after a few seconds
    // (or at the first tap), as MapLibre does on a drag; one-finger drags no longer reach the map.
    let foldTimer = 0
    const attribReady = () => {
      el.classList.remove('attrib-pending')
      window.clearTimeout(foldTimer)
      foldTimer = window.setTimeout(foldAttrib, 5000)
    }
    map.once('load', attribReady)
    // Basemap failure: the style never loads, or tiles error and nothing from the basemap is drawn.
    let tileErrors = 0
    const onMapError = (e: { error?: unknown; tile?: unknown; sourceId?: string }) => {
      // A listener replaces MapLibre's own console report, so keep one.
      console.warn('Map error:', e.error)
      if (!map.isStyleLoaded()) {
        attribReady()
        setBaseFailed(true)
      } else if (e.tile || e.sourceId) tileErrors++
    }
    const onIdle = () => {
      if (!tileErrors) return setBaseFailed(false)
      try {
        setBaseFailed(map.queryRenderedFeatures().length === 0)
      } catch {
        setBaseFailed(true)
      }
      tileErrors = 0
    }
    map.on('error', onMapError)
    map.on('idle', onIdle)

    // On phones the open legend drops below the map (EventMap.css), so only a legend inside the map's box takes room.
    const legendOver = () => !!legend.current && legend.current.offsetHeight > 0 && legend.current.offsetTop < el.clientHeight
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
      const wantTop = (legendOver() ? legend.current?.offsetHeight ?? 0 : 0) + 28, wantBottom = 48
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
      const tag = f.id === matchedId && ev.record_check.incident ? `\n${tRef.current('map.filedReport', { id: ev.record_check.incident })}` : ''
      return `${n ? `${n}. ` : ''}${f.name}${tag}`
    }

    const isRevealed = (f: Facility) => f.id === hoverId || f.id === highlight.current
    // Phones keep one standing facility mark, the filed-report facility's number and name; every other facility
    // is a plain dot whose number and name show on tap (or from the Trace list, which carries them all).
    const numbered = (f: Facility, narrow: boolean) => order.has(f.id) && (!narrow || f.id === matchedId || isRevealed(f))
    const facilityRadius = (f: Facility, narrow: boolean) => (isRevealed(f) ? 11 : f.id === matchedId ? 10 : narrow ? 6 : 8)

    // Screen boxes of every dot on the map, so standing labels can be kept off them.
    const dotBoxes = (narrow: boolean) => [
      ...ev.monitors.map((m) => ({ id: m.site_id, r: monitorRadius(m, narrow), p: map.project([m.lon, m.lat]) })),
      ...ev.facilities.map((f) => ({ id: f.id, r: facilityRadius(f, narrow), p: map.project([f.lon, f.lat]) })),
    ].map(({ id, r, p }) => ({ id, box: [p.x - r, p.y - r, p.x + r, p.y + r] as Box }))
    // kn: width estimated at ~0.55em per character of the longest line; measure text if labels get styled.
    const textBox = (text: string, size: number): [number, number] => {
      const lines = text.split('\n')
      return [Math.max(...lines.map((l) => l.length)) * size * 0.55 + 8, lines.length * size * 1.25 + 4]
    }
    const labelSize = textPx
    const monitorSize = textPx
    // The legend sits over the top of the map; a label under it is hidden, so that strip counts as off the map.
    const visibleTop = () => (legendOver() && legend.current ? legend.current.offsetTop + legend.current.offsetHeight : 0)
    // Buttons over the map (Key, Show globe) hide what is under them, so labels keep off them too.
    const buttonBoxes = (): Box[] => {
      const at = el.getBoundingClientRect()
      return [keyBtn.current, ctl.current].flatMap((b) => {
        const r = b?.getBoundingClientRect()
        return r && r.width > 0 ? [[r.left - at.left, r.top - at.top, r.right - at.left, r.bottom - at.top] as Box] : []
      })
    }
    // Basemap place names (Galena Park, Deer Park, ...): a monitor reading keeps off them when it has a free side.
    const placeNameCost = (b: Box) => {
      try {
        const layers = map.getStyle().layers.filter((l) => l.type === 'symbol' && 'source-layer' in l && l['source-layer'] === 'place').map((l) => l.id)
        return layers.length && map.queryRenderedFeatures([[b[0], b[1]], [b[2], b[3]]], { layers }).length ? 2 : 0
      } catch {
        return 0 // style not loaded yet: no basemap names to avoid
      }
    }
    // The flagged monitor's marker, pulse ring included: no other label may cover it (a reading sat on half of it).
    const triggerRing = (narrow: boolean): Box => {
      const p = map.project([trigger.lon, trigger.lat]), r = monitorRadius(trigger, narrow) + 4
      return [p.x - r, p.y - r, p.x + r, p.y + r]
    }

    // One layout pass per redraw (labelLayout.ts): the flagged monitor's reading (fixed under its circle), the other
    // monitors' readings, then facility names, then the corridor label in a clear spot or not at all. A standing name
    // that would cover a placed label is dropped (the dot and the Trace list still carry it); a label the reader asked
    // for (hover, tap, focus) and the filed-report facility's always show.
    const layout = (narrow: boolean) => {
      const dots = dotBoxes(narrow)
      const monitorAsk = (m: Monitor): LabelAsk => {
        const p = map.project([m.lon, m.lat])
        return { id: m.site_id, x: p.x, y: p.y, size: textBox(monitorText(m), monitorSize(narrow)), gap: monitorRadius(m, narrow) + 5 }
      }
      const standingNow = narrow ? new Set(matchedId ? [matchedId] : []) : standing
      const seen = new Set<string>()
      // Facility ids can repeat in the data; label each id once.
      const wanted = ev.facilities.filter((f) => (standingNow.has(f.id) || isRevealed(f)) && !seen.has(f.id) && seen.add(f.id))
      const rank = (f: Facility) => (isRevealed(f) ? 0 : f.id === matchedId ? 1 : 2 + (order.get(f.id) ?? 99))
      wanted.sort((a, b) => rank(a) - rank(b))
      const res = layoutLabels({
        width: el.clientWidth,
        height: el.clientHeight,
        top: visibleTop(),
        dots,
        reserved: [...buttonBoxes(), triggerRing(narrow)],
        trigger: monitorAsk(trigger),
        // Phones label only the flagged monitor; the timeline's "All monitors" list carries every reading.
        monitors: narrow ? [] : ev.monitors.filter((m) => m.site_id !== trigger.site_id).map(monitorAsk),
        facilities: wanted.map((f) => {
          const p = map.project([f.lon, f.lat])
          return { id: f.id, x: p.x, y: p.y, size: textBox(facilityLabel(f), labelSize(narrow)), gap: 13, must: isRevealed(f) || f.id === matchedId }
        }),
        soft: placeNameCost,
      })
      // Two numbers drawn on top of each other read as neither: where dots overlap, the nearer one keeps its number.
      const numberedIds = numberedDots(
        [...drawOrder].reverse().filter((f) => numbered(f, narrow)).map((f) => {
          const p = map.project([f.lon, f.lat])
          return { id: f.id, x: p.x, y: p.y, r: facilityRadius(f, narrow) }
        }),
        new Set([...(matchedId ? [matchedId] : []), ...ev.facilities.filter(isRevealed).map((f) => f.id)]),
      )
      // A dot drawn over a basemap place name hides the name a resident looks for ("Galena Park" under the dots), so
      // those dots are drawn see-through; the matched and asked-for ones stay solid.
      const overName = new Set(ev.facilities.filter((f) => f.id !== matchedId && !isRevealed(f)).filter((f) => {
        const r = facilityRadius(f, narrow), p = map.project([f.lon, f.lat])
        return placeNameCost([p.x - r, p.y - r, p.x + r, p.y + r]) > 0
      }).map((f) => f.id))
      return { monitorsAt: res.monitors, where: res.facilities, numberedIds, overName, corridorAt: corridorSpot(dots, res.placed, narrow) }
    }

    // The corridor label goes inside the wedge where it covers no dot and no other label: along the widest arc's
    // centre line first, then swung toward its edges. With no clear spot it is left off; the legend names it.
    const corridorSpot = (dots: { box: Box }[], placed: Box[], narrow: boolean): [number, number] | null => {
      if (!cor || !origin || !widest) return null
      const size = textBox(tRef.current('map.corridor'), monitorSize(narrow))
      const span = widest[1] - widest[0]
      const inside = (b: Box) => b[0] >= 4 && b[2] <= el.clientWidth - 4 && b[1] >= visibleTop() && b[3] <= el.clientHeight - 4
      for (const reach of [0.85, 0.95, 0.75, 0.65, 0.55, 0.45]) {
        for (const swing of [0, -0.25, 0.25, -0.4, 0.4]) {
          const at = destination(origin.lat, origin.lon, (widest[0] + widest[1]) / 2 + swing * span, cor.max_km * reach)
          const p = map.project(at)
          const b: Box = [p.x - size[0] / 2, p.y - size[1] / 2, p.x + size[0] / 2, p.y + size[1] / 2]
          if (inside(b) && !dots.some((d) => hit(b, d.box)) && !placed.some((q) => hit(b, q))) return at
        }
      }
      return null
    }

    let labelEpoch = 0
    const ANCHOR = { right: 'start', left: 'end', below: 'middle', above: 'middle' } as const
    const BASELINE = { right: 'center', left: 'center', below: 'top', above: 'bottom' } as const
    // Pixel offset of a label `gap` px from its point on the side layout chose (plus any slide along the edge).
    const offsetOf = (p: Placed | undefined, gap: number): [number, number] => {
      const w = p?.where ?? 'below', dx = p?.dx ?? 0
      return w === 'right' ? [gap, 0] : w === 'left' ? [-gap, 0] : w === 'below' ? [dx, gap] : [dx, -gap]
    }

    const buildLayers = (narrow: boolean) => {
      const { monitorsAt, where, numberedIds, overName, corridorAt } = layout(narrow)
      // Placement is recomputed on every redraw (hour, hover, camera), so the label accessors rerun every time.
      const epoch = ++labelEpoch
      const placeOf = (f: Facility) => where.get(f.id)?.where ?? 'below'
      const mPlace = (m: Monitor) => monitorsAt.get(m.site_id)?.where ?? 'below'
      // A TextLayer with no rows builds a 0x0 glyph atlas and WebGL logs "texSubImage2D: no canvas" (night 2, where
      // every standing facility name is dropped), so empty text layers are left out.
      const numberRows = drawOrder.filter((f) => numbered(f, narrow) && numberedIds.has(f.id))
      const monitorRows = ev.monitors.filter((m) => monitorsAt.has(m.site_id))
      const facilityRows = ev.facilities.filter((f, i, all) => where.has(f.id) && all.findIndex((g) => g.id === f.id) === i)
      return [
      wedges.length > 0 &&
        new PolygonLayer<{ ring: [number, number][] }>({
          id: 'corridor',
          data: wedges,
          getPolygon: (d) => d.ring,
          filled: true,
          getFillColor: C.corridorFill,
          stroked: true,
          getLineColor: C.corridorLine,
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
        }),
      triWedges.length > 0 &&
        new PolygonLayer<{ ring: [number, number][] }>({
          id: 'tri-wedges',
          data: triWedges,
          getPolygon: (d) => d.ring,
          filled: true,
          getFillColor: C.triFill,
          stroked: true,
          getLineColor: C.triLine,
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
        }),
      triIds.size > 0 &&
        new ScatterplotLayer<Facility>({
          id: 'tri-rings',
          data: ev.facilities.filter((f) => triIds.has(f.id)),
          getPosition: (f) => [f.lon, f.lat],
          getRadius: 13,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: C.triLine,
          getLineWidth: 2.5,
          lineWidthUnits: 'pixels',
        }),
      upwindFor(hourRef.current) &&
        new PathLayer({
          id: 'upwind',
          data: [upwindFor(hourRef.current)],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: C.upwind,
          getWidth: 5,
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
        id: 'trigger-halo',
        data: [trigger],
        getPosition: (m) => [m.lon, m.lat],
        getRadius: (m) => monitorRadius(m, narrow) + (narrow ? 10 : 16),
        radiusUnits: 'pixels',
        getFillColor: C.triggerHalo,
        updateTriggers: { getRadius: hourRef.current },
        transitions: reduceMotion ? undefined : { getRadius: 250 },
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
      new ScatterplotLayer<Facility>({
        id: 'facilities',
        data: drawOrder,
        pickable: true,
        getPosition: (f) => [f.lon, f.lat],
        getRadius: (f) => facilityRadius(f, narrow),
        radiusUnits: 'pixels',
        getFillColor: (f) => (overName.has(f.id) ? [...facilityColor(f).slice(0, 3), 110] as RGBA : facilityColor(f)),
        stroked: true,
        getLineColor: (f) => (isRevealed(f) ? C.focus : overName.has(f.id) ? [255, 255, 255, 140] : C.white),
        getLineWidth: (f) => (isRevealed(f) ? 3 : 2),
        lineWidthUnits: 'pixels',
        updateTriggers: { getRadius: [hoverId, highlight.current, narrow], getFillColor: epoch, getLineColor: [hoverId, highlight.current, epoch], getLineWidth: [hoverId, highlight.current] },
      }),
      numberRows.length > 0 && new TextLayer<Facility>({
        id: 'facility-numbers',
        data: numberRows,
        getPosition: (f) => [f.lon, f.lat],
        getText: (f) => String(order.get(f.id)),
        // 12px fits two digits inside a 16px dot; phones number only the larger filed-report and tapped dots.
        getSize: 12,
        getColor: C.white,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }),
      // Above the facility dots: a reading is never hidden under a dot (layout keeps it off them where it can).
      monitorRows.length > 0 && new TextLayer<Monitor>({
        id: 'monitor-labels',
        data: monitorRows,
        getPosition: (m) => [m.lon, m.lat],
        getText: monitorText,
        getSize: monitorSize(narrow),
        getColor: (m) => (m.site_id === trigger.site_id ? C.triggerText : C.monitor),
        getTextAnchor: (m) => ANCHOR[mPlace(m)],
        getAlignmentBaseline: (m) => BASELINE[mPlace(m)],
        getPixelOffset: (m) => offsetOf(monitorsAt.get(m.site_id), monitorRadius(m, narrow) + 5),
        updateTriggers: { getText: [hourRef.current, epoch], getTextAnchor: epoch, getAlignmentBaseline: epoch, getPixelOffset: epoch },
        background: true,
        getBackgroundColor: C.labelBg,
        backgroundPadding: [4, 2],
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
        characterSet: 'auto',
      }),
      facilityRows.length > 0 && new TextLayer<Facility>({
        id: 'facility-labels',
        data: facilityRows,
        getPosition: (f) => [f.lon, f.lat],
        getText: facilityLabel,
        getColor: (f) => (f.id === matchedId ? C.matched : C.text),
        getSize: labelSize(narrow),
        getTextAnchor: (f) => ANCHOR[placeOf(f)],
        getAlignmentBaseline: (f) => BASELINE[placeOf(f)],
        getPixelOffset: (f) => offsetOf(where.get(f.id), 13),
        updateTriggers: { getText: epoch, getTextAnchor: epoch, getAlignmentBaseline: epoch, getPixelOffset: epoch },
        background: true,
        getBackgroundColor: C.labelBg,
        backgroundPadding: [4, 2],
        fontFamily: 'system-ui, sans-serif',
        characterSet: 'auto',
      }),
      // Drawn last; placed only where it covers no dot (see corridorSpot), and the legend names the wedge too.
      corridorAt &&
        new TextLayer({
          id: 'corridor-label',
          data: [{ pos: corridorAt }],
          getPosition: (d: { pos: [number, number] }) => d.pos,
          getText: () => tRef.current('map.corridor'),
          getSize: monitorSize(narrow),
          updateTriggers: { getText: epoch },
          characterSet: 'auto',
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
    }

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
      phaseNow !== 'flat' ? null : (deck.pickObject({ x, y, radius: narrow ? 10 : 6, layerIds: ['facilities'] })?.object as Facility | undefined)?.id ?? null
    const setHover = (id: string | null) => {
      if (id === hoverId) return
      hoverId = id
      map.getCanvas().style.cursor = id ? 'pointer' : ''
      redraw()
    }
    const onMove = (e: MapMouseEvent) => setHover(pickAt(e.point.x, e.point.y))
    // On a phone (or any narrow map) a tap over a crowded cluster lists the dots under the finger to choose from.
    const onClick = (e: MapMouseEvent) => {
      foldAttrib()
      if ((narrow || coop) && phaseNow === 'flat') {
        const near = dotsNear(ev.facilities.map((f) => ({ id: f.id, f, ...map.project([f.lon, f.lat]) })), e.point.x, e.point.y, TAP_CHOOSE_PX)
        if (near.length > 1) {
          const n = (f: Facility) => order.get(f.id)
          setChoices(near.slice(0, 8).map(({ id, f }) => ({ id, label: `${n(f) ? `${n(f)}. ` : ''}${f.name}` })))
          return
        }
      }
      setChoices(null)
      setHover(pickAt(e.point.x, e.point.y))
    }
    reveal.current = (id) => {
      setChoices(null)
      setHover(id)
    }
    const onOut = () => setHover(null)
    map.on('mousemove', onMove)
    map.on('click', onClick)
    map.on('mouseout', onOut)
    const onMoveEnd = () => redraw()
    map.on('moveend', onMoveEnd)
    const closeChoices = () => setChoices(null)
    map.on('movestart', closeChoices)

    // "Key" opens the legend over the top of the map. When it would cover the flagged monitor or the filed-report
    // facility (a 240px phone map: legend 82px tall), the camera frames those two below it; closing restores the fit.
    let keyFramed = false
    applyKey.current = (open) => {
      if (phaseNow !== 'flat') return
      if (!open) {
        if (keyFramed) {
          keyFramed = false
          return fit()
        }
        return redraw()
      }
      const lg = legend.current
      const bottom = lg && legendOver() ? lg.offsetTop + lg.offsetHeight : 0
      const matched = ev.facilities.find((f) => f.id === matchedId)
      const subject: [number, number][] = [[trigger.lon, trigger.lat], ...(matched ? [[matched.lon, matched.lat] as [number, number]] : [])]
      // Each subject has a label under it (about two lines), so it needs that much room below the legend.
      const covered = subject.some((p) => map.project(p).y < bottom + 44)
      const padding = { top: bottom + 12, bottom: 64, left: 40, right: 40 }
      if (!bottom || !covered || padding.top + padding.bottom > el.clientHeight - 24 || padding.left + padding.right > el.clientWidth - 24) return redraw()
      const frame = new LngLatBounds(subject[0], subject[0])
      subject.forEach((p) => frame.extend(p))
      keyFramed = true
      map.fitBounds(frame, { padding, maxZoom: map.getZoom(), duration: reduceMotion ? 0 : 400 })
    }
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
    ;(pin.querySelector('.intro-label') as HTMLElement).textContent = introPinLabel(ev, tRef.current)
    // Language switch: canvas name, pin and every label redrawn in place (the map itself is not rebuilt).
    applyLang.current = () => {
      map.getCanvas().setAttribute('aria-label', tRef.current('map.title'))
      const coopMsg = el.querySelector('.maplibregl-mobile-message')
      if (coopMsg) coopMsg.textContent = tRef.current('map.twoFingers')
      const zoomMsg = el.querySelector('.maplibregl-desktop-message')
      if (zoomMsg) zoomMsg.textContent = tRef.current('map.zoomKey', { key: navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl' })
      setChoices(null)
      ;(pin.querySelector('.intro-label') as HTMLElement).textContent = introPinLabel(ev, tRef.current)
      redraw()
    }
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
      window.clearTimeout(foldTimer)
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
      map.off('movestart', closeChoices)
      map.off('error', onMapError)
      map.off('idle', onIdle)
      map.off('load', attribReady)
      applyKey.current = () => {}
      reveal.current = () => {}
      applyHighlight.current = () => {}
      applyHour.current = () => {}
      applyLang.current = () => {}
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
    if (tRef.current === t) return
    tRef.current = t
    applyLang.current()
  }, [t])

  useEffect(() => {
    placeRef.current = place
    applyPlace.current(place)
  }, [place])

  useLayoutEffect(() => {
    // Phones: the open legend sits under the map, and the map's box keeps that much room below it (EventMap.css).
    const lg = legend.current
    lg?.parentElement?.style.setProperty('--pw-legend-h', keyOpen && lg ? `${lg.offsetHeight}px` : '0px')
    applyKey.current(keyOpen)
  }, [keyOpen, t])

  const chooser = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!choices) return
    chooser.current?.querySelector('button')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setChoices(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [choices])

  const placeShown = place !== null && placeReadout(ev, place).kind === 'near'

  // Re-thrown during render (after every hook) so MapSlot's error boundary shows its fallback.
  if (failure) throw failure

  return (
    <>
      {/* First in the DOM, as it is first on screen (top left): Key, then the map canvas and its controls. */}
      {phase === 'flat' && (
        <button ref={keyBtn} type="button" className="map-key" aria-expanded={keyOpen} onClick={() => setKeyOpen((o) => !o)}>
          {t('app.mapKey')}
        </button>
      )}
      <div ref={container} className="map-canvas" data-phase={phase} />
      {baseFailed && <p className="map-note" role="status">{t('map.baseFailed')}</p>}
      {choices && (
        <div ref={chooser} className="map-choose" role="group" aria-label={t('map.chooseTitle')}>
          <p className="map-choose-title" aria-hidden="true">{t('map.chooseTitle')}</p>
          <ul>
            {choices.map((c) => (
              <li key={c.id}><button type="button" onClick={() => reveal.current(c.id)}>{c.label}</button></li>
            ))}
          </ul>
          <button type="button" className="map-choose-close" onClick={() => setChoices(null)}>{t('map.chooseClose')}</button>
        </div>
      )}
      {phase !== 'flat' && (
        <p className="intro-caption" role="status">
          {/* The pin is aria-hidden, so its words are repeated here for screen readers only. */}
          <span className="sr-only">{introPinLabel(ev, t)}. </span>{introCaption(ev, t)}
        </p>
      )}
      <div ref={ctl} className={phase === 'flat' ? 'intro-ctl is-flat' : 'intro-ctl'}>
        {phase !== 'flat'
          ? <button type="button" className="btn" onClick={() => skipIntro.current()}>{t('map.skipIntro')}</button>
          : !prefersReducedMotion() && (
            <button type="button" className="btn" aria-label={t('map.showGlobe')} onClick={() => replayIntro.current()}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="10" cy="10" r="8" /><ellipse cx="10" cy="10" rx="3.6" ry="8" /><path d="M2 10h16M3.5 5.5h13M3.5 14.5h13" />
              </svg>
              {/* Phones show the icon only so the button covers less of the map. */}
              <span className="wide-only"> {t('map.showGlobe')}</span>
            </button>
          )}
      </div>
      {/* Key (top of this fragment) is shown below 1440px wide (App.css); the legend is visual only, so the button
          just shows or hides it. */}
      {/* Hidden (not removed) during the intro: fit() measures its height for the top padding. */}
      <ul ref={legend} className={phase !== 'flat' ? 'legend is-hidden' : keyOpen ? 'legend is-open' : 'legend'} aria-hidden="true">
        <li><span className="lg lg-pulse" /> {t('map.lgFlagged')}</li>
        <li><span className="lg lg-scale" /> {t('map.lgMonitor', { unit: unitShort(ev.compound.units) })}</li>
        <li><span className="lg lg-nodata" /> {t('map.lgNoData')}</li>
        <li><span className="lg lg-facility">1</span> {t('map.lgFacility')}</li>
        {ev.record_check.matched_facility_id && <li><span className="lg lg-matched">1</span> {t('map.lgFiled')}</li>}
        <li><span className="lg lg-line" /> {t('map.lgWind')}</li>
        {ev.corridor && <li><span className="lg lg-corridor" /> {t('map.corridor')}</li>}
        {ev.triangulation?.verdict === 'narrows' && <li><span className="lg lg-tri" /> {t('map.lgTri')}</li>}
        {ev.triangulation?.verdict === 'narrows' && <li><span className="lg lg-ring" /> {t('map.lgRing')}</li>}
        {placeShown && <li><span className="lg lg-place" /> {t('map.lgPlace')}</li>}
      </ul>
    </>
  )
}
