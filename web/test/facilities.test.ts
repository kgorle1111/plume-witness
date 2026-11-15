// Run: npm test. Search and parsing for the facility views, on the real published facility files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { facilityHref, parseFacility, parseIndex, searchFacilities } from '../src/facilities.ts'

const dir = new URL('../public/facilities/', import.meta.url)
const index = parseIndex(JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')))

test('every facility file parses and matches its index row', () => {
  assert.equal(readdirSync(dir).filter((f) => f !== 'index.json').length, index.facilities.length)
  for (const row of index.facilities) {
    const f = parseFacility(JSON.parse(readFileSync(new URL(`${row.id}.json`, dir), 'utf8')), row.id)
    assert.equal(f.reports_to_state.count, row.reports)
    assert.equal(f.matched_nights.length, row.matched_nights)
  }
})

test('a file for another id is rejected', () => {
  const [a, b] = index.facilities
  const raw = JSON.parse(readFileSync(new URL(`${a.id}.json`, dir), 'utf8'))
  assert.throws(() => parseFacility(raw, b.id), /not a plume-witness.facility\/v1 file/)
})

test('search needs every word, in name, address, id or monitor', () => {
  const r = index.facilities.find((x) => x.reports > 0)!
  const word = r.name.split(' ')[0].toLowerCase()
  const hits = searchFacilities(index.facilities, word)
  assert.ok(hits.some((h) => h.id === r.id) && hits.length < index.facilities.length)
  assert.deepEqual(searchFacilities(index.facilities, `${word} zzzznotaword`), [])
  assert.deepEqual(searchFacilities(index.facilities, r.id).map((h) => h.id), [r.id])
  assert.equal(searchFacilities(index.facilities, '  ').length, index.facilities.length)
})

test('facility links carry a 12-digit id and the site base', () => {
  assert.equal(facilityHref('110000462623', '/plume-witness/'), '/plume-witness/?view=facility&id=110000462623')
})
