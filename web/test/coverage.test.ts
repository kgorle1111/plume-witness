import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  coverageSummary, firstDir, markerKind, parseCoverage, ppbText, regionSpikesHref, replayable, sortSites, type Coverage,
} from '../src/coverage.ts'
import { REGIONS } from '../src/region.ts'

const raw = () => JSON.parse(readFileSync(new URL('./fixtures/coverage.sample.json', import.meta.url), 'utf8'))
const fixture = (): Coverage => parseCoverage(raw())
const ids = (rows: { site_id: string }[]) => rows.map((r) => r.site_id)

test('the fixture parses, with every field of the contract', () => {
  const c = fixture()
  assert.equal(c.sites.length, 22)
  const milby = c.sites.find((s) => s.site_id === '48_201_0069')!
  assert.deepEqual(milby, {
    site_id: '48_201_0069', name: 'Houston Milby Park', county: 'Harris', region_key: 'houston', lat: 29.70627, lon: -95.26113,
    has_data: true, wind_source: 'met', years: [2024, 2025], max_benzene_ppb: 51.75, max_butadiene_ppb: 400.01, spikes: 106,
    by_status: { no_report_after_deadline: 63, reported: 3, reported_mismatch: 4, search_incomplete: 36 },
  })
})

test('summary counts monitors, crossings and replayable regions from the data', () => {
  const s = coverageSummary(fixture())
  assert.equal(s.monitors, 22)
  assert.equal(s.withData, 20)
  assert.equal(s.noData, 2)
  // 12 Houston + 2 Beaumont crossed, plus HRM-7 W Baytown and Dona Park, which no region replays.
  assert.equal(s.crossed, 16)
  assert.equal(s.crossedNotReplayed, 2)
  assert.equal(s.spikes, 468 + 2 + 3 + 2)
  assert.deepEqual(s.regions, ['houston', 'beaumont'])
  assert.deepEqual(s.years, [2024, 2025])
})

test('a region key the site has no pages for is shown but neither linked nor counted as replayable', () => {
  const c = raw()
  c.sites[0].region_key = 'laredo'
  const s = coverageSummary(parseCoverage(c))
  assert.equal(s.crossedNotReplayed, 3)
  assert.equal(replayable('laredo'), false)
  assert.equal(replayable('toString'), false)
  assert.equal(regionSpikesHref('/pw/', 'laredo'), null)
  assert.equal(regionSpikesHref('/pw/', null), null)
  assert.equal(regionSpikesHref('/pw/', 'houston'), '/pw/?view=spikes')
  assert.equal(regionSpikesHref('/pw/', 'beaumont'), '/pw/?view=spikes&region=beaumont')
})

test('an empty file is zero monitors, not a crash', () => {
  const s = coverageSummary(parseCoverage({ generated: 'x', trigger: 'y', sites: [] }))
  assert.deepEqual(s, { monitors: 0, withData: 0, noData: 0, crossed: 0, spikes: 0, crossedNotReplayed: 0, regions: [], years: null })
})

test('a damaged file is rejected with the field named', () => {
  const bad = (edit: (c: { sites: Record<string, unknown>[] } & Record<string, unknown>) => void, msg: RegExp) => {
    const c = raw()
    edit(c)
    assert.throws(() => parseCoverage(c), msg)
  }
  bad((c) => { delete c.trigger }, /trigger/)
  bad((c) => { c.sites = {} as never }, /sites must be a list/)
  bad((c) => { c.sites[0].spikes = -1 }, /spikes/)
  bad((c) => { c.sites[0].spikes = 1.5 }, /spikes/)
  bad((c) => { c.sites[0].lat = 'x' }, /lat/)
  bad((c) => { c.sites[0].lon = Number.NaN }, /lon/)
  bad((c) => { c.sites[0].wind_source = 'guess' }, /wind_source/)
  bad((c) => { c.sites[0].has_data = 'yes' }, /has_data/)
  bad((c) => { c.sites[0].site_id = '../etc' }, /site_id/)
  bad((c) => { c.sites[0].region_key = '../x' }, /region_key/)
  bad((c) => { c.sites[1].site_id = c.sites[0].site_id }, /listed twice/)
  bad((c) => { c.sites[0].max_benzene_ppb = -3 }, /max_benzene_ppb/)
  bad((c) => { c.sites[0].by_status = { reported: 999 } }, /more than spikes/)
  // A monitor with no data that still claims a spike is a pipeline bug, not a row to draw.
  bad((c) => { const s = c.sites.find((x) => x.has_data === false)!; s.spikes = 2 }, /has_data is false/)
})

