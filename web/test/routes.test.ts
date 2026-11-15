import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageFromLocation } from '../src/routes.ts'

const page = (search: string, hash = '') => pageFromLocation({ search, hash })

test('a bare URL opens the landing page', () => {
  assert.equal(page(''), 'landing')
})

test('every view keeps its own page', () => {
  assert.equal(page('?view=spikes'), 'spikes')
  assert.equal(page('?view=brief'), 'brief')
  assert.equal(page('?view=timeline'), 'timeline')
  assert.equal(page('?view=timeline&at=2024-06-15'), 'timeline')
  assert.equal(page('?view=facilities'), 'facilities')
  assert.equal(page('?view=facility&id=110000462623'), 'facility')
})

test('replay links never land on the landing page', () => {
  assert.equal(page('?intro=0', '#detect'), 'replay')
  assert.equal(page('', '#packet'), 'replay')
  assert.equal(page('?night=2024-01-04_43218_48_201_0069'), 'replay')
  assert.equal(page('?region=beaumont&night=x'), 'replay')
  assert.equal(page('?embed=1&night=x'), 'replay')
  assert.equal(page('?view=replay'), 'replay')
  assert.equal(page('?region=beaumont'), 'replay')
  assert.equal(page('?embed=1'), 'replay')
})
