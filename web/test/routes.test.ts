import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV_ITEMS, navHref, pageFromLocation, regionStartNight, replayHref } from '../src/routes.ts'

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

test('header links keep a Beaumont reader in Beaumont, and Houston links keep their old shape', () => {
  for (const v of NAV_ITEMS) {
    const href = navHref('/plume-witness/', v, '?region=beaumont&night=2024-10-23_43218_48_245_1035&intro=0')
    const u = new URL(href, 'https://x.test')
    assert.equal(u.pathname, '/plume-witness/')
    assert.equal(u.searchParams.get('view'), v)
    assert.equal(u.searchParams.get('region'), 'beaumont', `${v} lost the region: ${href}`)
    assert.equal(page(u.search), v)
  }
  assert.equal(navHref('/', 'timeline', '?view=spikes'), '/?view=timeline')
  assert.equal(navHref('/', 'spikes', '?region=../../x'), '/?view=spikes')
})

test('the replay link opens the reader\'s region', () => {
  assert.equal(replayHref('/', ''), '/?intro=0#detect')
  const b = new URL(replayHref('/', '?view=spikes&region=beaumont'), 'https://x.test')
  assert.equal(b.searchParams.get('region'), 'beaumont')
  assert.equal(page(b.search, b.hash), 'replay')
})

test('?region=beaumont with no night opens the first Beaumont night, not the Houston demo', () => {
  const rows = JSON.parse(readFileSync(new URL('../public/regions/beaumont/nights/index.json', import.meta.url), 'utf8'))
  const id = regionStartNight(rows)
  assert.equal(id, rows[0].id)
  assert.ok(readFileSync(new URL(`../public/regions/beaumont/nights/${id}.json`, import.meta.url), 'utf8').includes('Beaumont'))
  assert.equal(regionStartNight([]), null)
  assert.equal(regionStartNight({}), null)
  assert.equal(regionStartNight([{ id: '../../etc/passwd' }, { id: '2025-08-25_45201_48_245_0009' }]), '2025-08-25_45201_48_245_0009')
})
