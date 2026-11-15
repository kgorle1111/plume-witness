// Run: npm test. The replay map's Positron retint (basemapTint.ts), applied in EventMap's transformStyle.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import type { StyleSpecification } from 'maplibre-gl'
import { BASEMAP_TINT, INDUSTRIAL_LAYER, tintBasemap } from '../src/basemapTint.ts'

const style = (layers: StyleSpecification['layers'], sources: StyleSpecification['sources'] = { openmaptiles: { type: 'vector' } }): StyleSpecification =>
  ({ version: 8, sources, layers })
const base = style([
  { id: 'background', type: 'background', paint: { 'background-color': 'rgb(242,243,240)' } },
  { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-antialias': true, 'fill-color': 'rgb(194, 200, 202)' } },
  { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': 'grey' } },
  { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#000' } },
  { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#fff' } },
])
const layer = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> } | undefined

test('tinted layers take the palette colour and keep their other paint properties', () => {
  const out = tintBasemap(base)
  assert.equal(layer(out, 'background')?.paint?.['background-color'], '#eef4f2')
  assert.equal(layer(out, 'water')?.paint?.['fill-color'], '#a9d5cb')
  assert.equal(layer(out, 'water')?.paint?.['fill-antialias'], true)
  assert.equal(layer(out, 'label_city')?.paint?.['text-color'], '#24363b')
  assert.equal(layer(out, 'road')?.paint?.['line-color'], '#fff', 'a layer not in the list is untouched')
  assert.equal(layer(base, 'water')?.paint?.['fill-color'], 'rgb(194, 200, 202)', 'the input style is not mutated')
})

test('industrial land goes under the waterways, never over labels, and only once', () => {
  const ids = tintBasemap(base).layers.map((l) => l.id)
  assert.ok(ids.indexOf(INDUSTRIAL_LAYER) >= 0 && ids.indexOf(INDUSTRIAL_LAYER) < ids.indexOf('waterway'))
  const noWaterway = tintBasemap(style(base.layers.filter((l) => l.id !== 'waterway'))).layers.map((l) => l.id)
  assert.ok(noWaterway.indexOf(INDUSTRIAL_LAYER) < noWaterway.indexOf('label_city'))
  assert.equal(tintBasemap(tintBasemap(base)).layers.filter((l) => l.id === INDUSTRIAL_LAYER).length, 1)
})

test('a style without the landuse source or the listed layers still loads as published', () => {
  const other = style([{ id: 'bg', type: 'background', paint: { 'background-color': '#123456' } }], {})
  const out = tintBasemap(other)
  assert.deepEqual(out.layers, other.layers)
})

test('the palette is unique per layer and every colour is a hex', () => {
  assert.equal(new Set(BASEMAP_TINT.map(([id]) => id)).size, BASEMAP_TINT.length)
  for (const [, , c] of BASEMAP_TINT) assert.match(c, /^#[0-9a-f]{6}$/)
})

test('the Timeline map wears the same tint as the replay map', () => {
  // kn: a source check (the maps need WebGL); CoverageMap joins this list when it is tinted.
  for (const f of ['EventMap.tsx', 'RainMap.tsx']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    assert.match(src, /transformStyle:\s*\(_prev, next\) => tintBasemap\(/, `${f} does not tint its basemap`)
  }
})
