// Run: npm test. The copied incident note links to the night's preview page (share/stubs.ts), which unfurls with the
// night's own title when forwarded; the demo night has no stub and keeps the replay URL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { noteShareUrl } from '../src/shareLink.ts'
import { incidentNote, noteUrl } from '../src/note.ts'
import { collectNights } from '../share/collect.ts'
import { fileURLToPath } from 'node:url'
import type { PlumeEvent } from '../src/types.ts'

const ORIGIN = 'https://kgorle1111.github.io'
const GALENA = '2024-03-29_45201_48_201_0057'

test('a night replay shares its preview page on the Check step, whatever step and params the page is on', () => {
  for (const hash of ['', '#detect', '#trace', '#packet']) {
    assert.equal(noteShareUrl('/plume-witness/', `${ORIGIN}/plume-witness/?night=${GALENA}&intro=0${hash}`),
      `${ORIGIN}/plume-witness/s/${GALENA}.html#check`)
  }
  const beaumont = collectNights(fileURLToPath(new URL('../public/', import.meta.url))).find((n) => n.region !== 'houston')
  assert.ok(beaumont, 'a night outside Houston')
  // The stub carries the region itself (replayHref), so ?region= does not need to travel.
  assert.equal(noteShareUrl('/', `http://localhost:4435/?region=${beaumont.region}&night=${beaumont.id}#packet`),
    `http://localhost:4435/s/${beaumont.id}.html#check`)
})

test('the demo night and malformed ids have no preview page: null, so the note keeps the replay URL', () => {
  for (const href of [`${ORIGIN}/plume-witness/?intro=0#packet`, `${ORIGIN}/plume-witness/`, `${ORIGIN}/plume-witness/?night=../x`, `${ORIGIN}/plume-witness/?night=`]) {
    assert.equal(noteShareUrl('/plume-witness/', href), null, href)
  }
})

test('the note text carries the preview link in both languages', () => {
  const ev = JSON.parse(readFileSync(new URL(`../public/nights/${GALENA}.json`, import.meta.url), 'utf8')) as PlumeEvent
  const href = `${ORIGIN}/plume-witness/?night=${GALENA}&intro=0#packet`
  const link = noteShareUrl('/plume-witness/', href) ?? noteUrl(href)
  assert.equal(incidentNote(ev, link, 'en').split('\n').at(-1), `Replay: ${ORIGIN}/plume-witness/s/${GALENA}.html#check`)
  assert.equal(incidentNote(ev, link, 'es').split('\n').at(-1), `Recorrido: ${ORIGIN}/plume-witness/s/${GALENA}.html#check`)
})
