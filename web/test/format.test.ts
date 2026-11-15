import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readingText, unitFirst, unitShort, unitTitle } from '../src/format.ts'

test('ppb-v reads as ppb; other units are left as given', () => {
  for (const u of ['ppb-v', 'ppbv', 'PPB-V', 'ppb', ' ppb-v ']) assert.equal(unitShort(u), 'ppb', u)
  assert.equal(unitShort('pounds'), 'pounds')
  assert.equal(unitShort('ppm'), 'ppm')
})

test('the first mention spells ppb out in both languages', () => {
  assert.equal(unitFirst('ppb-v'), 'parts per billion (ppb)')
  assert.equal(unitFirst('ppb-v', 'es'), 'partes por mil millones (ppb)')
  assert.equal(unitFirst('pounds'), 'pounds')
})

test('the tooltip explains the -v only when the data says ppb-v', () => {
  assert.match(unitTitle('ppb-v') ?? '', /by volume/)
  assert.match(unitTitle('ppb-v', 'es') ?? '', /en volumen/)
  assert.equal(unitTitle('ppb'), 'parts per billion')
  assert.equal(unitTitle('pounds'), null)
})

test('a reading keeps its number; only the unit text changes', () => {
  assert.equal(readingText(51.75, null, unitShort('ppb-v')), '51.75 ppb')
  assert.equal(readingText(null, 'AQI', unitShort('ppb-v')), 'no data (AQI)')
})
