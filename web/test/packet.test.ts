// Packet review survives a reload in this tab; a bad stored entry never reaches the draft box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSaved, restoreReview } from '../src/packet.ts'
import type { PlumeEvent } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent

test('saved edits come back, and approval never does', () => {
  const raw = JSON.stringify({ source: 'template', drafts: { en: 'MY EDITS', es: ev.packet.draft_es }, approved: true })
  const r = restoreReview(ev, raw, 'es')
  assert.equal(r.drafts.en, 'MY EDITS')
  assert.equal(r.lang, 'es')
  assert.equal(r.approved, false)
})

test('nothing saved, or a malformed or oversized entry, starts from the template', () => {
  const fresh = { lang: 'en', source: 'template', drafts: { en: ev.packet.draft_en, es: ev.packet.draft_es }, approved: false }
  for (const raw of [null, '', 'not json', '{"source":"ai"}', '{"source":"other","drafts":{"en":"a","es":"b"}}',
    JSON.stringify({ source: 'template', drafts: { en: 1, es: 'b' } }),
    JSON.stringify({ source: 'template', drafts: { en: 'x'.repeat(50_001), es: 'b' } })]) {
    assert.deepEqual(restoreReview(ev, raw, 'en'), fresh, String(raw).slice(0, 40))
  }
  assert.equal(parseSaved(JSON.stringify({ source: 'ai', drafts: { en: 'a', es: 'b' } }))?.source, 'ai')
})
