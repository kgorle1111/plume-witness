// Run: npm test. Search and parsing for the facility views, on the real published facility files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { displayName, facilityHref, parseFacility, parseIndex, searchFacilities } from '../src/facilities.ts'

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

test('display names: EPA capitals become title case; acronyms, brands and ordinals read right', () => {
  const cases: [string, string][] = [
    ['INEOS AMERICAS PASADENA SITE', 'INEOS Americas Pasadena Site'],
    ['ACCP HOUSTON FACILITY', 'ACCP Houston Facility'],
    ['AFTON LUBE AND FUEL ADDITIVES PLANT', 'Afton Lube and Fuel Additives Plant'],
    ['THE UNIVERSITY OF TEXAS M D ANDERSON CANCER CENTER HOUSTON', 'The University of Texas M D Anderson Cancer Center Houston'],
    ['ANHEUSER-BUSCH HOUSTON BREWERY', 'Anheuser-Busch Houston Brewery'],
    ['MCCARTY ROAD LANDFILL TX', 'McCarty Road Landfill TX'],
    ['PWE WWTP 69TH STREET', 'PWE WWTP 69th Street'],
    ['SUNOCO BAYPORT BPT1', 'Sunoco Bayport BPT1'],
    ['EXXONMOBIL BAYTOWN REFINERY', 'ExxonMobil Baytown Refinery'],
    ['ACME CO INC', 'Acme Co Inc'],
    ['ACME HOLDINGS LLC', 'Acme Holdings LLC'],
    ['W & P DEVELOPMENT', 'W & P Development'],
    ['Already Mixed Case', 'Already Mixed Case'],
  ]
  for (const [raw, want] of cases) assert.equal(displayName(raw), want, raw)
})

test('every indexed name keeps its letters when displayed (only case changes)', () => {
  for (const r of index.facilities) assert.equal(displayName(r.name).toUpperCase(), r.name.toUpperCase(), r.name)
})
