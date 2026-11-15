// Run: npm test. The browser-bar colour (theme.ts, index.html, the manifest) must be the page's own background; the head preconnects to the map host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { THEME_COLOR } from '../src/theme.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const surface = (css: string, block: RegExp) => {
  const body = block.exec(css)?.[1] ?? ''
  return /--surface:\s*(#[0-9a-f]{6})/i.exec(body)?.[1]
}

test('theme-color is --surface in each theme', () => {
  assert.equal(surface(read('../src/index.css'), /:root\s*\{([^}]*)\}/), THEME_COLOR.light)
  assert.equal(surface(read('../src/dark.css'), /:root\[data-theme='dark'\]\s*\{([^}]*)\}/), THEME_COLOR.dark)
})

test('index.html paints the same colours before the app loads, and the manifest matches the light default', () => {
  const html = read('../index.html')
  assert.match(html, new RegExp(`<meta name="theme-color" content="${THEME_COLOR.light}"`))
  assert.ok(html.includes(`setAttribute('content', '${THEME_COLOR.dark}')`), 'inline dark theme-color')
  const m = JSON.parse(read('../public/manifest.webmanifest')) as Record<string, string>
  assert.equal(m.theme_color, THEME_COLOR.light)
  assert.equal(m.background_color, THEME_COLOR.light)
})

test('index.html preconnects to the host every map loads its style and tiles from', () => {
  const html = read('../index.html')
  for (const f of ['EventMap.tsx', 'CoverageMap.tsx', 'RainMap.tsx']) {
    const url = /const STYLE_URL = '([^']+)'/.exec(read(`../src/${f}`))?.[1]
    assert.ok(url, `${f}: no STYLE_URL`)
    const origin = new URL(url).origin
    assert.ok(html.includes(`<link rel="preconnect" href="${origin}" crossorigin />`), `${f}: no preconnect to ${origin}`)
  }
})
