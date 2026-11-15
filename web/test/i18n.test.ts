import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BANNED_WORDS, STRINGS, dateLabel, fmt, monthShort, monthYearLabel, translate } from '../src/i18n.ts'
import { monthSummary } from '../src/rain.ts'

const keys = (l: 'en' | 'es') => Object.keys(STRINGS[l]).sort()
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every key exists in both languages, and none is blank', () => {
  assert.deepEqual(keys('es'), keys('en'))
  for (const l of ['en', 'es'] as const) {
    for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(v.trim().length > 0, `${l}:${k} is blank`)
  }
})

test('a Spanish string fills the same {slots} as its English one', () => {
  for (const k of Object.keys(STRINGS.en) as (keyof typeof STRINGS.en)[]) {
    assert.deepEqual(slots(STRINGS.es[k]), slots(STRINGS.en[k]), `slots differ for ${k}`)
  }
})

test('no banned verdict word in either language', () => {
  for (const l of ['en', 'es'] as const) {
    for (const [k, v] of Object.entries(STRINGS[l])) {
      for (const re of BANNED_WORDS) assert.ok(!re.test(v), `${l}:${k} contains a banned word (${re}): ${v}`)
    }
  }
})

test('the banned-word check can fail', () => {
  for (const bad of ['This is illegal', 'a violation', 'unreported', 'caught', 'polluter', 'it proves', 'es ilegal', 'una violación', 'infracción', 'no reportado', 'contaminador', 'lo demuestra', 'lo comprueba']) {
    assert.ok(BANNED_WORDS.some((re) => re.test(bad)), `${bad} should be flagged`)
  }
})

test('fmt leaves an unfilled slot visible', () => {
  assert.equal(fmt('{a} of {b}', { a: 1 }), '1 of {b}')
  assert.equal(translate('es', 'nav.next', { step: 'Verificar' }), 'Siguiente: Verificar')
})

test('dates use the reader locale and never shift a day', () => {
  assert.equal(dateLabel('2024-06-06', 'en'), 'Jun 6, 2024')
  assert.match(dateLabel('2024-06-06', 'es'), /^6 (de )?jun\.? (de )?2024$/)
  assert.equal(monthYearLabel(0, 'en'), 'January 2024')
  assert.equal(monthYearLabel(13, 'es'), 'febrero de 2025')
  assert.equal(monthShort(0, 'es'), 'ene')
})

test('month summary is written in the chosen language, and English is unchanged', () => {
  const row = (status: string, site_id: string) => ({ status, site_id })
  const spikes = [{ month: 0, row: row('reported', 'a') }, { month: 0, row: row('reported', 'b') }] as never
  assert.equal(monthSummary(spikes, 0), 'January 2024: 2 spikes at 2 monitors. 2 reported.')
  assert.equal(monthSummary(spikes, 0, 'es'), 'enero de 2024: 2 picos en 2 monitores. 2 reportado.')
  assert.equal(monthSummary(spikes, 5, 'es'), 'junio de 2024: sin picos.')
})

test('status labels carry no banned verdict word in either language', async () => {
  const { STATUS_TEXT } = await import('../src/format.ts')
  for (const [k, v] of Object.entries(STATUS_TEXT)) {
    for (const text of [v.en, v.es]) {
      for (const re of BANNED_WORDS) assert.ok(!re.test(text), `${k} contains a banned word (${re}): ${text}`)
    }
  }
})

test('typography: curly quotes and apostrophes, no straight ones; Spanish percent signs take no space', () => {
  for (const l of ['en', 'es'] as const) {
    for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(!/['"]/.test(v), `${l}:${k} has a straight quote: ${v}`)
  }
  for (const [k, v] of Object.entries(STRINGS.es)) assert.ok(!/\d\s%/.test(v), `es:${k} spaces its percent sign: ${v}`)
})

test('Spanish names the place in Spanish', () => {
  for (const [k, v] of Object.entries(STRINGS.es)) assert.ok(!/Ship Channel/.test(v), `es:${k} says Ship Channel: ${v}`)
})

test('one state record, one label, on the replay, the map and the facility page', () => {
  for (const l of ['en', 'es'] as const) {
    const s = STRINGS[l]
    assert.equal(s['trc.filed'], s['fx.record'], l)
    assert.equal(s['map.filedReport'], s['fx.record'], l)
  }
})

test('the brief has one name in each language: the nav says what the page kicker says (S174)', () => {
  for (const l of ['en', 'es'] as const) assert.equal(STRINGS[l]['app.linkBrief'], STRINGS[l]['brief.kicker'], l)
})

test('agency and system acronyms are spelled out where the spike log and the landing first show them', () => {
  const full = {
    en: [/Texas Commission on Environmental Quality \(TCEQ\)/, /Environmental Protection Agency \(EPA\)/],
    es: [/Comisión de Calidad Ambiental de Texas \(TCEQ\)/, /Agencia de Protección Ambiental de EE\. UU\. \(EPA\)/],
  }
  for (const l of ['en', 'es'] as const) {
    // The footer is the only place the landing names an agency.
    for (const re of full[l]) assert.match(STRINGS[l]['foot.license'], re, l)
    assert.match(STRINGS[l]['spikes.summary'], full[l][0], l)
    assert.match(STRINGS[l]['spikes.source'], /\(AutoGC\)/, l)
    assert.match(STRINGS[l]['spikes.source'], /STEERS[ ,(]+(State of Texas|el sistema)/, l)
  }
})

test('Los Angeles copy: same {slots}, no banned word, PST for CST, and Texas untouched', async () => {
  const { REGION_OVERRIDES, setRegionCopy, rawString } = await import('../src/i18n.ts')
  for (const [region, byLang] of Object.entries(REGION_OVERRIDES)) {
    for (const l of ['en', 'es'] as const) {
      for (const [k, v] of Object.entries(byLang[l])) {
        assert.deepEqual(slots(v!), slots(STRINGS[l][k as keyof typeof STRINGS.en]), `${region}:${l}:${k} slots`)
        for (const re of BANNED_WORDS) assert.ok(!re.test(v!), `${region}:${l}:${k} contains a banned word (${re})`)
        assert.ok(!/TCEQ|STEERS|Texas/.test(v!), `${region}:${l}:${k} names Texas`)
      }
    }
  }
  try {
    setRegionCopy('los_angeles', 'PST')
    assert.equal(translate('en', 'spark.colHour'), 'Hour (PST)')
    assert.match(rawString('en', 'spikes.source'), /South Coast AQMD/)
    setRegionCopy('houston', 'CST')
    assert.equal(translate('en', 'spark.colHour'), 'Hour (CST)')
    assert.equal(rawString('en', 'spikes.source'), STRINGS.en['spikes.source'])
  } finally {
    setRegionCopy(null)
  }
})
