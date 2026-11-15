import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { buildId, precacheList } from './pwa/precache.ts'
import { collectNights } from './share/collect.ts'
import { stubHtml, stubPath } from './share/stubs.ts'

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`])

// Writes dist/precache.json and stamps the build id into dist/sw.js (see public/sw.js). No dependency.
function precachePlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pw-precache',
    apply: 'build',
    configResolved: (c) => { outDir = join(c.root, c.build.outDir) },
    closeBundle() {
      const urls = precacheList(walk(outDir))
      const entries = urls.map((u): [string, Uint8Array] => [u, readFileSync(join(outDir, u === './' ? 'index.html' : u))])
      const id = buildId(entries)
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify({ build: id, urls }, null, 1))
      const sw = join(outDir, 'sw.js')
      const src = readFileSync(sw, 'utf8')
      if (!src.includes("'__BUILD_ID__'")) throw new Error('sw.js has no __BUILD_ID__ placeholder to stamp')
      writeFileSync(sw, src.replace("'__BUILD_ID__'", `'${id}'`))
    },
  }
}

// One link-preview page per listed night (share/stubs.ts), written into the build only: dev and public/ stay clean.
// precacheList leaves s/ out, so the stubs never weigh on the offline cache.
function linkPreviewPlugin(): Plugin {
  let publicDir = 'public'
  return {
    name: 'pw-link-previews',
    apply: 'build',
    configResolved: (c) => { publicDir = c.publicDir },
    generateBundle() {
      for (const n of collectNights(publicDir)) this.emitFile({ type: 'asset', fileName: stubPath(n.id), source: stubHtml(n) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), linkPreviewPlugin(), precachePlugin()],
  // Maps next to the chunks (never precached: precacheList skips .map), so a stack trace from the live demo can be
  // read. The code is MIT and public, so the maps expose nothing new.
  build: { sourcemap: true },
  // The brief view imports ../docs/brief.md; let the dev server read that one folder outside web/.
  server: { fs: { allow: ['.', '../docs'] } },
})
