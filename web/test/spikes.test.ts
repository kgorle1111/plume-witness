// Run: npm test. The spike log's CSV and filter logic, on the real published spikes.json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  NO_FILTER, PAGE_SIZE, cleanFilters, countKey, csvCell, dateText, logView, nearestSite, optionCounts, parseSpikes, parseSpot,
  reasonKey, selectRows, spikeKey, toCsv, yearSpan,
} from '../src/spikes.ts'
import { NEIGHBORHOODS } from '../src/neighborhoods.ts'
import { STRINGS } from '../src/i18n.ts'

const data = parseSpikes(JSON.parse(readFileSync(new URL('../public/spikes.json', import.meta.url), 'utf8')))

test('every row parses and the summary counts match the rows', () => {
  assert.equal(data.rows.length, data.summary.spikes)
  assert.equal(new Set(data.rows.map((r) => r.date)).size, data.summary.spike_days)
})

test('filters narrow the rows the CSV exports', () => {
  const site = data.rows.find((r) => r.compound === 'benzene' && r.date.startsWith('2025'))!.site_id
  const rows = selectRows(data.rows, { ...NO_FILTER, site, year: '2025', compound: 'benzene' }, 'date', 'desc')
  assert.ok(rows.length > 0 && rows.length < data.rows.length)
  assert.ok(rows.every((r) => r.site_id === site && r.date.startsWith('2025') && r.compound === 'benzene'))
  const lines = toCsv(rows).trimEnd().split('\r\n')
  assert.equal(lines.length, rows.length + 1)
  assert.ok(lines[0].startsWith('date,hour_cst,monitor,'))
})

test('sorts by date and by value in both directions', () => {
  const newest = selectRows(data.rows, NO_FILTER, 'date', 'desc')
  assert.ok(newest[0].date >= newest[newest.length - 1].date)
  const low = selectRows(data.rows, NO_FILTER, 'value', 'asc')
  for (let i = 1; i < low.length; i++) assert.ok(low[i - 1].value_ppb <= low[i].value_ppb)
})

test('csv cells quote commas and neutralise formulas, but keep negative numbers numeric', () => {
  assert.equal(csvCell('1,3-butadiene'), '"1,3-butadiene"')
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
  assert.equal(csvCell(-95.26), '-95.26')
  assert.equal(csvCell(null), '')
})

test('a 1,3-butadiene row stays one CSV column', () => {
  const r = data.rows.find((x) => x.compound === '1,3-butadiene')!
  const line = toCsv([r]).split('\r\n')[1]
  assert.ok(line.includes(',"1,3-butadiene",'))
})

test('dates are formatted without a timezone shift', () => {
  assert.equal(dateText('2024-01-01'), 'Jan 1, 2024')
})

test('a malformed file fails with a fix', () => {
  assert.throws(() => parseSpikes({ schema: 'x', rows: [] }), /pipeline.spikes/)
  assert.throws(() => parseSpikes({ ...data, schema: 'plume-witness.spikes/v1', rows: [{ date: 'Jan 1' }] }), /row 0/)
})

test('a row links to a replay exactly when its night file exists (Galena Park 2025-07-26 has none)', () => {
  for (const r of data.rows) {
    const file = new URL(`../public/nights/${spikeKey(r)}.json`, import.meta.url)
    assert.equal(r.night_id !== null, existsSync(file), spikeKey(r))
  }
  const galena = data.rows.find((r) => spikeKey(r) === '2025-07-26_45201_48_201_0057')!
  assert.equal(galena.night_id, null)
})

test('a null night_id still parses, sorts and exports to CSV', () => {
  const rows = selectRows(data.rows, NO_FILTER, 'date', 'desc')
  assert.equal(new Set(rows.map(spikeKey)).size, rows.length)
  const g = data.rows.find((r) => r.night_id === null)!
  const cols = toCsv([g]).split('\r\n')[1]
  assert.ok(cols.endsWith(','), 'night_id column is empty, not the text "null"')
})

test('the log pages after filtering and sorting, and the CSV keeps every filtered row', () => {
  const f = { ...NO_FILTER, status: 'no_report_after_deadline' }
  const all = selectRows(data.rows, f, 'value', 'desc')
  assert.ok(all.length > PAGE_SIZE, 'needs more filtered rows than one page for this test to mean anything')
  const v = logView(data.rows, f, 'value', 'desc', PAGE_SIZE)
  assert.equal(v.shown.length, PAGE_SIZE)
  // The page is the top of the filtered, sorted list: every shown row passes the filter and the order holds.
  assert.deepEqual(v.shown.map(spikeKey), all.slice(0, PAGE_SIZE).map(spikeKey))
  assert.ok(v.shown.every((r) => r.status === 'no_report_after_deadline'))
  assert.deepEqual(v.rows.map(spikeKey), all.map(spikeKey))
  assert.equal(v.remaining, all.length - PAGE_SIZE)
  assert.equal(v.next, Math.min(PAGE_SIZE, v.remaining))
  assert.equal(toCsv(v.rows).trimEnd().split('\r\n').length, all.length + 1)
})

