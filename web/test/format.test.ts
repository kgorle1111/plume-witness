import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countyList, readingText, unitFirst, unitShort, unitTitle } from '../src/format.ts'

test('ppb-v reads as ppb; other units are left as given', () => {
  for (const u of ['ppb-v', 'ppbv', 'PPB-V', 'ppb', ' ppb-v ']) assert.equal(unitShort(u), 'ppb', u)
  assert.equal(unitShort('pounds'), 'pounds')
  assert.equal(unitShort('ppm'), 'ppm')
})

test('the first mention spells ppb out in both languages', () => {
  // ppb-v data says "by volume" in the text itself: a touch screen cannot open the tooltip (S58).
  assert.equal(unitFirst('ppb-v'), 'parts per billion by volume (ppb)')
  assert.equal(unitFirst('ppb-v', 'es'), 'partes por mil millones en volumen (ppb)')
  assert.equal(unitFirst('ppb'), 'parts per billion (ppb)')
  assert.equal(unitFirst('pounds'), 'pounds')
})

test('the tooltip explains the -v only when the data says ppb-v', () => {
  assert.match(unitTitle('ppb-v') ?? '', /by volume/)
  assert.match(unitTitle('ppb-v', 'es') ?? '', /en volumen/)
  assert.equal(unitTitle('ppb'), 'parts per billion')
  assert.equal(unitTitle('pounds'), null)
})

test('a reading keeps its number; only the unit text changes', () => {
  assert.equal(readingText(51.75, null, unitShort('ppb-v')), '51.75 ppb')
  assert.equal(readingText(null, 'AQI', unitShort('ppb-v')), 'no data (AQI)')
})

test('every cannot_say line in every published night has a Spanish entry, with no banned word', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { cannotSayEs } = await import('../src/format.ts')
  const { BANNED_WORDS } = await import('../src/i18n.ts')
  const pub = new URL('../public/', import.meta.url)
  const nights = (dir: string) => readdirSync(new URL(dir, pub)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => `${dir}${f}`)
  const files = ['event.json', ...nights('nights/'), ...nights('regions/beaumont/nights/')]
  assert.ok(files.length > 400, `only ${files.length} night files found`)
  const lines = new Set<string>()
  for (const f of files) for (const s of (JSON.parse(readFileSync(new URL(f, pub), 'utf8')).cannot_say ?? []) as string[]) lines.add(s)
  for (const en of lines) {
    const es = cannotSayEs(en)
    assert.ok(es, `no Spanish for: ${en}`)
    for (const re of BANNED_WORDS) assert.ok(!re.test(es), `banned word ${re} in: ${es}`)
  }
})

test('pounds read as whole pounds, and a small release never shows as 0', async () => {
  const { poundsText } = await import('../src/format.ts')
  assert.equal(poundsText(8469.743), '8,470 lb')
  assert.equal(poundsText(7634), '7,634 lb')
  assert.equal(poundsText(2.46), '2.5 lb')
  assert.equal(poundsText(0.04), '0.04 lb')
  assert.equal(poundsText(1234.5, 'es'), '1,235 lb')
})

test('STEERS spellings of the two tracked compounds map to one name; others stay as written', async () => {
  const { normCompound } = await import('../src/format.ts')
  for (const raw of ['Benzene', 'BENZENE', ' benzene ']) assert.equal(normCompound(raw), 'benzene')
  for (const raw of ['1,3-BUTADIENE', '1,3 Butadiene', '1,3-butadiene', '1,3Butadiene']) assert.equal(normCompound(raw), '1,3-butadiene')
  assert.equal(normCompound('Acrylic acid'), 'Acrylic acid')
  assert.equal(normCompound('Butane, N-'), 'Butane, N-')
})

test('alignment reads as degrees off the wind', async () => {
  const { offWindDeg } = await import('../src/format.ts')
  assert.equal(offWindDeg(1), 0)
  assert.equal(offWindDeg(0.905), 25)
  assert.equal(offWindDeg(0.985), 10)
  assert.equal(offWindDeg(0), 90)
  assert.equal(offWindDeg(1.2), 0)
})

test('the hourly table cell drops the CST its header already gives', async () => {
  const { hourShort } = await import('../src/format.ts')
  assert.equal(hourShort(7), '07:00')
  assert.equal(hourShort(23), '23:00')
})

test('a region county list reads as running text in each language', () => {
  assert.deepEqual(countyList('HARRIS', 'en'), { counties: 'Harris', many: false })
  assert.deepEqual(countyList('EL PASO', 'es'), { counties: 'El Paso', many: false })
  assert.deepEqual(countyList('ECTOR, MIDLAND', 'en'), { counties: 'Ector and Midland', many: true })
  assert.deepEqual(countyList('ECTOR, MIDLAND', 'es'), { counties: 'Ector y Midland', many: true })
  assert.deepEqual(countyList('DALLAS, DENTON, JOHNSON, TARRANT, WISE', 'en'), { counties: 'Dallas, Denton, Johnson, Tarrant and Wise', many: true })
  assert.deepEqual(countyList('BEXAR, COMAL, WILSON', 'es'), { counties: 'Bexar, Comal y Wilson', many: true })
})
