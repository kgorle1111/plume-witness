import assert from 'node:assert/strict'
import { test } from 'node:test'
import { playWindow } from '../src/playWindow.ts'

const DAY = Array.from({ length: 24 }, (_, i) => i)
const plays = (d: number, w: { from: number; to: number }) => w.from <= d && d <= w.to

test('the demo night keeps its 06:00 to 12:00 window', () => {
  assert.deepEqual(playWindow(9, DAY), { from: 6, to: 12 })
})

test('every detection hour falls inside its own window, which is 6 hours long', () => {
  for (const d of DAY) {
    const w = playWindow(d, DAY)
    assert.ok(plays(d, w), `hour ${d}: ${w.from}-${w.to}`)
    assert.equal(w.to - w.from, 6, `hour ${d}`)
  }
})

test('a late spike slides the window back instead of jumping to the morning', () => {
  assert.deepEqual(playWindow(22, DAY), { from: 17, to: 23 })
  assert.deepEqual(playWindow(0, DAY), { from: 0, to: 6 })
})

test('a short file clamps to the hours it has', () => {
  assert.deepEqual(playWindow(5, [3, 4, 5, 6]), { from: 3, to: 6 })
})
