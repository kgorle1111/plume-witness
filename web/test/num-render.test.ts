// Run: npm test. Renders Unit.tsx Num through Vite's SSR loader: a table number keeps its digits exactly, and only an
// invisible pad (a data attribute drawn by CSS) carries the decimals it lacks, so text and copy are unchanged.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { fileURLToPath } from 'node:url'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())
const { Num } = await server.ssrLoadModule('/src/Unit.tsx')
const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Num, props))
const text = (h: string) => h.replace(/<[^>]+>/g, '')
const pad = (h: string) => /data-pad="([^"]*)"/.exec(h)?.[1] ?? null

test('a value with fewer decimals than its column keeps its digits; the pad holds only the missing ones', () => {
  const h = html({ value: 16.4, frac: 2 })
  assert.equal(text(h), '16.4')
  assert.equal(pad(h), '0')
  assert.equal(text(html({ value: 10.17, frac: 2 })), '10.17')
  assert.equal(pad(html({ value: 10.17, frac: 2 })), null) // already as long as the column: no pad
  assert.equal(text(html({ value: 0.225, frac: 3 })), '0.225')
  assert.equal(pad(html({ value: 0.07, frac: 3 })), '0')
})

test('a whole number in a decimal column pads the point and the decimals', () => {
  const h = html({ value: 400, frac: 2 })
  assert.equal(text(h), '400')
  assert.equal(pad(h), '.00')
})

test('a column with no decimals and no suffix is just the number', () => {
  assert.equal(html({ value: 12, frac: 0 }), '<span class="dnum">12</span>')
})

test('the pad sits before the suffix, and a missing value is a dash in the whole-number place', () => {
  assert.equal(text(html({ value: 153.6, frac: 1, suffix: '×' })), '153.6×')
  const whole = html({ value: 12, frac: 1, suffix: '×' })
  assert.equal(text(whole), '12×')
  assert.match(whole, /12<span class="dnum-pad" data-pad="\.0"><\/span>×/)
  const dash = html({ value: null, frac: 1, suffix: '×' })
  assert.equal(text(dash), '—')
  assert.equal(pad(dash), '.0×')
})

test('pounds keep their decimals and gain only thousands commas', () => {
  assert.equal(text(html({ value: 8469.743, frac: 3, suffix: ' lb', group: true })), '8,469.743 lb')
  assert.equal(pad(html({ value: 8469, frac: 3, suffix: ' lb', group: true })), '.000')
})