test('sorting: numbers largest first by default, and no-data rows last in both directions', () => {
  const c = fixture()
  assert.equal(firstDir('spikes'), 'desc')
  assert.equal(firstDir('name'), 'asc')
  const desc = sortSites(c.sites, 'spikes', 'desc')
  assert.equal(desc[0].site_id, '48_201_0069')
  assert.deepEqual(ids(desc.slice(-2)).sort(), ['48_135_1014', '48_255_1070'])
  const asc = sortSites(c.sites, 'spikes', 'asc')
  assert.equal(asc[0].spikes, 0)
  assert.ok(asc[0].has_data, 'a measured 0 sorts before a monitor with no data')
  assert.deepEqual(ids(asc.slice(-2)).sort(), ['48_135_1014', '48_255_1070'])
  // No butadiene value (not measured) sorts with the gaps, after every number.
  const bd = sortSites(c.sites, 'butadiene', 'asc')
  const firstGap = bd.findIndex((s) => s.max_butadiene_ppb === null)
  assert.ok(bd.slice(firstGap).every((s) => s.max_butadiene_ppb === null))
  assert.equal(bd[0].max_butadiene_ppb, 0.31)
  // Region sorts by the name the reader sees; rows with no region go last.
  const byRegion = sortSites(c.sites, 'region', 'asc', (k) => (k ? REGIONS[k]?.name.en ?? k : ''))
  assert.equal(byRegion[0].region_key, 'beaumont')
  assert.equal(byRegion.at(-1)!.region_key, null)
  // The input is not reordered.
  assert.deepEqual(ids(fixture().sites), ids(c.sites))
})

test('markers: shape for crossed or not, hollow for no data, size by count', () => {
  const site = (spikes: number, has_data = true) => ({ ...fixture().sites[0], spikes, has_data })
  assert.deepEqual(markerKind(site(0, false)), { shape: 'none', size: 0 })
  assert.deepEqual(markerKind(site(0)), { shape: 'zero', size: 0 })
  assert.deepEqual(markerKind(site(1)), { shape: 'crossed', size: 1 })
  assert.deepEqual(markerKind(site(9)), { shape: 'crossed', size: 1 })
  assert.deepEqual(markerKind(site(10)), { shape: 'crossed', size: 2 })
  assert.deepEqual(markerKind(site(50)), { shape: 'crossed', size: 3 })
})

test('highest readings print short and never as an exponent', () => {
  assert.equal(ppbText(400.01), '400')
  assert.equal(ppbText(51.75), '51.8')
  assert.equal(ppbText(10), '10')
  assert.equal(ppbText(0.31), '0.31')
  assert.equal(ppbText(0.0000001), '0')
})

test('the map frames Texas, or one region\'s monitors', async () => {
  const { viewBounds, TEXAS } = await import('../src/coverage.ts')
  const c = fixture()
  assert.deepEqual(viewBounds(c.sites, null), TEXAS)
  const [[w, s], [e, n]] = viewBounds(c.sites, 'beaumont', 0)
  assert.deepEqual([w, s, e, n], [-94.07107, 29.97995, -94.00477, 30.03643])
  assert.deepEqual(viewBounds(c.sites, 'nowhere'), TEXAS)
  const far = viewBounds([{ ...c.sites[0], lon: -110 }], null)
  assert.equal(far[0][0], -110, 'a monitor outside the frame widens it')
})

test('loading: a 404 or a single-page fallback is "not published"; damaged JSON is damaged', async () => {
  const { loadCoverage } = await import('../src/coverage.ts')
  const answer = (body: string, status: number, type: string) => (async () => new Response(body, { status, headers: { 'content-type': type } })) as typeof fetch
  const json = readFileSync(new URL('./fixtures/coverage.sample.json', import.meta.url), 'utf8')
  assert.equal((await loadCoverage('/coverage.json', answer(json, 200, 'application/json'))).sites.length, 22)
  await assert.rejects(loadCoverage('/coverage.json', answer('nope', 404, 'text/html')), { kind: 'http', status: 404 })
  await assert.rejects(loadCoverage('/coverage.json', answer('<!doctype html><html>', 200, 'text/html; charset=utf-8')), { kind: 'http', status: 404 })
  await assert.rejects(loadCoverage('/coverage.json', answer('{"sites": 1', 200, 'application/json')), { kind: 'damaged' })
  await assert.rejects(loadCoverage('/coverage.json', answer('{"generated":"x","trigger":"y","sites":[{}]}', 200, 'application/json')), { kind: 'damaged' })
  await assert.rejects(loadCoverage('/coverage.json', (async () => { throw new TypeError('offline') }) as typeof fetch), { kind: 'network' })
})
