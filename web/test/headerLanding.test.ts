// Run: npm test. Renders the landing and the site header's language switch through Vite's SSR loader (as
// embed-render.test.ts does), and reads the header's clamp() sizes from SiteHeader.css.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { pageFromLocation } from '../src/routes.ts'

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


test('the language switch carries no translation-status note in either language', async () => {
  for (const l of ['es', 'en'] as const) {
    await setLang(l)
    const html = await langSwitch()
    assert.ok(!html.includes('es-note'), `${l}: a review note is back in the switch`)
    assert.ok(!/revis/i.test(html), `${l}: the switch mentions review`)
  }
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
  const rule = new RegExp(`^\\.site-head:not\\(\\.top\\) ${selector.replace('.', '\\.')} \\{[^}]*font-size: clamp\\(([\\d.]+)rem, (?:([\\d.]+)rem \\+ )?([\\d.]+)vw, ([\\d.]+)rem\\)`, 'm').exec(css)
  assert.ok(rule, `${selector} has no clamp(rem, rem + vw, rem) font-size`)
  const [min, base, slope, max] = rule.slice(1).map((n) => Number(n ?? 0))
  return Math.min(max * rootPx, Math.max(min * rootPx, base * rootPx + (slope * vw) / 100))
}

/** A plain `font-size: Nrem` on a top-level rule, in rem. */
function remSize(css: string, selector: string): number {
  const m = new RegExp(`^\\${selector} \\{[^}]*font-size: ([\\d.]+)rem;`, 'm').exec(css)
  assert.ok(m, `${selector} has no rem font-size`)
  return Number(m[1])
}

test('header nav and brand are at least 14px at every width, and 16px from 1600px (D02, R1b)', () => {
  const css = readFileSync(new URL('../src/SiteHeader.css', import.meta.url), 'utf8')
  // index.css sets a 112.5% (18px) root from 1600px.
  const root = (vw: number) => (vw >= 1600 ? 18 : 16)
  for (const vw of [320, 375, 768, 1024, 1280, 1600, 1920]) {
    const min = vw >= 1600 ? 16 : 14
    assert.ok(clampPx(css, '.site-nav', vw, root(vw)) >= min, `nav at ${vw}px`)
    // The brand row and the replay's (.top) nav use the base sizes.
    assert.ok(remSize(css, '.brand-row') * root(vw) >= min, `brand at ${vw}px`)
    assert.ok(remSize(css, '.site-nav') * root(vw) >= min, `replay nav at ${vw}px`)
  }
  // 1280x720 laptops: outside the replay the nav reaches body size.
  assert.ok(clampPx(css, '.site-nav', 1280, 16) >= 16)
  assert.ok(clampPx(css, '.site-nav', 1600, 18) >= 18)
})

test('the landing links to the neighborhood way in on Past spikes, in both languages (U9)', async () => {
  for (const [l, text] of [['en', 'Start from your neighborhood'], ['es', 'Empiece por su vecindario']] as const) {
    await setLang(l)
    const m = new RegExp(`<a href="([^"]+)">${text}</a>`).exec(await landing())
    assert.ok(m, `${l}: no neighborhood link`)
    const url = new URL(m[1], 'https://x.org/')
    assert.equal(pageFromLocation(url), 'spikes', `${l}: ${m[1]} must open Past spikes, where the chips are`)
  }
})
