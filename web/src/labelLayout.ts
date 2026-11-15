// Standing-label layout for the replay map, in screen pixels. Pure (no MapLibre, no DOM) so `node --test` can check
// the priority rules: EventMap projects the points, this decides which labels stand and on which side.
//
// Priority, highest first: the flagged monitor's reading (fixed under its circle), the other monitors' readings,
// then facility names (a label the reader asked for, the filed-report facility, then the nearest by rank).
// Monitor labels never cover each other; a facility name that would cover any placed label is dropped (its number
// stays in the dot, and the Trace list carries every name), except the ones that must show.

export type Box = [number, number, number, number]
export type Where = 'right' | 'left' | 'below' | 'above'

export const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/** Box for text of size [w, h] put on one side of a point, `gap` px from it. */
export function boxAt(x: number, y: number, [w, h]: [number, number], where: Where, gap: number): Box {
  return where === 'right' ? [x + gap, y - h / 2, x + gap + w, y + h / 2]
    : where === 'left' ? [x - gap - w, y - h / 2, x - gap, y + h / 2]
      : where === 'below' ? [x - w / 2, y + gap, x + w / 2, y + gap + h]
        : [x - w / 2, y - gap - h, x + w / 2, y - gap]
}

export interface LabelAsk {
  id: string
  x: number
  y: number
  /** Text box size [w, h] in px. */
  size: [number, number]
  /** Distance from the point to the label's near edge. */
  gap: number
  /** Shown even when every side collides (on its least-bad side). */
  must?: boolean
  /** Sides to try, in order of preference; the first one is used as is when it costs nothing. */
  sides?: Where[]
}

export interface Placed { where: Where; dx: number; box: Box }

export interface LayoutInput {
  width: number
  /** Top of the visible map: anything over the legend strip counts as off the map. */
  top: number
  height: number
  /** Screen boxes of every dot, so labels keep off them (a label never counts its own dot). */
  dots: { id: string; box: Box }[]
  /** Boxes already taken before any label (e.g. a button over the map). */
  reserved?: Box[]
  /** The flagged monitor: always shown, always below its circle. */
  trigger?: LabelAsk
  monitors: LabelAsk[]
  /** In priority order. */
  facilities: LabelAsk[]
  /** Extra cost for covering something drawn by the basemap (place names); 0 when unknown. */
  soft?: (b: Box) => number
}

export interface LayoutResult {
  monitors: Map<string, Placed>
  facilities: Map<string, Placed>
  placed: Box[]
}

const ALL: Where[] = ['right', 'left', 'below', 'above']
// A monitor's reading sits under its circle unless something is in the way.
const MONITOR_SIDES: Where[] = ['below', 'above', 'right', 'left']
const OFF_MAP = 1000
const OVER_LABEL = 100

export function layoutLabels(input: LayoutInput): LayoutResult {
  const { width, top, height, dots, soft } = input
  const placed: Box[] = [...(input.reserved ?? [])]
  const inside = (b: Box) => b[0] >= 4 && b[2] <= width - 4 && b[1] >= top && b[3] <= height - 4
  // A centred label (below or above) slides sideways to stay on the map, so a long name isn't cut off.
  const slide = (b: Box) => (b[0] < 4 ? 4 - b[0] : b[2] > width - 4 ? width - 4 - b[2] : 0)
  const place = (a: LabelAsk, dotCost: number, sides: Where[]) => {
    const cost = (b: Box) => (inside(b) ? 0 : OFF_MAP) + OVER_LABEL * placed.filter((q) => hit(b, q)).length
      + dotCost * dots.filter((d) => d.id !== a.id && hit(b, d.box)).length + (soft ? soft(b) : 0)
    const options = (a.sides ?? sides).map((w) => {
      const b0 = boxAt(a.x, a.y, a.size, w, a.gap)
      const dx = w === 'below' || w === 'above' ? slide(b0) : 0
      const b: Box = [b0[0] + dx, b0[1], b0[2] + dx, b0[3]]
      return { where: w, dx, box: b, c: cost(b) }
    })
    // Ties keep the earlier side, so a label stays where it was until something actually blocks it.
    return options.reduce((best, o) => (o.c < best.c ? o : best))
  }

  const monitors = new Map<string, Placed>()
  if (input.trigger) {
    const t = input.trigger
    const box = boxAt(t.x, t.y, t.size, 'below', t.gap)
    monitors.set(t.id, { where: 'below', dx: 0, box })
    placed.push(box)
  }
  // Monitor readings come before any facility name; covering a facility dot costs more than for a name, since a
  // reading drawn over a dot hides its number.
  for (const m of input.monitors) {
    const best = place(m, 3, MONITOR_SIDES)
    if (!m.must && best.c >= OVER_LABEL) continue
    monitors.set(m.id, { where: best.where, dx: best.dx, box: best.box })
    placed.push(best.box)
  }
  const facilities = new Map<string, Placed>()
  for (const f of input.facilities) {
    const best = place(f, 1, ALL)
    if (!f.must && best.c >= OVER_LABEL) continue
    facilities.set(f.id, { where: best.where, dx: best.dx, box: best.box })
    placed.push(best.box)
  }
  return { monitors, facilities, placed }
}

/** Which numbered dots keep their number: in priority order, a dot that overlaps one already numbered loses its
 *  number (two numbers drawn on top of each other read as neither). `keep` ids always keep theirs. */
export function numberedDots(dots: { id: string; x: number; y: number; r: number }[], keep: Set<string>): Set<string> {
  const shown: { x: number; y: number; r: number }[] = []
  const out = new Set<string>()
  const ordered = [...dots.filter((d) => keep.has(d.id)), ...dots.filter((d) => !keep.has(d.id))]
  for (const d of ordered) {
    const clash = shown.some((s) => Math.hypot(s.x - d.x, s.y - d.y) < s.r + d.r - 2)
    if (clash && !keep.has(d.id)) continue
    shown.push(d)
    out.add(d.id)
  }
  return out
}

/** Dots within `radius` px of a tap, nearest first. A phone tap over a crowded cluster lists these to choose from
 *  instead of guessing the nearest (at 320px about 40 of 47 corridor dots fall in a ~200x90px area). */
export function dotsNear<T extends { id: string; x: number; y: number }>(dots: T[], x: number, y: number, radius: number): T[] {
  const seen = new Set<string>()
  return dots
    .map((d) => ({ d, dist: Math.hypot(d.x - x, d.y - y) }))
    .filter(({ dist }) => dist <= radius)
    .sort((a, b) => a.dist - b.dist)
    .filter(({ d }) => !seen.has(d.id) && seen.add(d.id))
    .map(({ d }) => d)
}
