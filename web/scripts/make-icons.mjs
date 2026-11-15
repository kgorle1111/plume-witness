// Rasterizes public/favicon.svg to the PWA icons using a local headless Chrome (no npm dependency).
// Run: node scripts/make-icons.mjs   (set CHROME=/path/to/chrome if it is not the macOS default)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'pw-icons-'))

// maskable: the favicon's rounded square is already full-bleed, so the safe zone is met by the art being centred.
for (const size of [192, 512]) {
  const html = join(dir, `i${size}.html`)
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  const out = fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url))
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' })
  console.log('wrote', out)
}
