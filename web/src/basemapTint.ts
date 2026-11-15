// Positron is grey on grey. This retints it into the app palette (PR #90's plan-drawing look): teal-mint water, sage
// parks and woods, peach industrial and port land (the Ship Channel's refineries read at a glance). Land stays near
// Positron's own luminance (#f2f3f0 -> #eef4f2), so the marker contrast measured against it holds: coral trigger
// 3.45:1, facility 11.3:1, out-of-corridor facility 4.0:1, filed facility 5.6:1.
// Pure (no MapLibre import), so EventMap's and RainMap's transformStyle apply it before the first paint and the node
// tests run it.
import type { StyleSpecification } from 'maplibre-gl'

// Layer ids checked 2026-11-15 against tiles.openfreemap.org/styles/positron; an id the style lacks is skipped.
export const BASEMAP_TINT: readonly [layer: string, paint: string, color: string][] = [
  ['background', 'background-color', '#eef4f2'],
  ['water', 'fill-color', '#a9d5cb'],
  ['waterway', 'line-color', '#8cc4b6'],
  ['park', 'fill-color', '#d4eadf'],
  ['landcover_wood', 'fill-color', '#d9ecdf'],
  ['landuse_residential', 'fill-color', '#e8efed'],
  ['building', 'fill-color', '#dbe4e2'],
  ['aeroway-area', 'fill-color', '#e3eaea'],
  ['road_area_pier', 'fill-color', '#f7faf9'],
  ['water_name_point_label', 'text-color', '#2f6a62'],
  ['water_name_line_label', 'text-color', '#2f6a62'],
  ['waterway_line_label', 'text-color', '#2f6a62'],
  ['label_city', 'text-color', '#24363b'],
  ['label_town', 'text-color', '#33585d'],
  ['label_village', 'text-color', '#4b6066'],
  ['label_other', 'text-color', '#4b6066'],
]

export const INDUSTRIAL_LAYER = 'pw-landuse-industrial'
const LANDUSE_SOURCE = 'openmaptiles'

type Layer = StyleSpecification['layers'][number]

/** The style with the palette applied and a peach industrial-land fill under the waterways. Returns the input
 *  unchanged in shape when a layer or the landuse source is missing, so a renamed basemap still draws as published. */
export function tintBasemap(style: StyleSpecification): StyleSpecification {
  const tint = new Map(BASEMAP_TINT.map(([id, prop, color]) => [id, [prop, color] as const]))
  const layers: Layer[] = style.layers.map((l) => {
    const t = tint.get(l.id)
    return t ? ({ ...l, paint: { ...('paint' in l ? l.paint : {}), [t[0]]: t[1] } } as Layer) : l
  })
  if (style.sources?.[LANDUSE_SOURCE] && !layers.some((l) => l.id === INDUSTRIAL_LAYER)) {
    const industrial: Layer = {
      id: INDUSTRIAL_LAYER,
      type: 'fill',
      source: LANDUSE_SOURCE,
      'source-layer': 'landuse',
      // PR #90 also tinted 'commercial' at 0.85: over Houston that turned most of the corridor peach, and the coral
      // corridor (the data) lost its edge against it. Industrial and rail land only, lighter.
      filter: ['match', ['get', 'class'], ['industrial', 'railway'], true, false],
      paint: { 'fill-color': '#f6ddd2', 'fill-opacity': 0.6 },
    }
    // Under the waterways (rivers stay on top); without them, under the first label, never over text.
    const waterway = layers.findIndex((l) => l.id === 'waterway')
    const firstLabel = layers.findIndex((l) => l.type === 'symbol')
    const at = waterway >= 0 ? waterway : firstLabel >= 0 ? firstLabel : layers.length
    layers.splice(at, 0, industrial)
  }
  // A soft atmosphere on the globe intro; it blends out by zoom 7, so the flat replay is unchanged.
  const sky = style.sky ?? { 'sky-color': '#cfe6ea', 'horizon-color': '#f5f9fa', 'fog-color': '#f5f9fa', 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }
  return { ...style, layers, sky }
}
