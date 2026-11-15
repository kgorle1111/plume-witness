import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LoadError, chunkUrl, classifyLoadError, responseError } from '../src/loadError.ts'
import { decodeReview, encodeReview, packetKey } from '../src/packetStore.ts'
import { playStartHour } from '../src/playStart.ts'
import { shouldScrollToSteps, stepIndex } from '../src/stepScroll.ts'
import type { PacketReview } from '../src/packet.ts'

test('a failed load is told apart: offline, network, missing, damaged', () => {
  const fetchFail = new TypeError('Failed to fetch')
  assert.equal(classifyLoadError(fetchFail, false).kind, 'offline')
  assert.equal(classifyLoadError(fetchFail, true).kind, 'network')
  assert.equal(classifyLoadError(new SyntaxError("Unexpected token '<'"), true).kind, 'damaged')
  assert.equal(classifyLoadError(new Error('event.json is missing: schema'), true).kind, 'damaged')
  assert.equal(classifyLoadError(new LoadError('noNights', 'none'), true).kind, 'noNights')
  // The engine text is kept for the "technical detail" disclosure, not dropped.
  assert.equal(classifyLoadError(fetchFail, true).detail, 'Failed to fetch')
})

test('HTTP status and an HTML fallback page map to reader-facing kinds', () => {
  assert.equal(responseError('nights/x.json', 404, 'text/html')?.kind, 'notFound')
  assert.equal(responseError('nights/x.json', 500, 'application/json')?.kind, 'network')
  // vite preview and some hosts answer a missing JSON file with index.html and a 200.
  assert.equal(responseError('nights/x.json', 200, 'text/html; charset=utf-8')?.kind, 'notFound')
  assert.equal(responseError('nights/x.json', 200, 'application/json'), null)
})

test('a failed chunk import yields its URL; other errors do not', () => {
  const chrome = new TypeError('Failed to fetch dynamically imported module: https://x.github.io/plume-witness/assets/EventMap-abc123.js')
  assert.equal(chunkUrl(chrome), 'https://x.github.io/plume-witness/assets/EventMap-abc123.js')
  assert.equal(chunkUrl(new TypeError('Importing a module script failed.')), null)
  assert.equal(chunkUrl(new Error('WebGL context lost')), null)
})

const base: PacketReview = { lang: 'en', source: 'template', drafts: { en: 'T en', es: 'T es' }, approved: true }

test('stored draft edits come back, approval never does', () => {
  const edited: PacketReview = { ...base, drafts: { en: 'MY EDITS', es: 'T es' }, approved: true }
  const back = decodeReview(encodeReview(edited), { ...base, approved: false })
  assert.equal(back.drafts.en, 'MY EDITS')
  assert.equal(back.approved, false)
  // Even an entry that claims approval (an older or hand-edited one) comes back unapproved.
  assert.equal(decodeReview('{"source":"template","drafts":{"en":"a","es":"b"},"approved":true}', { ...base, approved: true }).approved, false)
  assert.equal(packetKey('2024-06-21_x'), 'pw-packet:2024-06-21_x')
})

test('a damaged or foreign stored entry falls back to the fresh draft', () => {
  const fresh = { ...base, approved: false }
  for (const raw of [null, '', 'not json', '42', '{"source":"gpt","drafts":{"en":"a","es":"b"}}', '{"source":"ai","drafts":{"en":1}}']) {
    assert.deepEqual(decodeReview(raw, fresh), fresh, `raw=${raw}`)
  }
})

test('Play starts at the window start unless it resumes the user\'s pause', () => {
  // Demo night: window 06-12, the replay opens on the 09:00 detection hour.
  assert.equal(playStartHour(9, 6, 12, false), 6)
  assert.equal(playStartHour(10, 6, 12, true), 10)
  // At or past the end, even a resume starts over.
  assert.equal(playStartHour(12, 6, 12, true), 6)
  assert.equal(playStartHour(3, 6, 12, true), 6)
})

test('a step change scrolls the steps up only when they are low or above the screen', () => {
  assert.equal(shouldScrollToSteps(529, 664), true)
  assert.equal(shouldScrollToSteps(-300, 812), true)
  assert.equal(shouldScrollToSteps(100, 812), false)
  assert.equal(shouldScrollToSteps(0, 812), false)
})

test('an unknown hash names no step', () => {
  const ids = ['detect', 'trace', 'check', 'packet'] as const
  assert.equal(stepIndex('#check', ids), 2)
  assert.equal(stepIndex('#bogus', ids), -1)
  assert.equal(stepIndex('', ids), -1)
})
