// Run: npm test. Renders the landing and the site header's language switch through Vite's SSR loader (as
// embed-render.test.ts does), and reads the header's clamp() sizes from SiteHeader.css.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())
Object.assign(globalThis, { window: { location: { hash: '', search: '', origin: 'https://x.org', pathname: '/' }, addEventListener() {}, removeEventListener() {} } })

const setLang = async (l: 'en' | 'es') => (await server.ssrLoadModule('/src/i18n.ts')).setLang(l)
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
