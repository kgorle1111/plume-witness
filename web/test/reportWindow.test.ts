import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { arrivalTick, daysAfterEvent, localOffsetH, localToCstMinutes, reportBand, resolutionText, timeNote } from '../src/reportWindow.ts'
import type { PlumeEvent, RecordCheck } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent

test('CDT is CST+1 and CST is CST+0; an unknown zone draws nothing', () => {
  assert.equal(localOffsetH('local (CDT)'), 1)
  assert.equal(localOffsetH('local (CST)'), 0)
  assert.equal(localOffsetH('local'), null)
  assert.equal(localOffsetH(undefined), null)
  assert.equal(localToCstMinutes('2024-06-21T09:38', '2024-06-21', 1), 8 * 60 + 38)
  assert.equal(localToCstMinutes('2024-01-09T09:38', '2024-01-09', 0), 9 * 60 + 38)
  assert.equal(localToCstMinutes('2024-06-20T23:30', '2024-06-21', 1), -(60 + 30))
  assert.equal(localToCstMinutes('2024-06-21T00:30', '2024-06-21', 1), -30)
})

test('demo night: 9:38-10:42 CDT is drawn at 8:38-9:42 CST, solid, with the arrival marker', () => {
  const b = reportBand(ev.record_check, ev.date_local)!
  assert.ok(b.matched)
  assert.ok(Math.abs(b.from - (8 + 38 / 60)) < 1e-9 && Math.abs(b.to - (9 + 42 / 60)) < 1e-9)
  assert.match(b.localText, /^9:38 to 10:42 CDT$/)
  assert.match(b.cstText, /^8:38 to 9:42 CST$/)
  const t = arrivalTick(ev.record_check, ev.date_local)!
  assert.ok(Math.abs(t.hourCst - (9 + 36 / 60)) < 1e-9)
  assert.equal(t.text, 'air could arrive ~10:36 CDT (wind 6.8 mph, 10.6 km)')
})

const base = (over: Partial<RecordCheck>): RecordCheck => ({ ...ev.record_check, ...over })

test('mismatch is flagged not matched; no-report and incomplete nights draw nothing', () => {
  assert.equal(reportBand(base({ status: 'reported_mismatch' }), ev.date_local)!.matched, false)
  for (const status of ['no_report_after_deadline', 'search_incomplete'] as const)
    assert.equal(reportBand(base({ status, reported: null }), ev.date_local), null)
})

test('a report that began the day before is clipped to the chart and says so; one outside the day draws nothing', () => {
  const r = { ...ev.record_check.reported!, start_local: '2024-06-20T20:00', end_local: '2024-06-21T08:15' }
  const b = reportBand(base({ reported: r }), ev.date_local)!
  assert.equal(b.from, 0)
  assert.ok(b.startsBefore && !b.endsAfter)
  assert.equal(b.cstText, null)
  assert.equal(b.localText, 'Jun 20 20:00 to 8:15 CDT')
  const gone = { ...r, start_local: '2024-06-20T01:00', end_local: '2024-06-20T03:00' }
  assert.equal(reportBand(base({ reported: gone }), ev.date_local), null)
})

test('arrival marker needs every travel field', () => {
  const r = { ...ev.record_check.reported! }
  delete r.travel_speed_mph
  assert.equal(arrivalTick(base({ reported: r }), ev.date_local), null)
})

test('revision lands 173 days after the demo event and is carried in the event file', () => {
  const rev = ev.record_check.reported!.revisions!
  assert.equal(rev.length, 1)
  assert.equal(daysAfterEvent(ev.record_check.reported!.start_local!, rev[0].date), 173)
})

test('Spanish: the report window and arrival marker carry no English words', () => {
  const b = reportBand(ev.record_check, ev.date_local, 'es')!
  assert.equal(b.localText, '9:38 a 10:42 CDT')
  assert.equal(b.cstText, '8:38 a 9:42 CST')
  assert.equal(arrivalTick(ev.record_check, ev.date_local, 'es')!.text, 'el aire podría llegar ~10:36 CDT (viento 6.8 mph, 10.6 km)')
})

test('the time note reads in Spanish, and an unknown note stays as published', () => {
  assert.equal(timeNote(ev.time_note, 'en'), ev.time_note)
  assert.match(timeNote(ev.time_note, 'es')!, /^Las horas del monitor están en CST.*\(CDT, CST\+1\)/)
  assert.equal(timeNote('Something else.', 'es'), null)
})

test('report resolutions from build.py read in Spanish; unknown forms stay English', () => {
  assert.deepEqual(resolutionText('in the upwind corridor', 'es'), { text: 'en el corredor viento arriba', lang: 'es' })
  assert.deepEqual(resolutionText('outside the corridor (22.9 km, 41° off the wind)', 'es'),
    { text: 'fuera del corredor (22.9 km, 41° fuera de la dirección del viento)', lang: 'es' })
  assert.deepEqual(resolutionText('unresolved: no location', 'es'), { text: 'unresolved: no location', lang: 'en' })
})

test('search scope: every published form reads in Spanish; an unknown sentence keeps the paragraph English', async () => {
  const { readdirSync } = await import('node:fs')
  const { searchScopeText } = await import('../src/reportWindow.ts')
  const { BANNED_WORDS } = await import('../src/i18n.ts')
  const pub = new URL('../public/', import.meta.url)
  const nights = (dir: string) => readdirSync(new URL(dir, pub)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => `${dir}${f}`)
  for (const f of ['event.json', ...nights('nights/'), ...nights('regions/beaumont/nights/')]) {
    const scope = (JSON.parse(readFileSync(new URL(f, pub), 'utf8')) as PlumeEvent).record_check.search_scope
    const es = searchScopeText(scope, 'es')
    assert.equal(es.lang, 'es', `${f} stayed English: ${scope}`)
    assert.doesNotMatch(es.text, /\b(Searched|search|found|reports?|Wind|County)\b/, `${f}: English left in ${es.text}`)
    for (const re of BANNED_WORDS) assert.ok(!re.test(es.text), `banned ${re}: ${es.text}`)
    assert.deepEqual(searchScopeText(scope, 'en'), { text: scope, lang: 'en' })
  }
  const s = 'Searched every STEERS emissions event starting 07/09/2025 in Harris County (1 found; search complete). '
    + 'Also searched reports that started in the 30 days before and were still running (0 open that day; earlier search incomplete). '
    + 'Wind too light to trace (1.1 mph): no corridor drawn, so the search is incomplete.'
  assert.deepEqual(searchScopeText(s, 'es'), {
    lang: 'es',
    text: 'Se revisaron todos los eventos de emisiones de STEERS que empezaron el 9 jul 2025 en el condado de Harris (1 encontrado; búsqueda completa). '
      + 'También se revisaron los reportes que empezaron en los 30 días anteriores y seguían en curso (0 abiertos ese día; búsqueda anterior incompleta). '
      + 'Viento demasiado débil para rastrear (1.1 mph): no se trazó un corredor, así que la búsqueda está incompleta.',
  })
  const reworded = `${s} Some new sentence from the pipeline.`
  assert.deepEqual(searchScopeText(reworded, 'es'), { text: reworded, lang: 'en' })
  assert.deepEqual(searchScopeText('Searched every STEERS emissions event starting 2025-07-09 in Harris County (1 found; search complete).', 'es').lang, 'en')
})
