// Run: npm test. The timeline's night links, its shareable ?at= URL, and the dot hover text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nightHref, spikeTip, withAt } from '../src/rainLinks.ts'
import { BANNED_WORDS } from '../src/i18n.ts'
import { parseSpikes } from '../src/spikes.ts'
import { dayFromParam, isoFromDay } from '../src/rain.ts'

const rows = parseSpikes(JSON.parse(readFileSync(new URL('../public/spikes.json', import.meta.url), 'utf8'))).rows

test('a night link skips the globe intro and keeps the id intact', () => {
  assert.equal(nightHref('/plume-witness/', '2024-03-29_45201_48_201_0057'), '/plume-witness/?night=2024-03-29_45201_48_201_0057&intro=0')
  const q = new URLSearchParams(nightHref('/', 'a&b=c').slice(2))
  assert.equal(q.get('night'), 'a&b=c')
  assert.equal(q.get('intro'), '0')
})

test('withAt sets, replaces and removes the date, and keeps the view', () => {
  assert.equal(withAt('?view=timeline', '2024-06-15'), '?view=timeline&at=2024-06-15')
  assert.equal(withAt('?view=timeline&at=2024-01-01', '2025-02-03'), '?view=timeline&at=2025-02-03')
  assert.equal(withAt('?view=timeline&at=2024-01-01', null), '?view=timeline')
  assert.equal(withAt('', null), '')
})

test('a written ?at= date reads back as the same day (the reload round trip)', () => {
  for (const day of [0, 59, 365, 730]) {
    const at = new URLSearchParams(withAt('?view=timeline', isoFromDay(day))).get('at')
    assert.equal(dayFromParam(at), day)
  }
})

test('hover text names monitor, compound, date, hour and the full status label, in the reader language', () => {
  const r = { ...rows[0], site: 'Galena Park', compound: 'benzene', date: '2024-06-29', hour_cst: 20, status: 'no_report_after_deadline' }
  assert.equal(spikeTip(r, 'en'), 'Galena Park · benzene · Jun 29, 2024, 20:00 CST · No matching report (a question)')
  const es = spikeTip(r, 'es')
  assert.match(es, /^Galena Park · benceno · 29 (de )?jun\.? (de )?2024, 20:00 CST · Sin reporte que coincida \(una pregunta\)$/)
})

test('no hover text on the published spikes carries a verdict word', () => {
  for (const row of rows) {
    for (const lang of ['en', 'es'] as const) {
      const tip = spikeTip(row, lang)
      for (const re of BANNED_WORDS) assert.ok(!re.test(tip), `${lang}: ${tip}`)
    }
  }
})
