// Run: npm test (node --test; Node 23.6+ strips the types natively, so no test dependency).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bearingDeg, distanceKm, inCorridor, placeReadout } from '../src/geo.ts'
import { destination } from '../src/format.ts'
import type { PlumeEvent } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent
const cor = ev.corridor!
const origin = ev.monitors.find((m) => m.site_id === cor.origin_site_id)!
const at = (bearing: number, km: number) => {
  const [lon, lat] = destination(origin.lat, origin.lon, bearing, km)
  return { lat, lon }
}

// Independent check: the pipeline (Python) wrote distance, bearing and in_corridor for every facility.
test('distance, bearing and corridor agree with the pipeline for all facilities', () => {
  for (const f of ev.facilities) {
    assert.ok(Math.abs(distanceKm(origin, f) - f.distance_km) < 0.1, `${f.name} distance`)
    const db = Math.abs(bearingDeg(origin, f) - f.bearing_deg)
    assert.ok(Math.min(db, 360 - db) < 1, `${f.name} bearing`)
    assert.equal(inCorridor(f, origin, cor), f.in_corridor, `${f.name} in_corridor`)
  }
})

test('a point up the wind line is inside the wedge; past max_km or off-axis is not', () => {
  const w = cor.wind_from_deg[0]
  assert.equal(inCorridor(at(w, cor.max_km * 0.5), origin, cor), true)
  assert.equal(inCorridor(at(w, cor.max_km + 1), origin, cor), false)
  assert.equal(inCorridor(at(w + 180, 3), origin, cor), false)
  // Edge of the widest arc: inside just within half_width, outside just beyond it.
  const hi = Math.max(...cor.wind_from_deg) + cor.half_width_deg
  assert.equal(inCorridor(at(hi - 0.5, 5), origin, cor), true)
  assert.equal(inCorridor(at(hi + 0.5, 5), origin, cor), false)
})

test('readout: Ship Channel neighborhoods are near; another city is far', () => {
  const galena = placeReadout(ev, { lat: 29.7335616, lon: -95.2302123 })
  assert.equal(galena.kind, 'near')
  if (galena.kind === 'near') {
    assert.equal(galena.monitor.name, 'Galena Park')
    assert.equal(galena.corridor, 'inside')
    assert.ok(galena.facility)
  }
  const harrisburg = placeReadout(ev, { lat: 29.7182845, lon: -95.2796581 })
  assert.equal(harrisburg.kind === 'near' && harrisburg.corridor, 'outside')
  const austin = placeReadout(ev, { lat: 30.2672, lon: -97.7431 })
  assert.equal(austin.kind, 'far')
})
