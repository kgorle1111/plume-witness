import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hit, layoutLabels, numberedDots, type Box, type LabelAsk } from '../src/labelLayout.ts'

const base = { width: 800, height: 400, top: 0, dots: [] as { id: string; box: Box }[] }
const ask = (id: string, x: number, y: number, w = 120, h = 30, extra: Partial<LabelAsk> = {}): LabelAsk => ({ id, x, y, size: [w, h], gap: 13, ...extra })

// Shaped like the demo night: the Manchester monitor's reading sits right where "2. Houston Refining" wants to go.
test('a monitor reading wins over a facility name that wants the same spot', () => {
  const monitor = ask('manchester', 300, 200, 160, 34, { gap: 12 })
  // Every side of the facility's dot lands on the monitor's label (the facility sits just below it).
  const facility = ask('refining', 300, 240, 300, 200)
  const r = layoutLabels({ ...base, monitors: [monitor], facilities: [facility] })
  assert.ok(r.monitors.has('manchester'), 'the monitor reading stands')
  assert.ok(!r.facilities.has('refining'), 'the colliding facility name is dropped')
})

test('monitor labels never cover each other: the second moves to a free side or drops', () => {
  const a = ask('a', 300, 100, 160, 34)
  const b = ask('b', 300, 120, 160, 34) // below b is where a's reading is
  const r = layoutLabels({ ...base, monitors: [a, b], facilities: [] })
  const boxes = [...r.monitors.values()].map((p) => p.box)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(boxes[i], boxes[j]))
  assert.equal(r.monitors.get('a')?.where, 'below')
})

test('the flagged monitor stays under its circle and the filed-report name always shows', () => {
  const trigger = ask('milby', 300, 200, 160, 34)
  const matched = ask('ineos', 300, 200, 300, 30, { must: true })
  const r = layoutLabels({ ...base, trigger, monitors: [], facilities: [matched] })
  assert.equal(r.monitors.get('milby')?.where, 'below')
  assert.ok(r.facilities.has('ineos'))
})

test('a monitor reading takes a side with no basemap place name when it has one', () => {
  const m = ask('galena', 300, 200, 100, 30)
  const underIsTaken = (b: Box) => (b[1] > 200 ? 2 : 0) // a place name right under the monitor
  const r = layoutLabels({ ...base, monitors: [m], facilities: [], soft: underIsTaken })
  assert.equal(r.monitors.get('galena')?.where, 'above')
})

test('overlapping dots: the nearer keeps its number, the filed-report one always does', () => {
  const dots = [{ id: 'n36', x: 100, y: 100, r: 8 }, { id: 'n38', x: 104, y: 98, r: 8 }, { id: 'n37', x: 106, y: 100, r: 10 }, { id: 'far', x: 300, y: 100, r: 8 }]
  const shown = numberedDots(dots, new Set(['n37']))
  assert.deepEqual([...shown].sort(), ['far', 'n37'])
  assert.deepEqual([...numberedDots(dots, new Set())].sort(), ['far', 'n36'])
})
