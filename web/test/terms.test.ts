// Run: npm test. The site's two term decisions (2026-11-15): one event is a "spike" (ES "pico") and its replay a
// "replay" (ES "recorrido"), never a "night", since spikes happen at any hour (the demo one at 09:00); and a check that
// stopped short reads "Can’t say: <cause>" wherever one spike's status is shown, on the real published spike files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { STATUS_TEXT, statusLabel } from '../src/format.ts'
import { STRINGS, translate } from '../src/i18n.ts'
import { parseSpikes, reasonInLabel, reasonKey, rowStatusLabel, type SpikeRow } from '../src/spikes.ts'
import { spikeTip } from '../src/rainLinks.ts'
import { statusWords } from '../share/stubs.ts'

const pub = new URL('../public/', import.meta.url)
const read = (p: string) => parseSpikes(JSON.parse(readFileSync(new URL(p, pub), 'utf8')))
const files = ['spikes.json', ...readdirSync(new URL('regions/', pub)).map((r) => `regions/${r}/spikes.json`)]
const rows: SpikeRow[] = files.flatMap((f) => read(f).rows)

// "midnight" is a time of day, not the event. Keys (night.*) and {night} slots are ids, never shown.
const NIGHT = { en: /\bnights?\b/i, es: /\bnoches?\b/i }
const shown = (v: string) => v.replace(/\{\w+\}/g, '')

test('no string on the site calls a spike a night, in either language', () => {
  for (const l of ['en', 'es'] as const) {
    for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(!NIGHT[l].test(shown(v)), `${l}:${k} says night: ${v}`)
  }
})

test('Spanish says "recorrido" for the replay, never the sports-replay "repetición"', () => {
  for (const [k, v] of Object.entries(STRINGS.es)) assert.ok(!/repetici[oó]n|repetid[oa]s?\b/i.test(v), `es:${k}: ${v}`)
  assert.equal(STRINGS.es['spikes.hReplay'], 'Recorrido')
  assert.equal(STRINGS.en['night.label'], 'Replay another spike')
})

test('the method brief on the site uses the same terms', () => {
  for (const [f, l] of [['brief.md', 'en'], ['brief.es.md', 'es']] as const) {
    const src = readFileSync(new URL(`../../docs/${f}`, import.meta.url), 'utf8')
    assert.ok(!NIGHT[l].test(src), `${f} says night`)
    assert.ok(!/search incomplete|búsqueda incompleta»|repetid[oa]/i.test(src), `${f} uses an old status or replay word`)
  }
})

test('a stopped-short check reads "Can’t say", and the "Can’t say: <cause>" form starts with that same label', () => {
  assert.equal(STATUS_TEXT.search_incomplete.en, 'Can’t say')
  for (const l of ['en', 'es'] as const) {
    const chip = statusLabel('search_incomplete', l)
    assert.ok(translate(l, 'status.cantSayWhy', { why: 'x' }).startsWith(`${chip}: `), l)
  }
  // The other labels the decision keeps.
  assert.equal(statusLabel('no_report_after_deadline', 'en'), 'No matching report (a question)')
  assert.equal(statusLabel('no_report_after_deadline', 'es'), 'Sin reporte que coincida (una pregunta)')
  assert.equal(statusWords('search_incomplete'), statusLabel('search_incomplete', 'en'))
})

test('every stopped-short spike in every published region names its cause in its label, in both languages', () => {
  const incomplete = rows.filter((r) => r.status === 'search_incomplete')
  assert.ok(incomplete.length > 300, `only ${incomplete.length} search_incomplete rows`)
  const seen = new Set<string>()
  for (const r of incomplete) {
    for (const l of ['en', 'es'] as const) {
      const label = rowStatusLabel(r, l)
      const prefix = `${statusLabel('search_incomplete', l)}: `
      assert.ok(label.startsWith(prefix) && label.length > prefix.length, `${l} ${r.date} ${r.site}: ${label}`)
      seen.add(label)
    }
    assert.ok(reasonInLabel(r), `${r.date} ${r.site} would repeat its reason`)
  }
  assert.ok(seen.has('Can’t say: wind too light'), [...seen].join(' | '))
  assert.ok(seen.has('No se puede decir: viento demasiado débil'), [...seen].join(' | '))
  // Each cause has its own label: two causes never collapse into one string.
  for (const l of ['en', 'es'] as const) {
    const byCode = new Map<string, string>()
    for (const r of incomplete) byCode.set(r.reason_code!, rowStatusLabel(r, l))
    assert.equal(new Set(byCode.values()).size, byCode.size, `${l}: ${[...byCode].join(' | ')}`)
  }
})

test('every "Can’t say: <cause>" label fits on one pill line in a timeline card', () => {
  // The timeline's fixed-height cards (SpikeRain.css --rn-card) reserve one pill line above 380px; a second line is
  // clipped. Measured in Chromium with the bundled font, 2026-11-15: 43 characters fit at every width from 380 to
  // 1920px, 47 ("No se puede decir: un reporte no se pudo ubicar") wrapped from 1024px up.
  const codes = ['calm_wind', 'report_not_placed', 'earlier_search_incomplete', 'day_search_incomplete', 'no_wind']
  for (const l of ['en', 'es'] as const) {
    for (const reason_code of codes) {
      const label = rowStatusLabel({ status: 'search_incomplete', reason_code }, l)
      assert.ok(label.length <= 43, `${l} ${reason_code}: ${label.length} characters: ${label}`)
    }
  }
})

test('the hover text on the timeline carries the same label as the spike log', () => {
  const calm = rows.find((r) => r.reason_code === 'calm_wind')!
  assert.ok(spikeTip(calm, 'en').endsWith(' · Can’t say: wind too light'), spikeTip(calm, 'en'))
  assert.ok(spikeTip(calm, 'es').endsWith(' · No se puede decir: viento demasiado débil'), spikeTip(calm, 'es'))
})

test('a row without a known cause, and every other status, keep the plain label', () => {
  const old = { status: 'search_incomplete', reason: 'A report filed that day could not be placed on the map, so absence cannot be claimed.' }
  assert.equal(reasonKey(old), 'spikes.reason.check')
  assert.equal(rowStatusLabel(old, 'en'), 'Can’t say')
  assert.equal(reasonInLabel(old), false, 'the "see the Check step" line still shows')
  assert.equal(rowStatusLabel({ status: 'search_incomplete', reason_code: 'something_new' }, 'es'), 'No se puede decir')
  // A code only explains a stopped-short check; on any other status it is ignored.
  assert.equal(rowStatusLabel({ status: 'no_report_after_deadline', reason_code: 'calm_wind' }, 'en'), 'No matching report (a question)')
  for (const r of rows.filter((x) => x.status !== 'search_incomplete')) assert.equal(rowStatusLabel(r, 'en'), statusLabel(r.status, 'en'))
})
