// Place readout for the location search. Pure and self-contained (type-only imports) so
// `node --test test/geo.test.ts` can load it without a bundler.
import type { Corridor } from './types'

export interface LatLon {
  lat: number
  lon: number
}

interface Named extends LatLon {
  name: string
}

/** Beyond this distance from every monitor in the file, the replay has nothing to say about a place. */
export const COVERAGE_KM = 30

const R_KM = 6371.0088
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle (haversine) distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360
}

/** Smallest angle between two bearings, in [0, 180]. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** Same wedge the map draws: within max_km of the origin monitor and within ±half_width_deg of any wind-from
 *  bearing. Checking each bearing separately gives the same union as the map's merged arcs. */
export function inCorridor(p: LatLon, origin: LatLon, c: Corridor): boolean {
  if (distanceKm(origin, p) > c.max_km) return false
  const b = bearingDeg(origin, p)
  return c.wind_from_deg.some((w) => angleBetween(b, w) <= c.half_width_deg)
}

function nearest<T extends Named>(p: LatLon, items: T[]): { item: T; km: number } | null {
  let best: { item: T; km: number } | null = null
  for (const item of items) {
    const km = distanceKm(p, item)
    if (!best || km < best.km) best = { item, km }
  }
  return best
}

export type PlaceReadout =
  | { kind: 'far'; nearestMonitorKm: number | null }
  | {
      kind: 'near'
      monitor: { name: string; km: number; site_id: string }
      facility: { name: string; km: number; lat: number; lon: number } | null
      /** 'none' when the file has no corridor (or its origin monitor is missing). */
      corridor: 'inside' | 'outside' | 'none'
      monitorAt: LatLon
    }

interface EventLike {
  monitors: (Named & { site_id: string })[]
  facilities: Named[]
  corridor?: Corridor
}

/** Everything here comes from event.json; nothing is fetched or estimated. */
export function placeReadout(ev: EventLike, p: LatLon): PlaceReadout {
  const m = nearest(p, ev.monitors)
  if (!m || m.km > COVERAGE_KM) return { kind: 'far', nearestMonitorKm: m ? m.km : null }
  const f = nearest(p, ev.facilities)
  const c = ev.corridor
  const origin = c && ev.monitors.find((x) => x.site_id === c.origin_site_id)
  return {
    kind: 'near',
    monitor: { name: m.item.name, km: m.km, site_id: m.item.site_id },
    facility: f ? { name: f.item.name, km: f.km, lat: f.item.lat, lon: f.item.lon } : null,
    corridor: c && origin ? (inCorridor(p, origin, c) ? 'inside' : 'outside') : 'none',
    monitorAt: { lat: m.item.lat, lon: m.item.lon },
  }
}

/** One decimal under 10 km, whole km beyond: the inputs are point locations, not property lines. */
export const kmText = (km: number) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
