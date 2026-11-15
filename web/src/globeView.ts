// The landing globe's view: an orthographic projection tilted to CENTER_LAT, turned to a longitude that sways around
// Houston instead of spinning the whole Earth past it. Pure math, so test/globeView.test.ts can check it.

const radians = Math.PI / 180

/** The study area (the Ship Channel monitors sit within ~20 km of this point). */
export const HOUSTON = { lat: 29.76, lon: -95.37 }
/** View tilt: a little south of Houston, so Houston sits just above the disc's centre. */
export const CENTER_LAT = 23
/** Half-width of the sway in degrees of longitude; Houston stays on the near side at every angle. */
export const SWAY_DEG = 38
/** Seconds for one full sway (there and back). */
export const SWAY_PERIOD_S = 48

const sinC = Math.sin(CENTER_LAT * radians)
const cosC = Math.cos(CENTER_LAT * radians)

/** Disc point (x right, y up, both -1..1) to geographic degrees, for a view centred on longitude 0. */
export function unproject(x: number, y: number) {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
  return {
    lat: Math.asin(y * cosC + z * sinC) / radians,
    lon: Math.atan2(x, z * cosC - y * sinC) / radians,
  }
}

/** Geographic degrees to the disc, for a view centred on longitude `center`; `visible` is false on the far side. */
export function project(lat: number, lon: number, center: number) {
  const phi = lat * radians
  const lambda = (lon - center) * radians
  return {
    x: Math.cos(phi) * Math.sin(lambda),
    y: cosC * Math.sin(phi) - sinC * Math.cos(phi) * Math.cos(lambda),
    visible: sinC * Math.sin(phi) + cosC * Math.cos(phi) * Math.cos(lambda) > 0,
  }
}

/** The view's centre longitude `seconds` into the sway: starts on Houston and eases out to ±SWAY_DEG and back. */
export function swayCenter(seconds: number) {
  return HOUSTON.lon + SWAY_DEG * Math.sin((2 * Math.PI * seconds) / SWAY_PERIOD_S)
}
