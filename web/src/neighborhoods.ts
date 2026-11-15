// Houston Ship Channel neighborhoods for the Past spikes shortcut. Pure data, so `node --test` can load it.
// Source: OpenStreetMap Nominatim search results (place centroids), looked up 2026-11-14.
// kn: the same eight points as PICKS in PlaceSearch.tsx (not exported there); PlaceSearch should import these.
import type { LatLon } from './geo.ts'

export interface Neighborhood extends LatLon {
  label: string
}

export const NEIGHBORHOODS: readonly Neighborhood[] = [
  { label: 'Manchester', lat: 29.7182844, lon: -95.2618799 },
  { label: 'Harrisburg', lat: 29.7182845, lon: -95.2796581 },
  { label: 'Galena Park', lat: 29.7335616, lon: -95.2302123 },
  { label: 'Jacinto City', lat: 29.7673433, lon: -95.2336723 },
  { label: 'Pasadena', lat: 29.6910753, lon: -95.2092076 },
  { label: 'Cloverleaf', lat: 29.7782823, lon: -95.1718772 },
  { label: 'Channelview', lat: 29.7760599, lon: -95.1146533 },
  { label: 'Deer Park', lat: 29.7052284, lon: -95.1238204 },
]
