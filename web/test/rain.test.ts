// Run: npm test. Which spikes the rain view shows at time t, on the real published spikes.json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSpikes } from '../src/spikes.ts'
import type { SpikeRow } from '../src/spikes.ts'
import {
  TOTAL_DAYS, countAt, dayFromParam, dayIndex, fadeAlpha, fadeDaysFor, isoFromDay, monthStartDay, monthSummary,
  prefixCounts, radiusPx, timeSpikes, visibleAt,
} from '../src/rain.ts'

const data = parseSpikes(JSON.parse(readFileSync(new URL('../public/spikes.json', import.meta.url), 'utf8')))
const all = timeSpikes(data.rows)

const row = (date: string, hour: number, id: string, status = 'search_incomplete'): SpikeRow => ({
  night_id: id, date, hour_cst: hour, site_id: 's', site: 'Site', lat: 29.7, lon: -95.2, param: 'p', compound: 'benzene',
  value_ppb: 12, baseline_ppb: 0.1, ratio: 120, status, reports_that_day: 0,
})
const small = timeSpikes([row('2024-01-10', 12, 'b'), row('2024-01-02', 0, 'a'), row('2024-01-10', 18, 'c')])

test('every published row lands on the timeline, in time order', () => {
  assert.equal(all.length, data.rows.length)
  for (let i = 1; i < all.length; i++) assert.ok(all[i].at >= all[i - 1].at)
})

test('a spike is invisible before its hour, full at its hour, gone after the fade', () => {
  const a = small[0].at // 2024-01-02 00:00 -> day 1
  assert.equal(a, 1)
  assert.deepEqual(visibleAt(small, a - 0.001, 14), [])
  assert.deepEqual(visibleAt(small, a, 14), [{ i: 0, age: 0 }])
  const mid = visibleAt(small, a + 7, 14)
  assert.equal(mid.length, 1)
  assert.equal(mid[0].age, 0.5)
  assert.deepEqual(visibleAt(small, a + 14, 14).map((x) => small[x.i].row.night_id), ['b', 'c'])
  const lone = timeSpikes([row('2024-01-02', 0, 'a')])
  assert.deepEqual(visibleAt(lone, 1 + 14, 14), [])
})

test('the same-day spikes appear in hour order and age independently', () => {
  const t = dayIndex('2024-01-10') + 15 / 24 // 15:00: the 12:00 spike is up, the 18:00 one is not yet
  const v = visibleAt(small, t, 2)
  assert.deepEqual(v.map((x) => small[x.i].row.night_id), ['b'])
  const later = visibleAt(small, dayIndex('2024-01-10') + 18 / 24, 2)
  assert.deepEqual(later.map((x) => small[x.i].row.night_id), ['b', 'c'])
  assert.ok(later[0].age > later[1].age)
})

test('fade length follows speed: 2 seconds of animated time', () => {
  assert.equal(fadeDaysFor(7), 14)
  assert.ok(Math.abs(fadeDaysFor(30.4375) - 60.875) < 1e-9)
  assert.deepEqual(visibleAt(small, 5, 0), [])
  assert.deepEqual(visibleAt(small, 5, -3), [])
})

test('visibleAt agrees with a plain filter over the real data at many times', () => {
  for (const fade of [14, 60.875]) {
    for (let t = 0; t <= TOTAL_DAYS; t += 3.7) {
      const want = all.flatMap((s, i) => (s.at <= t && t - s.at < fade ? [i] : []))
      assert.deepEqual(visibleAt(all, t, fade).map((x) => x.i), want, `t=${t} fade=${fade}`)
    }
  }
})

test('ages stay in [0, 1) and opacity falls from 1 to 0', () => {
  for (const { age } of visibleAt(all, 400, 60)) assert.ok(age >= 0 && age < 1)
  assert.equal(fadeAlpha(0), 1)
  assert.equal(fadeAlpha(1), 0)
  let prev = 1
  for (let a = 0.05; a < 1; a += 0.05) {
    assert.ok(fadeAlpha(a) < prev)
    prev = fadeAlpha(a)
  }
})

test('the running count is the sum of statuses and reaches the published summary', () => {
  const prefix = prefixCounts(all)
  assert.equal(countAt(all, -1), 0)
  assert.equal(countAt(all, TOTAL_DAYS), all.length)
  assert.deepEqual(prefix[all.length], data.summary.by_status)
  const n = countAt(all, 365)
  assert.equal(Object.values(prefix[n]).reduce((a, b) => a + b, 0), n)
  assert.ok(all.slice(0, n).every((s) => s.at <= 365) && all.slice(n).every((s) => s.at > 365))
})

test('dates and months line up: leap 2024, 731 days, month starts', () => {
  assert.equal(dayIndex('2024-12-31'), 365)
  assert.equal(dayIndex('2025-12-31'), TOTAL_DAYS - 1)
  assert.equal(isoFromDay(0), '2024-01-01')
  assert.equal(isoFromDay(59), '2024-02-29')
  assert.equal(isoFromDay(TOTAL_DAYS + 50), '2025-12-31')
  assert.equal(monthStartDay(2), 60)
  assert.equal(monthStartDay(24), TOTAL_DAYS)
  assert.equal(dayFromParam('2024-06-15'), 166)
  assert.equal(dayFromParam('2023-12-31'), null)
  assert.equal(dayFromParam('nope'), null)
})

test('size grows with the ratio on a log scale and is capped', () => {
  assert.equal(radiusPx(null), 5)
  assert.equal(radiusPx(10), 5)
  assert.ok(radiusPx(100) > radiusPx(50))
  assert.equal(radiusPx(1_000_000), 15)
})

test('the month summary uses the site wording and counts every spike once', () => {
  const sum = monthSummary(all, 0)
  assert.match(sum, /^January 2024: \d+ spikes? at \d+ monitors?\./)
  const total = data.rows.filter((r) => r.date.startsWith('2024-01')).length
  assert.ok(sum.includes(`${total} spike`))
  assert.equal(monthSummary(small, 5), 'June 2024: no spikes.')
})
