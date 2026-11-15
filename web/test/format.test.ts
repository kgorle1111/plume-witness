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

test('distances read miles first with the km in parentheses, converted exactly (decision #8)', async () => {
  const { distanceText, KM_PER_MILE } = await import('../src/format.ts')
  assert.equal(KM_PER_MILE, 1.609344) // the international mile, exactly
  assert.equal(distanceText(10.6), '6.6 mi (10.6 km)') // 6.5865 mi
  assert.equal(distanceText(22.9), '14.2 mi (22.9 km)') // 14.2295 mi
  assert.equal(distanceText(15), '9.3 mi (15 km)') // a whole km stays whole: no padding zero
  assert.equal(distanceText(1.609344), '1.0 mi (1.6 km)')
  // Computed distances (place search) carry many decimals: km to 0.1, miles from the unrounded km.
  assert.equal(distanceText(0.8123), '0.5 mi (0.8 km)')
  assert.equal(distanceText(0.12), '0.1 mi (0.1 km)') // 0.0746 mi rounds up to 0.1
  assert.equal(distanceText(0.06), '< 0.1 mi (0.1 km)') // 0.037 mi: not shown as 0.0
  assert.equal(distanceText(0.01), '< 0.1 mi (< 0.1 km)')
  assert.equal(distanceText(0), '0.0 mi (0 km)')
  // A distance parsed from pipeline text arrives as a string.
  assert.equal(distanceText('22.9'), '14.2 mi (22.9 km)')
  // Not a distance: shown as given rather than as a made-up number.
  assert.equal(distanceText(Number.NaN), 'NaN km')
  assert.equal(distanceText('x'), 'x km')
  assert.equal(distanceText(-1), '-1 km')
})

test('every facility distance on screen converts back to its km within the shown precision', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { distanceText, KM_PER_MILE } = await import('../src/format.ts')
  const dir = new URL('../public/facilities/', import.meta.url)
  const files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))
  assert.ok(files.length > 100, `only ${files.length} facility files`)
  for (const f of files) {
    const km = JSON.parse(readFileSync(new URL(f, dir), 'utf8')).distance_km as number
    const m = /^(\d+\.\d) mi \((\d+(?:\.\d)?) km\)$/.exec(distanceText(km))
    assert.ok(m, `${f}: ${distanceText(km)}`)
    assert.equal(Number(m[2]), km, `${f}: km changed`) // the source km is shown as published
    assert.ok(Math.abs(Number(m[1]) * KM_PER_MILE - km) <= 0.05 * KM_PER_MILE + 1e-9, `${f}: ${m[1]} mi is not ${km} km`)
  }
})

test('table numbers keep every digit and split at the decimal point (decision #9)', async () => {
  const { decimalParts, fracDigits, maxFracDigits, plainDecimal } = await import('../src/format.ts')
  assert.deepEqual(decimalParts(10.17), { int: '10', frac: '.17' })
  assert.deepEqual(decimalParts(0.225), { int: '0', frac: '.225' })
  assert.deepEqual(decimalParts(16.4), { int: '16', frac: '.4' }) // no padding zero
  assert.deepEqual(decimalParts(400), { int: '400', frac: '' })
  assert.deepEqual(decimalParts(-2.5), { int: '-2', frac: '.5' })
  assert.deepEqual(decimalParts(8469.743, true), { int: '8,469', frac: '.743' })
  assert.deepEqual(decimalParts(1234567.5, true), { int: '1,234,567', frac: '.5' })
  assert.deepEqual(decimalParts(999, true), { int: '999', frac: '' })
  assert.deepEqual(decimalParts(8469.743), { int: '8469', frac: '.743' }) // grouping only on request
  // Never an exponent: the same digits with the point moved.
  assert.equal(plainDecimal(1e-7), '0.0000001')
  assert.equal(plainDecimal(1.5e-8), '0.000000015')
  assert.equal(plainDecimal(-2.5e-7), '-0.00000025')
  assert.equal(plainDecimal(1e21), '1000000000000000000000')
  assert.equal(plainDecimal(1.25e22), '12500000000000000000000')
  assert.deepEqual(decimalParts(1e-7), { int: '0', frac: '.0000001' })
  assert.equal(fracDigits(1e-7), 7)
  assert.equal(fracDigits(12.5), 1)
  assert.equal(fracDigits(3), 0)
  assert.equal(fracDigits(null), 0)
  assert.equal(fracDigits(Number.POSITIVE_INFINITY), 0)
  assert.equal(maxFracDigits([0.07, 0.26, 0.225, 0.265, null]), 3)
  assert.equal(maxFracDigits([]), 0)
})

test('every published spike value survives the split digit for digit', async () => {
  const { readFileSync } = await import('node:fs')
  const { decimalParts } = await import('../src/format.ts')
  const rows = JSON.parse(readFileSync(new URL('../public/spikes.json', import.meta.url), 'utf8')).rows as Record<string, number | null>[]
  assert.ok(rows.length > 400)
  for (const r of rows) {
    for (const k of ['value_ppb', 'baseline_ppb', 'ratio']) {
      const v = r[k]
      if (v === null) continue
      const { int, frac } = decimalParts(v)
      assert.equal(Number(int + frac), v, `${k} ${v}`)
      assert.equal(int + frac, String(v), `${k} ${v}`)
    }
  }
})
