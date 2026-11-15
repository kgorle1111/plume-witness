// The Los Angeles replay files (pipeline/la_replay.py) read in both languages, on their own clock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { searchScopeText, timeNote } from '../src/reportWindow.ts'
import { NIGHT_ID } from '../src/routes.ts'
import { cannotSayEs, hourLabel } from '../src/format.ts'
import { setRegionCopy } from '../src/i18n.ts'
import { REGIONS } from '../src/region.ts'
import { parseSpikes, reasonKey } from '../src/spikes.ts'
import type { PlumeEvent } from '../src/types.ts'

const dir = new URL('../public/regions/los_angeles/nights/', import.meta.url)
const nights = readdirSync(dir).filter((f) => f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as PlumeEvent)

test('every Los Angeles night: its id loads, its time note, search scope and limits translate', () => {
  assert.equal(nights.length, 5)
  for (const ev of nights) {
    assert.ok(NIGHT_ID.test(ev.event_id), ev.event_id)
    assert.match(timeNote(ev.time_note, 'es', false) ?? '', /^Las horas del monitor están en PST/)
    const scope = searchScopeText(ev.record_check.search_scope, 'es')
    assert.equal(scope.lang, 'es', ev.record_check.search_scope)
    for (const line of ev.cannot_say) assert.ok(cannotSayEs(line), `no Spanish for: ${line}`)
  }
})

test('the Los Angeles region reads PST; Texas keeps CST', () => {
  assert.equal(REGIONS.los_angeles.tz, 'PST')
  assert.equal(REGIONS.houston.tz, 'CST')
  try {
    setRegionCopy('los_angeles', 'PST')
    assert.equal(hourLabel(8), '08:00 PST')
  } finally {
    setRegionCopy(null)
  }
  assert.equal(hourLabel(8), '08:00 CST')
})

test('the Los Angeles spike log parses and names each cause', () => {
  const log = parseSpikes(JSON.parse(readFileSync(new URL('../public/regions/los_angeles/spikes.json', import.meta.url), 'utf8')))
  assert.equal(log.rows.length, 6)
  assert.deepEqual(log.rows.map((r) => reasonKey(r)), [
    'spikes.reason.register', 'spikes.reason.noWind', 'spikes.reason.register', 'spikes.reason.register',
    'spikes.reason.calm', 'spikes.reason.calm',
  ])
})
