// Run: npm test. The landing globe projects the near hemisphere and rotates through a full turn.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CENTER_LAT, SPIN_PERIOD_S, spinCenter, unproject } from '../src/globeView.ts'

test('the view centre is the tilt latitude at longitude 0', () => {
  const { lat, lon } = unproject(0, 0)
  assert.ok(Math.abs(lat - CENTER_LAT) < 1e-9)
  assert.ok(Math.abs(lon) < 1e-9)
})

test('the equatorial rim spans the two longitudes 90 degrees from the centre', () => {
  assert.deepEqual(unproject(-1, 0), { lat: 0, lon: -90 })
  assert.deepEqual(unproject(1, 0), { lat: 0, lon: 90 })
})

test('the globe passes through all four quarter turns before returning to its start', () => {
  const start = spinCenter(0)
  for (const quarter of [1, 2, 3]) {
    assert.equal(spinCenter((quarter * SPIN_PERIOD_S) / 4), start + quarter * 90)
  }
  assert.equal(spinCenter(SPIN_PERIOD_S), start)
})
