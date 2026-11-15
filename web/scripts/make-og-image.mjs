// Renders scripts/og-image.svg (colours from src/index.css :root) to public/og-image.png, 1200x630, for link previews.
// Uses a local headless Chrome like make-icons.mjs (no npm dependency). Text uses system fonts, so a rerun on another
// OS can differ by a few pixels; the layout leaves room for that.
// Run: node scripts/make-og-image.mjs   (set CHROME=/path/to/chrome if it is not the macOS default)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root)
  if (!m) throw new Error(`src/index.css :root has no hex --${name}`)
  return m[1]
}
const colours = {
  surface: token('surface'), surface2: token('surface-2'), ink: token('ink'), muted: token('muted'),
  accent: token('accent'), line: token('line'), trigger: token('trigger'), facility: token('facility'),
}
const svg = readFileSync(new URL('og-image.svg', import.meta.url), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (!(k in colours)) throw new Error(`og-image.svg uses unknown token {{${k}}}`)
  return colours[k]
})

const dir = mkdtempSync(join(tmpdir(), 'pw-og-'))
const html = join(dir, 'og.html')
writeFileSync(html, `<!doctype html><style>html,body{margin:0}svg{display:block}</style>${svg}`)
const out = fileURLToPath(new URL('../public/og-image.png', import.meta.url))
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1200,630', `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' })
console.log('wrote', out)
