// Run: npm test. Unit-tests the precache list, checks sw.js parses, and (when dist/ exists, as in CI after
// `npm run build`) checks the real build's precache.json against dist/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { buildId, precacheList } from '../pwa/precache.ts'
import { pageIsStale } from '../src/pwa.ts'

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(new URL(rel, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`])

test('precacheList: shell, hashed assets, offline data in; maps, other nights, mp3s and the SW itself out', () => {
  const list = precacheList([
    'index.html', 'sw.js', 'precache.json', 'event.json', 'packet.ai.json', 'spikes.json', 'rose.json', 'people.json',
    'assets/index-abc123.js', 'assets/index-abc123.css', 'assets/index-abc123.js.map', 'audio/ai_en.mp3', 'audio/manifest.json',
    'nights/2024-01-04_x.json', 'nights/index.json', 'nights/2024-03-29_45201_48_201_0057.json', 'facilities/1.json',
    'facilities/index.json', 'regions/beaumont/spikes.json', 'regions/beaumont/nights/index.json',
    'regions/beaumont/nights/2024-10-23_x.json', 'regions/../spikes.json', 'manifest.webmanifest', 'icon-192.png',
  ])
  assert.deepEqual(list, [
    './', 'assets/index-abc123.css', 'assets/index-abc123.js', 'audio/manifest.json', 'event.json', 'facilities/index.json',
    'icon-192.png', 'manifest.webmanifest', 'nights/2024-03-29_45201_48_201_0057.json', 'nights/index.json',
    'packet.ai.json', 'regions/beaumont/nights/index.json', 'regions/beaumont/spikes.json', 'rose.json', 'spikes.json',
  ])
})

test('the second demo night precached is a real night file', () => {
  assert.ok(existsSync(new URL('../public/nights/2024-03-29_45201_48_201_0057.json', import.meta.url)))
})

test('buildId is order-independent and changes when any byte changes', () => {
  const a = new TextEncoder().encode('a'), b = new TextEncoder().encode('b')
  assert.equal(buildId([['x', a], ['y', b]]), buildId([['y', b], ['x', a]]))
  assert.notEqual(buildId([['x', a], ['y', b]]), buildId([['x', a], ['y', a]]))
})

test('public/sw.js has no syntax errors and keeps the placeholder the build stamps', () => {
  const sw = new URL('../public/sw.js', import.meta.url)
  execFileSync(process.execPath, ['--check', fileURLToPath(sw)])
  assert.match(readFileSync(sw, 'utf8'), /'__BUILD_ID__'/)
})

const dist = new URL('../dist/', import.meta.url)
test('dist: precache.json covers index.html and every hashed asset; sw.js is stamped', { skip: !existsSync(dist) && 'run npm run build first' }, () => {
  const { build, urls } = JSON.parse(readFileSync(new URL('precache.json', dist), 'utf8')) as { build: string; urls: string[] }
  const files = walk(dist)
  assert.ok(urls.includes('./'), 'index.html (as ./)')
  const assets = files.filter((f) => f.startsWith('assets/') && !f.endsWith('.map'))
  assert.ok(assets.some((f) => f.endsWith('.js')) && assets.some((f) => f.endsWith('.css')), 'build has js and css')
  for (const f of assets) assert.ok(urls.includes(f), `missing ${f}`)
  for (const u of urls) assert.ok(u === './' ? files.includes('index.html') : files.includes(u), `listed but not in dist: ${u}`)
  for (const f of ['event.json', 'packet.ai.json', 'spikes.json', 'rose.json', 'audio/manifest.json', 'nights/index.json', 'facilities/index.json']) assert.ok(urls.includes(f), `missing ${f}`)
  assert.ok(!urls.some((u) => u.endsWith('.mp3')), 'narration mp3s are cached on first play, not precached')
  const sw = readFileSync(new URL('sw.js', dist), 'utf8')
  assert.ok(sw.includes(`'${build}'`) && !sw.includes('__BUILD_ID__'))
})

test('pageIsStale: an open page is stale only when its own entry script left the new precache list', () => {
  const scope = 'https://x.test/plume-witness/'
  const urls = ['./', 'assets/index-new.js', 'assets/App-new.js']
  assert.equal(pageIsStale(`${scope}assets/index-old.js`, scope, urls), true)
  assert.equal(pageIsStale(`${scope}assets/index-new.js`, scope, urls), false)
  // Dev server or a script from another origin: nothing to compare, never prompt.
  assert.equal(pageIsStale('https://x.test/src/main.tsx', scope, urls), false)
  assert.equal(pageIsStale('https://cdn.test/plume-witness/assets/index-old.js', scope, urls), false)
})
