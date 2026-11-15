// Run: npm test. The landing button's fill, the 1600px+ text floor on the page views, the loading text in each page's
// column, and the record-search line in the limits, checked against the pipeline constants it describes.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { STRINGS } from '../src/i18n.ts'

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const landingCss = read('../src/AtlasLanding.css')
const index = read('../src/index.css')

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** The first `{ ... }` body after `head` (no nested blocks inside). */
const block = (css: string, head: string) => {
  const i = css.indexOf(head)
  assert.ok(i >= 0, `no ${head}`)
  return css.slice(i + head.length, css.indexOf('}', i))
}

test('the landing button is a solid ink fill, 56px tall, with AA text and a fill that stands off the page', () => {
  const pinned = block(landingCss, '.atlas-landing {')
  const tok = (n: string) => new RegExp(`${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(pinned)?.[1] ?? ''
  const btn = block(landingCss, '.atlas-enter {')
  assert.match(btn, /background:\s*var\(--ink\)/)
  assert.match(btn, /color:\s*#fff;/)
  assert.ok(Number(/min-height:\s*(\d+)px/.exec(btn)?.[1]) >= 56, 'button under 56px')
  const ink = tok('--ink')
  assert.ok(ratio('#ffffff', ink) >= 4.5, `text on the fill is ${ratio('#ffffff', ink).toFixed(2)}:1`)
  // The gradient's lightest and darkest stops (the fill used to be 1.26-1.32:1 against them).
  for (const bg of ['#b4d9cb', '#deede7', tok('--paper')]) assert.ok(ratio(ink, bg) >= 3, `fill vs ${bg} is under 3:1`)
})

test('from 1600px the page views raise their small text to 16px, and only there', () => {
  const at = index.indexOf('@media (min-width: 1600px) {\n  .app :is(')
  assert.ok(at >= 0, 'no 1600px text floor in index.css')
  const rule = index.slice(at, index.indexOf('}\n}', at))
  assert.match(rule, /\{ font-size: 16px; $/)
  for (const sel of ['.rose-table table', '.rose-caveat', '.sl-kicker', '.sl-table thead th', '.sl-field label', '.sl-foot',
    '.sl-cal-legend', '.sl-cal-name', '.chip', '.cv-kicker', '.cv-id', '.cv-table', '.cv-credit', '.br-kicker', '.br-print small']) {
    assert.ok(rule.includes(sel), `${sel} is not in the 1600px floor`)
  }
})

test('the record-search line in the limits states the pipeline’s own look-back, in both languages', () => {
  const build = read('../../pipeline/build.py')
  const days = /^LOOKBACK_DAYS = (\d+)/m.exec(build)?.[1]
  assert.equal(days, '30', 'pipeline/build.py LOOKBACK_DAYS changed: update cannot.searchScope')
  assert.match(build, /^MATCH_WINDOW_H = \(-6, 2\)/m, 'the match window changed: update cannot.searchScope')
  assert.match(STRINGS.en['cannot.searchScope'], new RegExp(`the ${days} days before`))
  assert.match(STRINGS.es['cannot.searchScope'], new RegExp(`los ${days} días anteriores`))
  for (const l of ['en', 'es'] as const) assert.match(STRINGS[l]['cannot.searchScope'], /National Response Center/)
})

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())

test('a page whose code is still loading shows its wait in that page’s column', async () => {
  const column = { spikes: 'wide', coverage: 'wide', timeline: 'full', brief: 'read', facilities: 'read', 'facility&id=1': 'read' }
  for (const [view, col] of Object.entries(column)) {
    Object.assign(globalThis, { window: { location: { hash: '', search: `?view=${view}`, origin: 'https://x.org', pathname: '/' }, addEventListener() {}, removeEventListener() {} } })
    const Site = (await server.ssrLoadModule('/src/Site.tsx')).default
    const html = renderToStaticMarkup(createElement(Site))
    assert.match(html, new RegExp(`<main class="state-msg state-col-${col}" aria-busy="true">`), `${view}: ${html.slice(0, 300)}`)
  }
  for (const col of ['wide', 'read', 'full']) assert.ok(index.includes(`.state-msg.state-col-${col} { max-width: var(--page-${col}); }`))
})
