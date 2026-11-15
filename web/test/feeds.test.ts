import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feedPath, feedUrl } from '../src/feeds.ts'

test('all-spikes feed and per-monitor feed paths', () => {
  assert.equal(feedPath(), 'feeds/all.xml')
  assert.equal(feedPath('48_201_0069'), 'feeds/48_201_0069.xml')
})

test('a malformed site id gets no link, not a broken or traversing one', () => {
  for (const bad of ['', '../x', '48_201_0069/../all', 'all', '48_201_0069.xml']) assert.equal(feedPath(bad), null)
})

test('feed URL is absolute and honours the Pages base path', () => {
  assert.equal(feedUrl('/plume-witness/', 'https://kgorle1111.github.io', '48_201_0069'),
    'https://kgorle1111.github.io/plume-witness/feeds/48_201_0069.xml')
  assert.equal(feedUrl('/', 'http://localhost:4173'), 'http://localhost:4173/feeds/all.xml')
})
