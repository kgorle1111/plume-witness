import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { shortlist } from '../src/traceList.ts'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`)

test('shortlist: the nearest five, plus the filed-report facility further out, in list order', () => {
  assert.deepEqual(shortlist(ids(47), 'f36'), [0, 1, 2, 3, 4, 36])
})

test('shortlist: a filed-report facility already in the nearest five adds nothing', () => {
  assert.deepEqual(shortlist(ids(47), 'f2'), [0, 1, 2, 3, 4])
  assert.deepEqual(shortlist(ids(47), null), [0, 1, 2, 3, 4])
  assert.deepEqual(shortlist(ids(47), 'not-in-list'), [0, 1, 2, 3, 4])
})

test('shortlist: a duplicated facility id shows every entry', () => {
  const list = [...ids(10), 'f8']
  assert.deepEqual(shortlist(list, 'f8'), [0, 1, 2, 3, 4, 8, 10])
})

test('shortlist: short lists are shown whole rather than hiding a single card', () => {
  assert.deepEqual(shortlist(ids(6), null), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(shortlist(ids(7), 'f6'), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(shortlist(ids(7), null), [0, 1, 2, 3, 4])
  assert.deepEqual(shortlist([], 'x'), [])
})

test('the real night: the filed-report facility is shown before "Show all"', () => {
  const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8'))
  // Same order as App.tsx useCorridor: nearest first, corridor only.
  const corridor = [...ev.facilities].sort((a, b) => a.distance_km - b.distance_km).filter((f) => f.in_corridor)
  const shown = shortlist(corridor.map((f) => f.id), ev.record_check.matched_facility_id)
  assert.ok(corridor.length > 7, 'the real night has a long corridor list')
  assert.ok(shown.length <= 6)
  assert.ok(shown.some((i) => corridor[i].id === ev.record_check.matched_facility_id))
})
