// When the replay map opens on the globe intro. Pure (no DOM) so `node --test` can check the rule; EventMap reads the
// media queries and passes them in.

export interface IntroEnv {
  /** At least 1024px wide (the side-by-side layout); phones open flat and keep "Show globe". */
  wide: boolean
  reducedMotion: boolean
  /** Browser Data Saver. */
  saveData: boolean
}

/**
 * The fly-in pulls tiles at every zoom on the way down (9.9 MB for one night link at 1440px, against 1.1 MB flat), so it
 * plays on load only for a cold visit to the demo or a region's start night. A night opened by id (`?night=`, the spike
 * log, timeline and facility links) and the `?embed=1` iframe open flat; `?intro=0` always opts out and `?intro=1` opts a
 * night link back in. Reduced motion, Data Saver and narrow screens never get it on load.
 */
export function introOnLoad(search: string, env: IntroEnv): boolean {
  const q = new URLSearchParams(search)
  const intro = q.get('intro')
  if (intro === '0' || q.get('embed') === '1') return false
  if (q.has('night') && intro !== '1') return false
  return env.wide && !env.reducedMotion && !env.saveData
}
