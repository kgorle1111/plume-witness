import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { arrivalTick, daysAfterEvent, localOffsetH, localToCstMinutes, reportBand } from '../src/reportWindow.ts'
import type { PlumeEvent, RecordCheck } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent

test('CDT is CST+1 and CST is CST+0; an unknown zone draws nothing', () => {
  assert.equal(localOffsetH('local (CDT)'), 1)
  assert.equal(localOffsetH('local (CST)'), 0)
  assert.equal(localOffsetH('local'), null)
  assert.equal(localOffsetH(undefined), null)
  assert.equal(localToCstMinutes('2024-06-21T09:38', '2024-06-21', 1), 8 * 60 + 38)
  assert.equal(localToCstMinutes('2024-01-09T09:38', '2024-01-09', 0), 9 * 60 + 38)
  assert.equal(localToCstMinutes('2024-06-20T23:30', '2024-06-21', 1), -(60 + 30))
  assert.equal(localToCstMinutes('2024-06-21T00:30', '2024-06-21', 1), -30)
})

test('demo night: 9:38-10:42 CDT is drawn at 8:38-9:42 CST, solid, with the arrival marker', () => {
  const b = reportBand(ev.record_check, ev.date_local)!
  assert.ok(b.matched)
  assert.ok(Math.abs(b.from - (8 + 38 / 60)) < 1e-9 && Math.abs(b.to - (9 + 42 / 60)) < 1e-9)
  assert.match(b.localText, /^9:38 to 10:42 CDT$/)
  assert.match(b.cstText, /^8:38 to 9:42 CST$/)
  const t = arrivalTick(ev.record_check, ev.date_local)!
  assert.ok(Math.abs(t.hourCst - (9 + 36 / 60)) < 1e-9)
  assert.equal(t.text, 'air could arrive ~10:36 CDT (wind 6.8 mph, 10.6 km)')
})

const base = (over: Partial<RecordCheck>): RecordCheck => ({ ...ev.record_check, ...over })

test('mismatch is flagged not matched; no-report and incomplete nights draw nothing', () => {
  assert.equal(reportBand(base({ status: 'reported_mismatch' }), ev.date_local)!.matched, false)
  for (const status of ['no_report_after_deadline', 'search_incomplete'] as const)
    assert.equal(reportBand(base({ status, reported: null }), ev.date_local), null)
})

test('a report that began the day before is clipped to the chart and says so; one outside the day draws nothing', () => {
  const r = { ...ev.record_check.reported!, start_local: '2024-06-20T20:00', end_local: '2024-06-21T08:15' }
  const b = reportBand(base({ reported: r }), ev.date_local)!
  assert.equal(b.from, 0)
  assert.ok(b.startsBefore && !b.endsAfter)
  assert.equal(b.cstText, null)
  assert.equal(b.localText, 'Jun 20 20:00 to 8:15 CDT')
  const gone = { ...r, start_local: '2024-06-20T01:00', end_local: '2024-06-20T03:00' }
  assert.equal(reportBand(base({ reported: gone }), ev.date_local), null)
})

test('arrival marker needs every travel field', () => {
  const r = { ...ev.record_check.reported! }
  delete r.travel_speed_mph
  assert.equal(arrivalTick(base({ reported: r }), ev.date_local), null)
})

test('revision lands 173 days after the demo event and is carried in the event file', () => {
  const rev = ev.record_check.reported!.revisions!
  assert.equal(rev.length, 1)
  assert.equal(daysAfterEvent(ev.record_check.reported!.start_local!, rev[0].date), 173)
})
