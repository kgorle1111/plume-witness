// Run: npm test. Region switch: URL -> dataset folder, and the Beaumont file is labeled as not backtested.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOT_BACKTESTED_NOTE, REGIONS, compoundLabel, eventTitle, regionFrom, regionQuery } from '../src/region.ts'
import { parseSpikes } from '../src/spikes.ts'

test('no or unknown region param is Houston, whose URLs and files are unchanged', () => {
  assert.equal(regionFrom('').key, 'houston')
  assert.equal(regionFrom('?region=../../etc').key, 'houston')
  assert.equal(REGIONS.houston.dir, '')
  assert.equal(regionQuery(REGIONS.houston, { night: '2024-06-21_45201_48_201_0069' }), '?night=2024-06-21_45201_48_201_0069')
  assert.equal(regionQuery(REGIONS.houston, {}), '')
})

test('beaumont reads its own folder and keeps the region in links', () => {
  const r = regionFrom('?view=spikes&region=beaumont')
  assert.equal(r.key, 'beaumont')
  assert.equal(r.dir, 'regions/beaumont/')
  assert.equal(r.backtested, false)
  assert.match(r.label, /not backtested/)
  assert.equal(new URLSearchParams(regionQuery(r, { night: 'x' })).get('region'), 'beaumont')
})

test('the published Beaumont spike log parses and carries the not-backtested note', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/regions/beaumont/spikes.json', import.meta.url), 'utf8'))
  const f = parseSpikes(raw)
  assert.equal(f.region?.key, 'beaumont')
  assert.equal(f.region?.backtested, false)
  assert.equal(f.region?.note, NOT_BACKTESTED_NOTE)
  assert.equal(f.summary.known_missed_reports, null)
  assert.equal(f.rows.length, f.summary.spikes)
  assert.ok(f.rows.every((r) => r.site_id.startsWith('48_245_')))
})

test('every published night title follows the reader\'s language, and English stays exactly as the pipeline wrote it', () => {
  const nights = (dir: string) => JSON.parse(readFileSync(new URL(`../public/${dir}nights/index.json`, import.meta.url), 'utf8')) as { id: string }[]
  const seen = new Set<string>()
  for (const r of [REGIONS.houston, REGIONS.beaumont]) {
    for (const { id } of nights(r.dir)) {
      const ev = JSON.parse(readFileSync(new URL(`../public/${r.dir}nights/${id}.json`, import.meta.url), 'utf8'))
      assert.deepEqual(eventTitle('en', ev.title, ev.compound.name, r.key), { text: ev.title, lang: 'en' })
      const es = eventTitle('es', ev.title, ev.compound.name, r.key)
      assert.equal(es.lang, 'es', `${id}: "${ev.title}" was not rebuilt`)
      assert.doesNotMatch(es.text, /spike|Ship Channel/, `${id}: ${es.text}`)
      seen.add(es.text)
    }
  }
  assert.ok(seen.has('Pico de benceno en el Canal de Navegación de Houston'))
  assert.ok(seen.has('Pico de 1,3-butadieno en Beaumont-Port Arthur'))
})

test('a title or compound the templates do not know stays in English instead of being guessed', () => {
  assert.deepEqual(eventTitle('es', 'Fixture night', 'benzene', 'houston'), { text: 'Fixture night', lang: 'en' })
  assert.deepEqual(eventTitle('es', 'Toluene spike on the Houston Ship Channel', 'toluene', 'houston'), { text: 'Toluene spike on the Houston Ship Channel', lang: 'en' })
  assert.equal(compoundLabel('es', 'benzene'), 'benceno')
  assert.equal(compoundLabel('es', 'toluene'), 'toluene')
})
