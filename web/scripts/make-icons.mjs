// Rasterizes public/favicon.svg to the PWA icons using a local headless Chrome (no npm dependency).
// Run: node scripts/make-icons.mjs   (set CHROME=/path/to/chrome if it is not the macOS default)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'pw-icons-'))

// The favicon's art (plume wedge and source dot) reaches 12.3 units from (12.4,14.3) on its 24 grid, past the 9.6-unit
// circle Android keeps of a maskable icon. So the maskable icon recentres the art there and scales it by 0.7 (farthest
// point 8.6 units), on a full-bleed plate with no rounded corners or transparency. test/icons.test.ts checks the PNG.
const rect = svg.match(/<rect\b[^>]*\/>/)
const fill = rect?.[0].match(/fill="([^"]+)"/)?.[1]
if (!rect || !fill) throw new Error('make-icons: favicon.svg has no <rect … fill="…"/> plate; update the maskable recipe to match the new art')
const art = svg.slice(svg.indexOf(rect[0]) + rect[0].length, svg.lastIndexOf('</svg>'))
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${fill}"/>` +
  `<g transform="translate(12 12) scale(0.7) translate(-12.4 -14.3)">${art}</g></svg>`

const icons = [
  { src: svg, size: 192, rel: '../public/icon-192.png' },
  { src: svg, size: 512, rel: '../public/icon-512.png' },
  { src: maskable, size: 512, rel: '../public/icons/maskable-512.png' },
]
mkdirSync(fileURLToPath(new URL('../public/icons/', import.meta.url)), { recursive: true })
for (const [i, { src, size, rel }] of icons.entries()) {
  const html = join(dir, `i${i}.html`)
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`)
  const out = fileURLToPath(new URL(rel, import.meta.url))
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' })
  console.log('wrote', out)
}