test('"Show more" adds a page, the last press adds only what is left, and a bad limit falls back to one page', () => {
  const total = data.rows.length
  const v2 = logView(data.rows, NO_FILTER, 'date', 'desc', PAGE_SIZE * 2)
  assert.equal(v2.shown.length, PAGE_SIZE * 2)
  const last = logView(data.rows, NO_FILTER, 'date', 'desc', total - 15)
  assert.equal(last.next, 15)
  const every = logView(data.rows, NO_FILTER, 'date', 'desc', total + 100)
  assert.equal(every.shown.length, total)
  assert.equal(every.remaining, 0)
  assert.equal(every.next, 0)
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(logView(data.rows, NO_FILTER, 'date', 'desc', bad).shown.length, PAGE_SIZE)
})

test('the first page holds the row the judge video replays (newest "No matching report", 2025-11-18 Manchester)', () => {
  const v = logView(data.rows, { ...NO_FILTER, status: 'no_report_after_deadline' }, 'date', 'desc', PAGE_SIZE)
  assert.equal(v.shown.find((r) => r.night_id)?.night_id, '2025-11-18_43218_48_201_0307')
})

test('a shared link with filter values this file lacks drops them and names them; known values stay', () => {
  const bad = cleanFilters(data.rows, { site: 'bogus', compound: 'benzene', status: 'nope', year: '2030' })
  assert.deepEqual(bad.filters, { ...NO_FILTER, compound: 'benzene' })
  assert.deepEqual(bad.dropped, ['site', 'status', 'year'])
  const good = cleanFilters(data.rows, { site: '48_201_0057', compound: '', status: 'no_report_after_deadline', year: '2025' })
  assert.deepEqual(good.dropped, [])
  assert.equal(good.filters.site, '48_201_0057')
  // The cleaned filters never show 0 rows because of a value the file does not have.
  assert.ok(selectRows(data.rows, bad.filters, 'date', 'desc').length > 0)
})

test('option counts follow the other filters: Channelview has no "Reported" spike, so that option counts 0', () => {
  const f = { ...NO_FILTER, site: '48_201_0026' }
  const status = optionCounts(data.rows, f, 'status')
  for (const [v, n] of status) assert.equal(n, selectRows(data.rows, { ...f, status: v }, 'date', 'desc').length, v)
  assert.equal(status.get('reported'), 0)
  // A select's own value does not narrow its own counts: every monitor still counts its spikes.
  const sites = optionCounts(data.rows, f, 'site')
  assert.equal([...sites.values()].reduce((a, b) => a + b, 0), data.rows.length)
})

test('every reason code in the published file has a translated label, read from the code, not the stand-in sentence', () => {
  // Since review L3 no published Houston row stops at an incomplete week search, so that code is checked from the table.
  const all = ['calm_wind', 'day_search_incomplete', 'earlier_search_incomplete', 'no_wind', 'report_not_placed']
  const codes = new Set(data.rows.map((r) => r.reason_code).filter((c) => c !== undefined))
  assert.ok([...codes].every((c) => all.includes(c!)) && codes.size >= 4, [...codes].join())
  for (const c of all) {
    const k = reasonKey({ reason_code: c })
    assert.ok(k, `no key for ${c}`)
    for (const key of [k, `${k}Long` as const]) assert.ok(STRINGS.en[key] && STRINGS.es[key] && STRINGS.es[key] !== STRINGS.en[key], key)
  }
  // Every search_incomplete row carries a code, and no coded row falls back to "see the replay's Check step".
  const incomplete = data.rows.filter((r) => r.status === 'search_incomplete')
  assert.ok(incomplete.length > 0 && incomplete.every((r) => r.reason_code))
  assert.ok(incomplete.every((r) => reasonKey(r) !== 'spikes.reason.check'))
  // A calm-wind row's own sentence says calm wind (no "could not be placed" stand-in), and so does its label.
  const calm = data.rows.find((r) => r.reason_code === 'calm_wind')!
  assert.match(calm.reason ?? '', /too light/)
  assert.ok(data.rows.every((r) => r.reason_code === 'report_not_placed' || !/could not be placed/.test(r.reason ?? '')))
  assert.equal(reasonKey(calm), 'spikes.reason.calm')
  assert.equal(reasonKey(data.rows.find((r) => r.night_id === null)!), 'spikes.reason.noWind')
  const n = (k: string) => incomplete.filter((r) => reasonKey(r) === k).length
  assert.equal(n('spikes.reason.calm') + n('spikes.reason.placed') + n('spikes.reason.earlier') + n('spikes.reason.week') + n('spikes.reason.noWind'), incomplete.length)
})

