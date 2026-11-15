// Run: npm test. The spike log's CSV and filter logic, on the real published spikes.json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { NO_FILTER, csvCell, dateText, parseSpikes, selectRows, spikeKey, toCsv } from '../src/spikes.ts'

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

test('a row links to a replay exactly when its night file exists (Galena Park 2025-10-28 has none)', () => {
  for (const r of data.rows) {
    const file = new URL(`../public/nights/${spikeKey(r)}.json`, import.meta.url)
    assert.equal(r.night_id !== null, existsSync(file), spikeKey(r))
  }
  const galena = data.rows.find((r) => spikeKey(r) === '2025-10-28_45201_48_201_0057')!
  assert.equal(galena.night_id, null)
})

test('a null night_id still parses, sorts and exports to CSV', () => {
  const rows = selectRows(data.rows, NO_FILTER, 'date', 'desc')
  assert.equal(new Set(rows.map(spikeKey)).size, rows.length)
  const g = data.rows.find((r) => r.night_id === null)!
  const cols = toCsv([g]).split('\r\n')[1]
  assert.ok(cols.endsWith(','), 'night_id column is empty, not the text "null"')
})
