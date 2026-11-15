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

test('demo night: 09:38-10:42 CDT is drawn at 08:38-09:42 CST, solid, with the arrival marker', () => {
  const b = reportBand(ev.record_check, ev.date_local)!
  assert.ok(b.matched)
  assert.ok(Math.abs(b.from - (8 + 38 / 60)) < 1e-9 && Math.abs(b.to - (9 + 42 / 60)) < 1e-9)
  // Zero-padded 24 h clock, as every other time on the page ("09:00 CST").
  assert.equal(b.localText, '09:38 to 10:42 CDT')
  assert.equal(b.cstText, '08:38 to 09:42 CST')
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
  assert.equal(b.localText, 'Jun 20 20:00 to 08:15 CDT')
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
  assert.equal(b.localText, '09:38 a 10:42 CDT')
  assert.equal(b.cstText, '08:38 a 09:42 CST')
  assert.equal(arrivalTick(ev.record_check, ev.date_local, 'es')!.text, 'el aire podría llegar ~10:36 CDT (viento 6.8 mph, 10.6 km)')
})

test('the time note reads in Spanish, and an unknown note stays as published', () => {
  // English is rebuilt from the key too, so TCEQ and AutoGC are spelled out once.
  assert.match(timeNote(ev.time_note, 'en')!, /^Monitor hours are CST as TCEQ \(the Texas Commission on Environmental Quality\).*\(CDT, CST\+1\).*\(AutoGC\)/)
  assert.match(timeNote(ev.time_note, 'es')!, /^Las horas del monitor están en CST.*\(CDT, CST\+1\)/)
  assert.equal(timeNote('Something else.', 'es'), null)
  assert.equal(timeNote('Something else.', 'en'), 'Something else.')
})

test('with no company report on the night, the time note drops the report-clock clause', () => {
  for (const lang of ['en', 'es'] as const) {
    const text = timeNote(ev.time_note, lang, false)!
    assert.doesNotMatch(text, /CDT|company|empresa/, text)
    assert.match(text, /AutoGC/)
  }
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
  const regions = readdirSync(new URL('regions/', pub)).flatMap((r) => nights(`regions/${r}/nights/`))
  assert.ok(regions.some((f) => f.startsWith('regions/midland_odessa/')), 'multi-county region nights are covered')
  for (const f of ['event.json', ...nights('nights/'), ...regions]) {
    const scope = (JSON.parse(readFileSync(new URL(f, pub), 'utf8')) as PlumeEvent).record_check.search_scope
    const es = searchScopeText(scope, 'es')
    assert.equal(es.lang, 'es', `${f} stayed English: ${scope}`)
    assert.doesNotMatch(es.text, /\b(Searched|search|found|reports?|Wind|County)\b/, `${f}: English left in ${es.text}`)
    for (const re of BANNED_WORDS) assert.ok(!re.test(es.text), `banned ${re}: ${es.text}`)
    const en = searchScopeText(scope, 'en')
    assert.equal(en.lang, 'en')
    assert.doesNotMatch(en.text, /\d{2}\/\d{2}\/\d{4}/, `${f}: MM/DD/YYYY left in ${en.text}`)
  }
  const s = 'Searched every STEERS emissions event starting 07/09/2025 in Harris County (1 found; search complete). '
    + 'Also searched reports that started in the 30 days before and were still running (0 open that day; earlier search incomplete). '
    + 'Wind too light to trace (1.1 mph): no corridor drawn, so the search is incomplete.'
  assert.deepEqual(searchScopeText(s, 'es'), {
    lang: 'es',
    text: 'Se revisaron todos los eventos de emisiones de STEERS (el sistema estatal de reportes de eventos de emisiones) que empezaron el 9 jul 2025 en el condado de Harris (1 encontrado; búsqueda completa). '
      + 'También se revisaron los reportes que empezaron en los 30 días anteriores y seguían en curso (0 abiertos ese día; búsqueda anterior incompleta). '
      + 'Viento demasiado débil para rastrear (1.1 mph): no se trazó un corredor, así que la búsqueda está incompleta.',
  })
  assert.equal(searchScopeText(s, 'en').text.split('. ')[0],
    'Searched every emissions event in STEERS (the state’s emissions-event reporting system) starting Jul 9, 2025 in Harris County (1 found; search complete)')
  // pipeline/build.py county_en for a region searched in several counties.
  const two = 'Searched every STEERS emissions event starting 10/03/2024 in Ector and Midland counties (0 found; search complete).'
  assert.match(searchScopeText(two, 'es').text, /que empezaron el 3 oct 2024 en los condados de Ector y Midland \(0 encontrados; búsqueda completa\)\.$/)
  assert.match(searchScopeText(two, 'en').text, / starting Oct 3, 2024 in Ector and Midland counties \(0 found; search complete\)\.$/)
  const three = 'Searched every STEERS emissions event starting 10/03/2024 in Bexar, Comal and Wilson counties (1 found; search incomplete).'
  assert.match(searchScopeText(three, 'es').text, / en los condados de Bexar, Comal y Wilson \(1 encontrado; búsqueda incompleta\)\.$/)
  assert.equal(searchScopeText(three.replace(' counties', ' County'), 'es').lang, 'en')
  const reworded = `${s} Some new sentence from the pipeline.`
  assert.deepEqual(searchScopeText(reworded, 'en'), { text: reworded, lang: 'en' })
  assert.deepEqual(searchScopeText(reworded, 'es'), { text: reworded, lang: 'en' })
  assert.deepEqual(searchScopeText('Searched every STEERS emissions event starting 2025-07-09 in Harris County (1 found; search complete).', 'es').lang, 'en')
})

