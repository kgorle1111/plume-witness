// Run: npm test. The landing globe must keep Houston in view and mark it where the coastline puts it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CENTER_LAT, HOUSTON, SWAY_PERIOD_S, project, swayCenter, unproject } from '../src/globeView.ts'

test('project and unproject are inverses on the near side', () => {
  for (const [x, y] of [[0, 0], [0.3, -0.2], [-0.7, 0.5], [0.1, 0.9]]) {
    const { lat, lon } = unproject(x, y)
    const p = project(lat, lon, 0)
    assert.ok(p.visible)
    assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, `(${x}, ${y}) came back as (${p.x}, ${p.y})`)
  }
})

test('the view centre is the tilt latitude at longitude 0', () => {
  const { lat, lon } = unproject(0, 0)
  assert.ok(Math.abs(lat - CENTER_LAT) < 1e-9)
  assert.ok(Math.abs(lon) < 1e-9)
})

test('the sway starts on Houston, with Houston just above the centre', () => {
  assert.equal(swayCenter(0), HOUSTON.lon)
  const p = project(HOUSTON.lat, HOUSTON.lon, swayCenter(0))
  assert.ok(p.visible)
  assert.ok(Math.abs(p.x) < 1e-9)
  assert.ok(p.y > 0.05 && p.y < 0.2, `Houston at y=${p.y}`)
})

test('Houston stays well inside the near side through a whole sway', () => {
  for (let s = 0; s <= SWAY_PERIOD_S; s += 0.25) {
    const p = project(HOUSTON.lat, HOUSTON.lon, swayCenter(s))
    assert.ok(p.visible, `Houston hidden at ${s}s`)
    assert.ok(Math.hypot(p.x, p.y) < 0.75, `Houston near the rim at ${s}s`)
  }
})

test('the far side is reported as hidden', () => {
  assert.equal(project(HOUSTON.lat, HOUSTON.lon, HOUSTON.lon + 180).visible, false)
})
