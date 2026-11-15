// Run: npm test. When the replay map plays its globe intro on load (mapIntro.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { introOnLoad } from '../src/mapIntro.ts'

const wide = { wide: true, reducedMotion: false, saveData: false }

test('a cold visit to the demo night on a wide screen plays the intro (demo/flows b0-globe depends on it)', () => {
  assert.equal(introOnLoad('?view=replay', wide), true)
  assert.equal(introOnLoad('', wide), true)
  assert.equal(introOnLoad('?region=beaumont', wide), true)
})

test('night links, embeds and intro=0 open flat', () => {
  assert.equal(introOnLoad('?night=2024-03-29_45201_48_201_0057', wide), false)
  assert.equal(introOnLoad('?embed=1', wide), false)
  assert.equal(introOnLoad('?night=x&embed=1', wide), false)
  assert.equal(introOnLoad('?intro=0', wide), false)
  assert.equal(introOnLoad('?night=x&intro=1', wide), true)
  assert.equal(introOnLoad('?embed=1&intro=1', wide), false)
})

test('narrow screens, reduced motion and Data Saver never get it on load', () => {
  assert.equal(introOnLoad('', { ...wide, wide: false }), false)
  assert.equal(introOnLoad('', { ...wide, reducedMotion: true }), false)
  assert.equal(introOnLoad('?night=x&intro=1', { ...wide, saveData: true }), false)
})