test('a file without codes falls back to the sentence; an unknown code or sentence gets no key', () => {
  assert.equal(reasonKey({ reason: 'A report filed that day could not be placed on the map, so absence cannot be claimed.' }), 'spikes.reason.check')
  assert.equal(reasonKey({ reason: 'No wind data for that day, so no upwind area could be drawn.' }), 'spikes.reason.noWind')
  assert.equal(reasonKey({ reason_code: 'new_code', reason: 'A new pipeline sentence.' }), null)
  assert.equal(reasonKey({}), null)
  assert.equal(reasonKey({ reason_code: 'toString', reason: 'toString' }), null)
})

test('the CSV note gives the real cause for a coded row, and the code has its own column', () => {
  const calm = data.rows.find((r) => r.reason_code === 'calm_wind')!
  const [head, line] = toCsv([calm]).trimEnd().split('\r\n')
  const cols = head.split(',')
  assert.ok(cols.includes('reason_code'))
  assert.ok(line.includes(STRINGS.en['spikes.reason.calmLong']), line)
  assert.ok(!line.includes('could not be placed'), line)
  assert.ok(line.includes(',calm_wind,'), line)
})

test('a neighborhood picks the closest monitor in the file', () => {
  const near = (label: string) => nearestSite(data.rows, NEIGHBORHOODS.find((p) => p.label === label)!)!
  assert.equal(near('Galena Park').site_id, '48_201_0057')
  assert.ok(near('Galena Park').km > 0.7 && near('Galena Park').km < 0.9)
  assert.equal(near('Manchester').site_id, '48_201_0307')
  assert.equal(near('Deer Park').site_id, '48_201_1614')
  assert.equal(nearestSite([], NEIGHBORHOODS[0]), null)
})

test('the neighborhood points match the replay place search picks', () => {
  const src = readFileSync(new URL('../src/PlaceSearch.tsx', import.meta.url), 'utf8')
  const picks = [...src.matchAll(/\{ label: '([^']+)', lat: ([\d.-]+), lon: ([\d.-]+) \}/g)].map((m) => ({ label: m[1], lat: Number(m[2]), lon: Number(m[3]) }))
  assert.deepEqual(picks, NEIGHBORHOODS)
})

test('a saved list position is used only for the same URL and only when well formed', () => {
  const raw = JSON.stringify({ search: '?view=spikes&site=48_201_0057', limit: 100, y: 1750 })
  assert.deepEqual(parseSpot(raw, '?view=spikes&site=48_201_0057'), { search: '?view=spikes&site=48_201_0057', limit: 100, y: 1750 })
  assert.equal(parseSpot(raw, '?view=spikes'), null)
  assert.equal(parseSpot('{not json', '?view=spikes'), null)
  assert.equal(parseSpot(null, '?view=spikes'), null)
  assert.equal(parseSpot(JSON.stringify({ search: '?view=spikes', limit: 'all', y: 3 }), '?view=spikes'), null)
  assert.equal(parseSpot(JSON.stringify({ search: '?view=spikes', limit: 1e9, y: -5 }), '?view=spikes')?.limit, 10_000)
})

test('a region with no spikes at all gets its own empty state, not the filter-empty line', () => {
  const none = parseSpikes(JSON.parse(readFileSync(new URL('../public/regions/brazoria/spikes.json', import.meta.url), 'utf8')))
  assert.equal(none.rows.length, 0)
  assert.equal(countKey(none.rows.length, 0, false), 'spikes.none')
  assert.equal(countKey(none.rows.length, 0, true), 'spikes.none')
  assert.equal(yearSpan(none.years), '2024–2025')
  assert.equal(yearSpan(['2025']), '2025')
  // Houston has spikes: a filter that matches nothing is a filter result; otherwise the showing lines.
  assert.equal(countKey(data.rows.length, 0, true), 'spikes.empty')
  assert.equal(countKey(data.rows.length, 5, true), 'spikes.showingFiltered')
  assert.equal(countKey(data.rows.length, data.rows.length, false), 'spikes.showing')
  assert.equal(STRINGS.en['spikes.none'].replace('{years}', yearSpan(none.years)), 'No hour at these monitors crossed the trigger in 2024–2025.')
  assert.equal(STRINGS.es['spikes.none'].replace('{years}', yearSpan(none.years)), 'Ninguna hora en estos monitores cruzó el umbral en 2024–2025.')
  for (const lang of ['en', 'es'] as const) {
    assert.match(STRINGS[lang]['spikes.noneCoverage'], /\{link\}/)
    assert.doesNotMatch(STRINGS[lang]['spikes.none'], /filter|filtro/i)
  }
  assert.throws(() => parseSpikes({ ...none, years: undefined }), /Re-run/)
})
