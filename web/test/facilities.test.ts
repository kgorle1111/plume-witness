// Run: npm test. Search and parsing for the facility views, on the real published facility files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  MONITOR_SITES, clipQuery, compoundKey, displayName, eventTypeKey, facilityHref, lbs, loadJson, monitorSpikesHref, nightHref,
  parseFacility, parseIndex, searchFacilities, triReasonKey, type LoadError,
} from '../src/facilities.ts'
import { STRINGS } from '../src/i18n.ts'

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

const files = index.facilities.map((row) => parseFacility(JSON.parse(readFileSync(new URL(`${row.id}.json`, dir), 'utf8')), row.id))
const hasKey = (k: string | null) => k !== null && k in STRINGS.en && k in STRINGS.es

test('pounds: whole from 10 lb, one decimal from 1 lb, never "0 lb" for a small release', () => {
  assert.equal(lbs(8469.743), '8,470 lb')
  assert.equal(lbs(7634), '7,634 lb')
  assert.equal(lbs(12.4), '12 lb')
  assert.equal(lbs(3.46), '3.5 lb')
  assert.equal(lbs(0.0432), '0.043 lb')
  assert.equal(lbs(null), 'no number given')
})

test('a matched night opens its Check step with no globe intro', () => {
  assert.equal(nightHref('2024-06-21_45201_48_201_0069', '/plume-witness/'), '/plume-witness/?night=2024-06-21_45201_48_201_0069&intro=0#check')
})

test('every facility links to the spikes of its nearest monitor, and the site ids are the spike log\'s own', () => {
  const spikes = JSON.parse(readFileSync(new URL('../public/spikes.json', import.meta.url), 'utf8')) as { rows: { site: string; site_id: string }[] }
  const logSites = new Map(spikes.rows.map((r) => [r.site, r.site_id]))
  for (const [name, id] of Object.entries(MONITOR_SITES)) assert.equal(logSites.get(name), id, name)
  for (const r of index.facilities) assert.ok(monitorSpikesHref(r.nearest_monitor), `no spikes link for ${r.nearest_monitor}`)
  assert.equal(monitorSpikesHref('Galena Park', '/b/'), '/b/?view=spikes&site=48_201_0057')
  assert.equal(monitorSpikesHref('Nowhere'), null)
})

test('every event type, TRI status and compound in the published files has a string in both languages', () => {
  for (const f of files) {
    for (const r of f.reports_to_state.reports) assert.ok(hasKey(eventTypeKey(r.event_type)), `event type ${r.event_type}`)
    if (!Object.keys(f.reports_to_epa.years).length) assert.ok(hasKey(triReasonKey(f.reports_to_epa.status)), `TRI status ${f.reports_to_epa.status}`)
    for (const m of f.matched_nights) assert.ok(hasKey(compoundKey(m.compound)), `compound ${m.compound}`)
    for (const y of Object.values(f.reports_to_epa.years)) for (const c of Object.keys(y)) assert.ok(hasKey(compoundKey(c)), `TRI compound ${c}`)
  }
  assert.equal(eventTypeKey('Something New'), null)
  assert.equal(triReasonKey('tri_data'), null)
  assert.equal(eventTypeKey('constructor'), null)
})

test('an echoed query is cut at 60 characters', () => {
  assert.equal(clipQuery('pasadena'), 'pasadena')
  const long = clipQuery('a'.repeat(5000))
  assert.equal(long.length, 60)
  assert.ok(long.endsWith('…'))
})

const reject = async (p: Promise<unknown>): Promise<unknown> => p.then(() => assert.fail('expected a rejection'), (e: unknown) => e)
const fakeFetch = (impl: () => Promise<Response>) => (() => impl()) as unknown as typeof fetch

test('a failed load says why: network, HTTP status or damaged data, never "not found" for a dropped connection', async () => {
  const id = (x: unknown) => x
  assert.deepEqual(await reject(loadJson('f.json', id, fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))))), { kind: 'network' } satisfies LoadError)
  assert.deepEqual(await reject(loadJson('f.json', id, fakeFetch(async () => new Response('nope', { status: 404 })))), { kind: 'http', status: 404 })
  assert.deepEqual(await reject(loadJson('f.json', id, fakeFetch(async () => new Response('x', { status: 500 })))), { kind: 'http', status: 500 })
  const bad = (await reject(loadJson('f.json', id, fakeFetch(async () => new Response('<html>oops'))))) as LoadError
  assert.equal(bad.kind, 'damaged')
  const shape = (await reject(loadJson('f.json', (raw) => parseIndex(raw), fakeFetch(async () => Response.json({ schema: 'x' }))))) as LoadError
  assert.equal(shape.kind, 'damaged')
  assert.deepEqual(await loadJson('f.json', id, fakeFetch(async () => Response.json({ ok: 1 }))), { ok: 1 })
  // An abort is the caller leaving the page, not a failure to report.
  const ctrl = new AbortController()
  ctrl.abort()
  const abortErr = new DOMException('aborted', 'AbortError')
  assert.equal(await reject(loadJson('f.json', id, fakeFetch(() => Promise.reject(abortErr)), ctrl.signal)), abortErr)
})
