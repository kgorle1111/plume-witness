import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { incidentNote } from '../src/note.ts'
import { cannotSayEs, statusInfo } from '../src/format.ts'
import type { PlumeEvent } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent

test('incident note carries the event numbers, the record link and every limit', () => {
  const note = incidentNote(ev, 'https://example.test/plume-witness/')
  for (const v of [ev.date_local, String(ev.detection.value), String(ev.detection.baseline), ev.record_check.source_url, 'not a finding'])
    assert.ok(note.includes(v), v)
  for (const t of ev.cannot_say) assert.ok(note.includes(t), t)
  const wind = ev.wind.hourly.find((w) => w.hour_cst === ev.detection.hour_cst)!
  assert.ok(note.includes(`${wind.from_deg}°`) && note.includes(`${wind.speed_mph} mph`))
})

test('cannot_say Spanish: known lines translate, unknown lines fall back, citations carry over', () => {
  assert.match(cannotSayEs('Facility coordinates are as published by EPA ECHO and may be approximate.') ?? '', /EPA ECHO/)
  assert.equal(cannotSayEs('A sentence the map has never seen.'), null)
  const reworded = "A missing report is not a finding about any facility: Texas requires a report only above a reportable quantity, and air readings can't measure how much was released (30 TAC 101.201)."
  assert.match(cannotSayEs(reworded) ?? '', /cantidad reportable.*\(30 TAC 101\.201\)\.$/)
  assert.equal(statusInfo('reported').es, 'Reportado')
  assert.equal(statusInfo('bogus').es, 'Estado desconocido (bogus)')
})
