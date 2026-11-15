// The landing globe uses an orthographic view tilted north, with a steady rotation around Earth's axis.

const radians = Math.PI / 180

export const CENTER_LAT = 23
export const SPIN_PERIOD_S = 45

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

/** Start on the Atlantic; wrap after one complete rotation to keep long-running angles small. */
export function spinCenter(seconds: number) {
  return -63 + 360 * ((seconds % SPIN_PERIOD_S) / SPIN_PERIOD_S)
}
