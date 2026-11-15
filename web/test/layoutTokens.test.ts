// Run: npm test. Layout tokens and shared controls (G-D): the page paper keeps every text and control colour readable,
// pages share the container tokens, the replay's stylesheet stays out of the entry bundle, and there is one status pill.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { STATUS_FILL } from '../src/format.ts'

const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const index = read('index.css')
const dark = read('dark.css')

/** The custom properties declared in the first block that `head` opens, e.g. ':root {' or ":root[data-theme='dark'] {". */
function tokens(css: string, head: string): Map<string, string> {
  const start = css.indexOf(head)
  assert.ok(start >= 0, `no ${head} block`)
  const body = css.slice(start + head.length, css.indexOf('\n}', start))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
/** A token's hex value, following var() aliases inside the same theme (then the light root). */
function hex(name: string, theme: Map<string, string>, root: Map<string, string>): string {
  let v = theme.get(name) ?? root.get(name)
  for (let i = 0; v?.startsWith('var(') && i < 5; i++) {
    const ref = /var\((--[\w-]+)\)/.exec(v)?.[1] ?? ''
    v = theme.get(ref) ?? root.get(ref)
  }
  assert.ok(v && /^#[0-9a-f]{6}$/i.test(v), `${name} does not resolve to a #rrggbb colour (got ${v})`)
  return v
}
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const light = tokens(index, ':root {')
const darkT = new Map([...tokens(dark, ":root[data-theme='dark'] {"), ...tokens(index, ":root[data-theme='dark'] {")])
// Text the pages set on the page background, and control edges and marks that must read against it (WCAG 1.4.3, 1.4.11).
const TEXT = ['--ink', '--ink-2', '--muted', '--ink-3', '--accent', '--spike-ink', '--matched', '--q-fg', '--pending-fg', '--place']
const UI = ['--focus', '--trigger', '--monitor', '--teal']

test('the page is paper in light and its own surface in dark, through --bg', () => {
  assert.equal(light.get('--bg'), 'var(--paper)')
  assert.equal(hex('--paper', light, light).toLowerCase(), '#f5f9fa')
  assert.equal(hex('--bg', darkT, light), hex('--surface', darkT, light), 'dark: the page must be the dark surface, not light paper')
})

test('every text token is at least 4.5:1 and every control colour 3:1 on the page, in both themes', () => {
  for (const [name, theme] of [['light', light], ['dark', darkT]] as const) {
    const page = hex('--bg', theme, light)
    for (const t of TEXT) assert.ok(ratio(hex(t, theme, light), page) >= 4.5, `${name}: ${t} on the page is ${ratio(hex(t, theme, light), page).toFixed(2)}:1`)
    for (const t of UI) assert.ok(ratio(hex(t, theme, light), page) >= 3, `${name}: ${t} on the page is ${ratio(hex(t, theme, light), page).toFixed(2)}:1`)
  }
})

test('the contrast check fails a colour that is too light for the page', () => {
  assert.ok(ratio('#8a9ea3', '#f5f9fa') < 4.5)
})

test('container widths are defined once in index.css and every page column uses them with the shared gutter', () => {
  for (const t of ['--page-wide', '--page-read', '--page-full']) {
    assert.equal(index.split(`${t}:`).length - 1, 1, `${t} must be declared exactly once`)
  }
  const pages: [string, string, string][] = [
    ['SpikeLog.css', '.sl-page', '--page-wide'], ['SpikeRain.css', '.rn-page', '--page-wide'], ['Coverage.css', '.cv-page', '--page-wide'],
    ['Facilities.css', '.fx-page', '--page-read'], ['Brief.css', '.br-page', '--page-read'],
  ]
  for (const [file, sel, token] of pages) {
    const css = read(file)
    const rule = new RegExp(`^\\${sel} \\{([^}]*)\\}`, 'm').exec(css)?.[1]
    assert.ok(rule, `${file}: no ${sel} rule`)
    assert.match(rule, new RegExp(`max-width: var\\(${token}\\)`), `${file}: ${sel} must take its width from ${token}`)
    assert.match(rule, /padding: [^;]*var\(--gutter\)/, `${file}: ${sel} must use the shared gutter`)
    // No page column keeps a width of its own (1180px, 860px, 1040px, 64ch were the five edges D16 measured).
    for (const m of css.matchAll(new RegExp(`\\${sel} \\{[^}]*max-width: ([^;]+);`, 'g'))) {
      assert.match(m[1], /^var\(--page-[a-z]+\)$|^none$/, `${file}: ${sel} max-width ${m[1]}`)
    }
  }
})

test('the replay stylesheet is not in the entry bundle, and the controls every page uses are', () => {
  const imports = (f: string) => [...read(f).matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])
  for (const f of ['main.tsx', 'Site.tsx']) assert.ok(!imports(f).includes('./App.css'), `${f} must not import App.css (it puts the replay's CSS in the entry)`)
  assert.ok(imports('App.tsx').includes('./App.css'), 'App.tsx loads its own stylesheet')
  const app = read('App.css')
  for (const sel of ['.btn', '.btn-primary', '.seg', '.seg button', '.chip', '.state-msg', '.skip-link', '.muted', '.small', 'code']) {
    const rule = new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{`, 'm')
    assert.match(index, rule, `index.css must define ${sel}`)
    assert.doesNotMatch(app, rule, `App.css must not define ${sel} again`)
  }
})

test('one status pill: one sizing rule for .status and .sl-status, and both colour sets for every status', () => {
  assert.match(index, /^\.status, \.sl-status \{[^}]*font-size: 0\.875rem;/m)
  for (const f of ['App.css', 'SpikeLog.css', 'SpikeRain.css']) {
    for (const m of read(f).matchAll(/^([^{\n]*\.(?:sl-)?status\b[^{\n]*)\{([^}]*)\}/gm)) {
      assert.doesNotMatch(m[2], /font-size|padding|border|font-weight/, `${f}: "${m[1].trim()}" sizes the pill outside index.css`)
    }
  }
  for (const s of Object.keys(STATUS_FILL)) {
    assert.match(index, new RegExp(`^\\.status-${s}, \\.sl-status-${s} \\{`, 'm'), `no shared colours for ${s}`)
  }
})

test('the timeline\'s fixed list cards are sized from the pill index.css draws', () => {
  const pill = /^\.status, \.sl-status \{([^}]*)\}/m.exec(index)?.[1] ?? ''
  const fs = /font-size: ([\d.]+)rem/.exec(pill)?.[1]
  const lh = /line-height: ([\d.]+)/.exec(pill)?.[1]
  const padY = Number(/padding: (\d+)px/.exec(pill)?.[1])
  const border = Number(/border: ([\d.]+)px/.exec(pill)?.[1])
  const chrome = 2 * padY + 2 * border
  const rain = read('SpikeRain.css')
  assert.match(rain, new RegExp(`--rn-pill: calc\\(${fs}rem \\* ${lh} \\+ ${chrome}px\\)`), 'one-line pill height drifted from index.css')
  // From 1280px the pill is 1rem and two lines are reserved (the Spanish open-question label wraps in the side column).
  assert.match(index, /@media \(min-width: 1280px\) \{\s*\.status, \.sl-status \{ font-size: 1rem; \}/)
  assert.match(rain, new RegExp(`--rn-pill: calc\\(2 \\* 1rem \\* ${lh} \\+ ${chrome}px\\)`), '1280px pill height drifted from index.css')
})
