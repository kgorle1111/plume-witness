// Run: npm test. Region switch: URL -> dataset folder (from regions.generated.json); labels are the place name only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REGIONS, buildRegions, compoundLabel, eventTitle, regionByKey, regionFrom, regionLabel, regionQuery, regionUnknown, type RegionRow } from '../src/region.ts'
import { translate } from '../src/i18n.ts'
import { navHref, replayHref } from '../src/routes.ts'
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
  assert.equal(r.backtested, true)
  assert.equal(r.label, 'Beaumont-Port Arthur')
  assert.equal(new URLSearchParams(regionQuery(r, { night: 'x' })).get('region'), 'beaumont')
})

test('the published Beaumont spike log parses and carries its backtest line and ground truth', () => {
  const raw = JSON.parse(readFileSync(new URL('../public/regions/beaumont/spikes.json', import.meta.url), 'utf8'))
  const f = parseSpikes(raw)
  assert.equal(f.region?.key, 'beaumont')
  assert.equal(f.region?.backtested, true)
  assert.match(f.region?.note ?? '', /^Backtested against company-reported releases \(n = \d+, 2024-2025\)$/)
  assert.equal(typeof f.summary.known_missed_reports, 'number')
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

test('the region list is the generated registry, and every registered region has its spike log and nights', () => {
  const rows = JSON.parse(readFileSync(new URL('../src/regions.generated.json', import.meta.url), 'utf8')) as { key: string }[]
  assert.deepEqual(Object.keys(REGIONS), rows.map((r) => r.key))
  for (const r of Object.values(REGIONS)) {
    assert.ok(readFileSync(new URL(`../public/${r.dir}spikes.json`, import.meta.url), 'utf8').length > 0, r.key)
    assert.ok(Array.isArray(JSON.parse(readFileSync(new URL(`../public/${r.dir}nights/index.json`, import.meta.url), 'utf8'))), r.key)
  }
})

test('Houston and Beaumont labels are the place name only, in both languages', () => {
  assert.equal(regionLabel('en', REGIONS.houston), 'Houston Ship Channel')
  assert.equal(regionLabel('es', REGIONS.houston), 'Houston Ship Channel')
  assert.equal(regionLabel('en', REGIONS.beaumont), 'Beaumont-Port Arthur')
  assert.equal(regionLabel('es', REGIONS.beaumont), 'Beaumont-Port Arthur')
  assert.equal(REGIONS.beaumont.label, 'Beaumont-Port Arthur')
  assert.equal(REGIONS.houston.place, 'Houston Ship Channel')
  assert.equal(REGIONS.beaumont.place, 'Beaumont-Port Arthur')
  assert.equal(translate('en', 'shell.houstonOnly', { region: REGIONS.beaumont.name.en }),
    'This page covers the Houston Ship Channel only. Beaumont-Port Arthur has its own spike log and night replays.')
  assert.equal(translate('es', 'shell.houstonOnly', { region: REGIONS.beaumont.name.es }),
    'Esta página cubre solo el Canal de Navegación de Houston. Beaumont-Port Arthur tiene su propio registro de picos y repeticiones de noches.')
})

// Test-only third region: nothing in src names it, so it routes and labels only through the registry.
const FAKE: RegionRow = {
  key: 'corpus_christi', label: 'Corpus Christi', label_es: 'Corpus Christi (es)', place: 'in Corpus Christi',
  place_es: 'en Corpus Christi', dir: 'regions/corpus_christi/', backtested: false, n_sites: 3, county: 'NUECES',
}
const rows = JSON.parse(readFileSync(new URL('../src/regions.generated.json', import.meta.url), 'utf8')) as RegionRow[]
const WITH_FAKE = buildRegions([...rows, FAKE])

test('a third region in the registry routes, labels and titles with no code change', () => {
  const r = regionFrom('?view=spikes&region=corpus_christi', WITH_FAKE)
  assert.equal(r.key, 'corpus_christi')
  assert.equal(r.dir, 'regions/corpus_christi/')
  assert.equal(r.backtested, false)
  assert.equal(regionUnknown('?region=corpus_christi', WITH_FAKE), false)
  assert.equal(regionUnknown('?region=corpus_christi'), true, 'not in the committed registry, so the real app says unknown')
  // No work-in-progress suffix even for a region with no backtest: the label is the place name.
  assert.equal(regionLabel('en', r), 'Corpus Christi')
  assert.equal(regionLabel('es', r), 'Corpus Christi (es)')
  assert.equal(new URLSearchParams(regionQuery(r, { night: 'x' })).get('region'), 'corpus_christi')
  const nav = new URL(navHref('/plume-witness/', 'timeline', '?region=corpus_christi&night=x', WITH_FAKE), 'https://x.test')
  assert.equal(nav.searchParams.get('region'), 'corpus_christi')
  assert.equal(nav.searchParams.get('view'), 'timeline')
  assert.equal(new URL(replayHref('/', '?view=spikes&region=corpus_christi', WITH_FAKE), 'https://x.test').searchParams.get('region'), 'corpus_christi')
  assert.deepEqual(eventTitle('es', 'Benzene spike in Corpus Christi', 'benzene', 'corpus_christi', WITH_FAKE),
    { text: 'Pico de benceno en Corpus Christi', lang: 'es' })
  // Houston and Beaumont are untouched by the extra row.
  assert.equal(regionFrom('', WITH_FAKE).key, 'houston')
  assert.equal(regionFrom('?region=beaumont', WITH_FAKE).dir, 'regions/beaumont/')
})

test('an unknown key still falls back to Houston and is flagged, with or without extra regions', () => {
  for (const regs of [REGIONS, WITH_FAKE]) {
    for (const q of ['?region=bogus', '?region=toString', '?region=__proto__', '?region=Corpus_Christi']) {
      assert.equal(regionFrom(q, regs).key, 'houston', q)
      assert.equal(regionUnknown(q, regs), true, q)
    }
  }
  assert.equal(regionByKey(undefined).key, 'houston')
  assert.equal(translate('en', 'region.unknown'), 'Unknown region; showing Houston Ship Channel')
})

test('a registry row the app could not load is refused', () => {
  const bad: Partial<RegionRow>[] = [{ key: 'Corpus Christi' }, { dir: '../../etc/' }, { dir: 'regions/beaumont/' }, { key: 'houston', dir: '' }]
  for (const b of bad) assert.throws(() => buildRegions([...rows, { ...FAKE, ...b }]), JSON.stringify(b))
  assert.throws(() => buildRegions([FAKE]), /Houston is missing/)
})
