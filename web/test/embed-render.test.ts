// Run: npm test. Renders the embed view on the real demo night through Vite's SSR loader (no new dependency):
// the markup must carry the map slot, the current step and the link out, and none of the app's navigation.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { fileURLToPath } from 'node:url'
import type { PlumeEvent } from '../src/types.ts'

const ev = JSON.parse(readFileSync(new URL('../public/event.json', import.meta.url), 'utf8')) as PlumeEvent
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())

const render = async (hash: string) => {
  Object.assign(globalThis, { window: { location: { hash, search: '?night=x&embed=1', origin: 'https://x.org', pathname: '/plume-witness/' }, addEventListener() {}, removeEventListener() {} } })
  const mod = await server.ssrLoadModule('/src/EmbedView.tsx')
  return renderToStaticMarkup(createElement(mod.EmbedReplay, { ev }))
}

test('embed markup has the map, the step and the link, and no navigation chrome', async () => {
  const html = await render('')
  assert.match(html, /class="embed-map"/)
  assert.match(html, /Open in Plume Witness/)
  assert.match(html, /href="https:\/\/x\.org\/plume-witness\/\?night=x"/)
  assert.match(html, new RegExp(String(ev.detection.value)))
  for (const chrome of ['role="tablist"', 'Past spikes', 'Replay another night', 'class="top"', 'class="stepper"', 'site-foot', 'Next:', 'Embed this night']) {
    assert.ok(!html.includes(chrome), `embed view must not render ${chrome}`)
  }
})

test('the hash picks the step', async () => {
  assert.match(await render('#check'), /State record:/)
  assert.match(await render('#trace'), /upwind direction/)
})
