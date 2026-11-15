import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BANNED_WORDS } from '../src/i18n.ts'
import { STATUS_FILL, STATUS_TEXT, statusLabel } from '../src/format.ts'

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? assert.fail(`${name} missing in index.css`)

test('the contrast function is right (black on white is 21:1)', () => {
  assert.equal(Math.round(ratio('#000000', '#ffffff')), 21)
  assert.ok(ratio('#777777', '#ffffff') < 4.5)
})

test('every status mark reaches 3:1 on white', () => {
  for (const [s, hex] of Object.entries(STATUS_FILL)) assert.ok(ratio(hex, '#ffffff') >= 3, `${s} ${hex} is ${ratio(hex, '#ffffff').toFixed(2)}:1`)
})

test('the open-question amber and the pending slate are AA as text, on white and on their chip tint', () => {
  for (const [fill, fg, bg] of [['no_report_after_deadline', '--q-fg', '--q-bg'], ['not_yet_reported', '--pending-fg', '--pending-bg']]) {
    assert.equal(token(fg).toLowerCase(), STATUS_FILL[fill].toLowerCase(), `${fg} drifted from STATUS_FILL.${fill}`)
    assert.ok(ratio(token(fg), '#ffffff') >= 4.5, `${fg} on white ${ratio(token(fg), '#ffffff').toFixed(2)}`)
    assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg} ${ratio(token(fg), token(bg)).toFixed(2)}`)
  }
})

test('no status uses the monitor-spike red, and no two statuses share a colour or an icon', () => {
  const red = token('--trigger').toLowerCase()
  const fills = Object.values(STATUS_FILL).map((h) => h.toLowerCase())
  assert.ok(!fills.includes(red))
  assert.equal(new Set(fills).size, fills.length)
  const icons = Object.values(STATUS_TEXT).map((v) => v.icon)
  assert.equal(new Set(icons).size, icons.length)
  for (const f of ['index.css', 'App.css', 'SpikeLog.css']) {
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    for (const line of text.split('\n').filter((l) => /status-[a-z_]+\s*\{/.test(l))) assert.ok(!line.toLowerCase().includes(red) && !/#(8b1a1a|b42318)/i.test(line), `${f}: ${line}`)
  }
})

test('open-question labels: short chip, full label, no banned word, and the failing case fails', () => {
  assert.equal(STATUS_TEXT.no_report_after_deadline.en, 'No matching report')
  assert.equal(statusLabel('no_report_after_deadline', 'en'), 'No matching report (a question)')
  assert.equal(statusLabel('no_report_after_deadline', 'es'), 'Sin reporte que coincida (una pregunta)')
  assert.equal(statusLabel('reported', 'en'), 'Reported')
  for (const v of Object.values(STATUS_TEXT)) {
    for (const text of [v.en, v.es, v.full?.en ?? '', v.full?.es ?? '']) for (const re of BANNED_WORDS) assert.ok(!re.test(text), `${text} hits ${re}`)
  }
  assert.ok(BANNED_WORDS.some((re) => re.test('No report after the deadline, unreported')))
})
