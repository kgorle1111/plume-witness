// Run: npm test. Checks the manifest's icons exist at their declared sizes, and that the maskable icon (made by
// scripts/make-icons.mjs) is opaque and keeps all its art inside the circle Android keeps (radius 40% of the side).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const pub = new URL('../public/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', pub), 'utf8')) as {
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG to RGBA rows (the only kinds make-icons.mjs writes). */
function decodePng(buf: Buffer): { w: number; h: number; px: (x: number, y: number) => [number, number, number, number] } {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG')
  let at = 8, w = 0, h = 0, ch = 0
  const idat: Buffer[] = []
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.subarray(at + 4, at + 8).toString('latin1'), data = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      assert.equal(data[8], 8, 'bit depth'); assert.equal(data[12], 0, 'interlace')
      ch = ({ 2: 3, 6: 4 } as Record<number, number>)[data[9]] ?? 0
      assert.ok(ch, `colour type ${data[9]}`)
    }
    if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[y * stride + i - ch] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = y && i >= ch ? out[(y - 1) * stride + i - ch] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]
      out[y * stride + i] = (row[i] + pred) & 255
    }
  }
  return { w, h, px: (x, y) => { const o = y * stride + x * ch; return [out[o], out[o + 1], out[o + 2], ch === 4 ? out[o + 3] : 255] } }
}

test('every manifest icon exists, says its purpose, and a PNG is the size it claims', () => {
  for (const i of manifest.icons) {
    assert.ok(i.purpose === 'any' || i.purpose === 'maskable', `${i.src}: purpose ${i.purpose}`)
    const buf = readFileSync(new URL(i.src, pub))
    if (i.type !== 'image/png') continue
    const { w, h } = decodePng(buf)
    assert.equal(`${w}x${h}`, i.sizes, i.src)
  }
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'), 'no 512px maskable icon')
})

test('the maskable icon is opaque, and outside the 40% safe circle it is only the plate colour', () => {
  const src = manifest.icons.find((i) => i.purpose === 'maskable')!.src
  const { w, h, px } = decodePng(readFileSync(new URL(src, pub)))
  const plate = px(0, 0), r = 0.4 * w
  let art = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(x, y)
    assert.equal(p[3], 255, `transparent at ${x},${y}`)
    const differs = p.some((v, k) => Math.abs(v - plate[k]) > 8)
    if (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > r) assert.ok(!differs, `art outside the safe zone at ${x},${y}: ${p}`)
    else if (differs) art++
  }
  // The art is still there (not an empty plate): the dot and plume cover well over 5% of the safe circle.
  assert.ok(art > 0.05 * Math.PI * r * r, `only ${art} art pixels inside the safe zone`)
})