test('check notes: a filing date marks the record as filed; calm wind and unknown notes read honestly', async () => {
  const { checkNoteText, calmMph } = await import('../src/reportWindow.ts')
  const notice = checkNoteText('initial notice filed 2024-05-14T13:53 local, 3029.1 h after the reported discovery 2024-01-09T08:45', 'en')!
  assert.deepEqual(notice, { text: 'Notice filed May 14, 2024 at 13:53 local, 3029.1 h after the reported discovery.', lang: 'en', filed: true })
  const fin = checkNoteText('final report dated 2024-05-21, 133 days after the event ended', 'es')!
  assert.ok(fin.filed && fin.lang === 'es' && fin.text.startsWith('Reporte final con fecha') && fin.text.includes('133 días'), fin.text)
  assert.equal(checkNoteText('final report dated 2024-05-21, 1 day after the event ended', 'en')!.text, 'Final report dated May 21, 2024, 1 day after the event ended.')
  assert.deepEqual(checkNoteText('wind too light to trace (0.7 mph)', 'es'), { text: 'Viento demasiado débil para rastrear (0.7 mph).', lang: 'es', filed: false })
  // A matched report with only its initial notice on file (pipeline/build.py final_check): no filing date, so not "late".
  assert.deepEqual(checkNoteText('final report pending: the cached report is type INITIAL, with no final report date', 'es'),
    { text: 'Reporte final pendiente: el reporte en el registro es de tipo INITIAL, sin fecha de reporte final.', lang: 'es', filed: false })
  assert.deepEqual(checkNoteText('something new', 'es'), { text: 'something new', lang: 'en', filed: false })
  assert.equal(checkNoteText('', 'en'), null)
  assert.equal(calmMph(base({ checks: [{ at: 'T+24h', status: 'search_incomplete', note: 'wind too light to trace (0.7 mph)' } as never] })), 0.7)
  assert.equal(calmMph(ev.record_check), null)
})

test('every check note in every published night reads in Spanish', async () => {
  const { readdirSync } = await import('node:fs')
  const { checkNoteText } = await import('../src/reportWindow.ts')
  const pub = new URL('../public/', import.meta.url)
  const nights = (dir: string) => readdirSync(new URL(dir, pub)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => `${dir}${f}`)
  for (const f of ['event.json', ...nights('nights/'), ...nights('regions/beaumont/nights/')]) {
    for (const c of (JSON.parse(readFileSync(new URL(f, pub), 'utf8')) as { record_check: { checks: { note?: string }[] } }).record_check.checks) {
      const n = checkNoteText(c.note, 'es')
      if (n) assert.equal(n.lang, 'es', `${f}: ${c.note}`)
    }
  }
})

test('calm-wind and unplaced day-report resolutions read in Spanish', () => {
  assert.deepEqual(resolutionText('not traced: wind too light to trace (0.7 mph)', 'es'),
    { text: 'sin rastrear: viento demasiado débil para rastrear (0.7 mph)', lang: 'es' })
  assert.equal(resolutionText('unresolved: facility not located', 'es').lang, 'es')
  assert.deepEqual(resolutionText('unresolved: ambiguous, 2 ECHO sites at the address', 'es'),
    { text: 'sin resolver: ambiguo, 2 sitios de ECHO en la dirección', lang: 'es' })
})

test('search scope: the NRC second-source sentence (pipeline/nrc.py SCOPE_SENTENCE) reads in Spanish', async () => {
  const { searchScopeText } = await import('../src/reportWindow.ts')
  const s = 'Searched every STEERS emissions event starting 07/09/2025 in Harris County (1 found; search complete). '
    + 'No matching report found in a complete search. '
    + 'Also searched National Response Center (NRC) reports for the county: one in the upwind corridor, in the match window, lists the compound.'
  const es = searchScopeText(s, 'es')
  assert.equal(es.lang, 'es', es.text)
  assert.ok(es.text.endsWith('uno del corredor viento arriba, en la ventana de coincidencia, menciona el compuesto.'), es.text)
})
