// Run: npm test. Renders the landing and the site header's language switch through Vite's SSR loader (as
// embed-render.test.ts does), and reads the header's clamp() sizes from SiteHeader.css.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())
Object.assign(globalThis, { window: { location: { hash: '', search: '', origin: 'https://x.org', pathname: '/' }, addEventListener() {}, removeEventListener() {} } })

const setLang = async (l: 'en' | 'es') => (await server.ssrLoadModule('/src/i18n.ts')).setLang(l)
const landing = async () => {
  const mod = await server.ssrLoadModule('/src/AtlasLanding.tsx')
  return renderToStaticMarkup(createElement(mod.AtlasLanding, { leaving: false, onEnter() {}, onExit() {} }))
}
const langSwitch = async (props: Record<string, unknown> = {}) => {
  const mod = await server.ssrLoadModule('/src/LangSwitch.tsx')
  return renderToStaticMarkup(createElement(mod.LangSwitch, props))
}


test('the Spanish review note folds behind a button that controls it; English has neither', async () => {
  await setLang('es')
  const es = await langSwitch()
  const btn = /<button type="button" class="es-note-toggle" aria-expanded="false" aria-controls="([^"]+)"/.exec(es)
  assert.ok(btn, 'no fold button in Spanish')
  assert.match(es, new RegExp(`<p class="[^"]*es-note es-note-folded" id="${btn[1]}"`), 'the button must control the folded note')
  assert.ok(es.indexOf('es-note-toggle') < es.indexOf('role="group"'), 'the button comes before the switch, as on screen')
  assert.match(es, /Traducción sin revisar/)
  // The replay passes note={false}: its panel shows the note, so the header has no button either.
  assert.ok(!(await langSwitch({ note: false })).includes('es-note'))
  await setLang('en')
  assert.ok(!(await langSwitch()).includes('es-note'))
})

test('the landing has a skip link to its title, ahead of the brand link (A11Y-20)', async () => {
  await setLang('en')
  const html = await landing()
  const skip = html.indexOf('class="skip-link"')
  assert.ok(skip >= 0, 'no skip link on the landing')
  assert.ok(skip < html.indexOf('class="brand"'), 'the skip link must be the first stop, before the brand')
  assert.match(html, /class="skip-link" href="#atlas-title"/)
  assert.match(html, /<h1 id="atlas-title"/)
})

/** Evaluates a `clamp(Arem, [Brem +] Cvw, Drem)` font-size the way the browser does, in px. */
function clampPx(css: string, selector: string, vw: number, rootPx: number): number {
  const rule = new RegExp(`^${selector.replace('.', '\\.')} \\{[^}]*font-size: clamp\\(([\\d.]+)rem, (?:([\\d.]+)rem \\+ )?([\\d.]+)vw, ([\\d.]+)rem\\)`, 'm').exec(css)
  assert.ok(rule, `${selector} has no clamp(rem, rem + vw, rem) font-size`)
  const [min, base, slope, max] = rule.slice(1).map((n) => Number(n ?? 0))
  return Math.min(max * rootPx, Math.max(min * rootPx, base * rootPx + (slope * vw) / 100))
}

test('header nav and brand scale up on wide screens but keep their sizes up to 1024px (D02)', () => {
  const css = readFileSync(new URL('../src/SiteHeader.css', import.meta.url), 'utf8')
  // Up to 1024px nothing grows: the four Spanish links fit one row at 375px only at 12.8px, and at 1024px the replay's
  // nav shares a column with the night picker (at 14px it wrapped onto a third header line). Both measured.
  for (const vw of [320, 375, 768, 1024]) {
    assert.ok(Math.abs(clampPx(css, '.site-nav', vw, 16) - 12.8) < 0.01, `nav at ${vw}px`)
    assert.ok(Math.abs(clampPx(css, '.brand-row', vw, 16) - 12) < 0.01, `brand at ${vw}px`)
  }
  // 1280x720 laptops: the nav reaches body size; the uppercase brand 14px. index.css sets a 112.5% root at 1600px.
  assert.ok(clampPx(css, '.site-nav', 1280, 16) >= 16)
  assert.ok(clampPx(css, '.brand-row', 1280, 16) >= 14)
  assert.ok(clampPx(css, '.site-nav', 1600, 18) >= 18)
})
