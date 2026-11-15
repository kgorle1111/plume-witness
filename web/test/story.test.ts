import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pageFromLocation } from '../src/routes.ts'
import { STORY_COPY, STORY_STEPS, storyStepIndex } from '../src/storyCopy.ts'

test('?view=story opens story mode, with or without a step in the hash', () => {
  assert.equal(pageFromLocation({ search: '?view=story', hash: '' }), 'story')
  assert.equal(pageFromLocation({ search: '?view=story&intro=0', hash: '#record' }), 'story')
})

test('the hash picks the step; anything else opens the first', () => {
  assert.deepEqual([...STORY_STEPS], ['spike', 'upwind', 'record', 'question'])
  assert.equal(storyStepIndex('#upwind'), 1)
  assert.equal(storyStepIndex('#question'), 3)
  assert.equal(storyStepIndex(''), 0)
  assert.equal(storyStepIndex('#detect'), 0)
})

test('English and Spanish name every step', () => {
  for (const s of STORY_STEPS) {
    assert.ok(STORY_COPY.en.eyebrow[s])
    assert.ok(STORY_COPY.es.eyebrow[s])
  }
})

test("the story's night file exists and is the Galena Park spike the copy is written for", () => {
  const src = readFileSync(new URL('../src/Story.tsx', import.meta.url), 'utf8')
  const id = /STORY_NIGHT = '([^']+)'/.exec(src)?.[1]
  assert.ok(id)
  const ev = JSON.parse(readFileSync(new URL(`../public/nights/${id}.json`, import.meta.url), 'utf8'))
  assert.equal(ev.label, 'real')
  assert.equal(ev.detection.site_id, '48_201_0057')
  assert.equal(ev.compound.name, 'benzene')
  assert.ok(ev.packet.draft_en && ev.packet.draft_es)
  assert.match(ev.record_check.search_scope, /by \d{1,2}:\d{2} local were also searched \(\d+ found/)
})
