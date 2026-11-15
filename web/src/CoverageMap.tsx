// The statewide monitor map (Coverage.tsx loads it lazily: MapLibre is most of the page's JS). Markers only; the
// table under it is the full, keyboard and screen-reader alternative, so the markers are hidden from assistive tech.
import { useEffect, useRef } from 'react'
import { Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { markerGeometry, markerKind, type Bounds, type CoverageSite } from './coverage.ts'

setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const SVG = 'http://www.w3.org/2000/svg'

function markerEl(site: CoverageSite, tip: string): HTMLElement {
  const g = markerGeometry(markerKind(site))
  const el = document.createElement('div')
  el.className = 'cv-marker'
  el.setAttribute('aria-hidden', 'true')
  el.title = tip
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('width', String(g.px))
  svg.setAttribute('height', String(g.px))
  svg.setAttribute('viewBox', `0 0 ${g.px} ${g.px}`)
  const shape = document.createElementNS(SVG, g.el)
  if (g.el === 'polygon') shape.setAttribute('points', g.points)
  else {
    shape.setAttribute('cx', String(g.px / 2))
    shape.setAttribute('cy', String(g.px / 2))
    shape.setAttribute('r', String(g.r))
  }
  shape.setAttribute('fill', g.fill)
  if (g.el === 'circle' && g.dashed) {
    // Hollow: a dark dashed ring inside a white one, so it reads on both land and water.
    const halo = document.createElementNS(SVG, 'circle')
    for (const [k, v] of [['cx', g.px / 2], ['cy', g.px / 2], ['r', g.r], ['fill', 'none'], ['stroke', '#fff'], ['stroke-width', 4]] as const) halo.setAttribute(k, String(v))
    svg.append(halo)
    shape.setAttribute('stroke', '#3a3a44')
    shape.setAttribute('stroke-width', '2')
    shape.setAttribute('stroke-dasharray', '3 2')
  } else {
    shape.setAttribute('stroke', '#fff')
    shape.setAttribute('stroke-width', '1.5')
    shape.setAttribute('stroke-linejoin', 'round')
  }
  svg.append(shape)
  el.append(svg)
  return el
}

interface Props {
  sites: readonly CoverageSite[]
  bounds: Bounds
  /** The canvas's accessible name, in the reader's language. */
  label: string
  tipFor: (s: CoverageSite) => string
  onError: (e: unknown) => void
  /** The style or its tiles failed before the first render: the markers still draw, on a blank background. */
  onBasemapError: () => void
}

export default function CoverageMap({ sites, bounds, label, tipFor, onError, onBasemapError }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef<{ site: CoverageSite; marker: Marker }[]>([])
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const initial = useRef({ label, onError, onBasemapError })

  useEffect(() => { mapRef.current?.getCanvas().setAttribute('aria-label', label) }, [label])

  // A language switch retitles the markers in place.
  useEffect(() => {
    for (const { site, marker } of markersRef.current) marker.getElement().title = tipFor(site)
  }, [tipFor])

  useEffect(() => {
    const el = container.current
    if (!el) return
    let map: MlMap | undefined
    try {
      map = new MlMap({
        container: el,
        style: STYLE_URL,
        bounds: boundsRef.current,
        fitBoundsOptions: { padding: 20 },
        // Fixed camera, as on Timeline: the page scrolls, and a draggable map traps touch scrolling on a phone.
        // The view buttons (Coverage.tsx) move it instead.
        interactive: false,
        attributionControl: false,
        locale: { 'Map.Title': initial.current.label },
        // The third-party Positron style logs filter warnings (highway shields) on every load; they draw nothing here.
        validateStyle: false,
      })
      const m = map
      mapRef.current = m
      let loaded = false
      m.on('load', () => { loaded = true })
      m.on('error', (e) => {
        console.warn('Coverage base map:', e.error?.message ?? e)
        if (!loaded) initial.current.onBasemapError()
      })
      m.getCanvas().setAttribute('aria-label', initial.current.label)
      // Largest first, so a small marker is never buried under a big triangle next to it.
      const order = [...sites].sort((a, b) => markerGeometry(markerKind(b)).px - markerGeometry(markerKind(a)).px)
      markersRef.current = order.map((site) => ({ site, marker: new Marker({ element: markerEl(site, tipFor(site)) }).setLngLat([site.lon, site.lat]).addTo(m) }))
      const refit = () => m.fitBounds(boundsRef.current, { padding: 20, duration: 0 })
      m.on('resize', refit)
      return () => {
        for (const { marker } of markersRef.current) marker.remove()
        markersRef.current = []
        mapRef.current = null
        m.remove()
      }
    } catch (e) {
      initial.current.onError(e)
      map?.remove()
    }
    // sites is stable for the page's life; callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    mapRef.current?.fitBounds(bounds, { padding: 20, duration: reduced ? 0 : 600 })
  }, [bounds])

  return <div ref={container} className="cv-canvas" />
}
