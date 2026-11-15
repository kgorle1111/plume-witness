// Run: npm test. Embed URLs, iframe HTML and step lines, on the real demo night.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { embedUrl, fullUrl, iframeHtml, isEmbed, stepFromHash, stepLine, EMBED_STEPS } from '../src/embed.ts'
import type { PlumeEvent } from '../src/types.ts'
import { pageFromLocation } from '../src/routes.ts'
import { BANNED_WORDS, translate } from '../src/i18n.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent
const BANNED = /\b(illegal|violations?|unreported|caught|polluters?|proves?)\b/i

test('embed flag is exactly embed=1', () => {
  assert.equal(isEmbed('?night=a&embed=1'), true)
  assert.equal(isEmbed('?embed=0'), false)
  assert.equal(isEmbed(''), false)
})

test('embed and open-in-app URLs round-trip the night', () => {
  const e = embedUrl('https://x.org', '/plume-witness/', '?night=2024-06-21_45201_48_201_0069')
  assert.equal(e, 'https://x.org/plume-witness/?night=2024-06-21_45201_48_201_0069&embed=1')
  assert.equal(fullUrl('https://x.org', '/plume-witness/', new URL(e).search), 'https://x.org/plume-witness/?night=2024-06-21_45201_48_201_0069')
  // The demo night's embed must not open the atlas landing page.
  const demo = new URL(fullUrl('https://x.org', '/', '?embed=1'))
  assert.equal(demo.href, 'https://x.org/?intro=0')
  assert.equal(pageFromLocation(demo), 'replay')
})

test('iframe HTML escapes attributes, so a crafted URL cannot break out of src', () => {
  const html = iframeHtml('https://x.org/?a="><script>alert(1)</script>&embed=1', 'T "q"')
  assert.ok(!html.includes('<script>'))
  assert.match(html, /^<iframe src="https:\/\/x\.org\/\?a=&quot;&gt;&lt;script&gt;/)
  assert.equal((html.match(/<iframe/g) ?? []).length, 1)
})

test('every step has a line with real numbers and no banned wording', () => {
  assert.equal(stepFromHash('#check'), 'check')
  assert.equal(stepFromHash('#nonsense'), 'detect')
  for (const s of EMBED_STEPS) {
    const line = stepLine(ev, s.id)
    assert.ok(line.length > 30 && !BANNED.test(line), line)
  }
  assert.match(stepLine(ev, 'detect'), new RegExp(String(ev.detection.value)))
  assert.match(stepLine(ev, 'trace'), /cannot tell them apart/)
  assert.match(stepLine(ev, 'check'), /not a finding about any facility/)
})

test('the embed speaks the reader\'s language: Spanish step names and lines, numbers unchanged', () => {
  assert.deepEqual(EMBED_STEPS.map((s) => translate('es', s.label)), ['Detectar', 'Rastrear', 'Verificar'])
  const detect = stepLine(ev, 'detect', 'es')
  assert.match(detect, /registró/)
  assert.match(detect, new RegExp(String(ev.detection.value).replace('.', '\\.')))
  assert.match(detect, /benceno/)
  const trace = stepLine(ev, 'trace', 'es')
  assert.match(trace, /viento arriba/)
  assert.doesNotMatch(trace, /Wind came|listed facilit/)
  const check = stepLine(ev, 'check', 'es')
  assert.match(check, /^Registro estatal: Reportado\./)
  assert.match(check, /ninguna instalación/)
  for (const s of EMBED_STEPS) {
    for (const lang of ['en', 'es'] as const) {
      const line = stepLine(ev, s.id, lang)
      for (const re of BANNED_WORDS) assert.ok(!re.test(line), `${lang} ${s.id}: ${line}`)
      assert.ok(!/\{\w+\}/.test(line), `unfilled slot in ${lang} ${s.id}: ${line}`)
    }
  }
  // English stays as it was (the record's own compound text included).
  assert.equal(stepLine(ev, 'trace'), stepLine(ev, 'trace', 'en'))
  assert.match(stepLine(ev, 'check'), /^State record: Reported\. Report #\d+ lists Benzene in the corridor\. This is not a finding/)
})
