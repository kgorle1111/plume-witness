// Run: npm test. While coverage.json loads, the page already stands in its own 1040px column with its header:
// a full-width loading box that React restyled into that column once the data came moved the whole page sideways
// (CLS 0.21 at 1920px, 0.09 at 1280px).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { fileURLToPath } from 'node:url'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', root: fileURLToPath(new URL('..', import.meta.url)) })
after(() => server.close())

test('the loading state is the page column with the same header the loaded page has', async () => {
  const mod = await server.ssrLoadModule('/src/Coverage.tsx')
  const html = renderToStaticMarkup(createElement(mod.default))
  assert.match(html, /^<main class="cv-page" aria-busy="true"><header class="cv-head">/)
  assert.match(html, /<h1>[^<]+<\/h1><p class="cv-sub">[^<]+<\/p><\/header>/)
  assert.match(html, /Loading the monitor list/)
  assert.ok(!html.includes('state-msg'), html)
})
