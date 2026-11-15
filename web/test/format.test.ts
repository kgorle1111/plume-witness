import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readingText, unitFirst, unitShort, unitTitle } from '../src/format.ts'

test('ppb-v reads as ppb; other units are left as given', () => {
  for (const u of ['ppb-v', 'ppbv', 'PPB-V', 'ppb', ' ppb-v ']) assert.equal(unitShort(u), 'ppb', u)
  assert.equal(unitShort('pounds'), 'pounds')
  assert.equal(unitShort('ppm'), 'ppm')
})

test('the first mention spells ppb out in both languages', () => {
  assert.equal(unitFirst('ppb-v'), 'parts per billion (ppb)')
  assert.equal(unitFirst('ppb-v', 'es'), 'partes por mil millones (ppb)')
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
