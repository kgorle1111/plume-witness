/** Play window for the replay: 6 hours that contain the detection hour (3 before, 3 after), slid inside the hours
 *  the file has so a spike near midnight still plays. The demo night (detection 09:00) keeps its 06:00–12:00. */
export const PLAY_SPAN = 6

export function playWindow(detectionHour: number, hours: number[]): { from: number; to: number } {
  const first = Math.min(...hours)
  const last = Math.max(...hours)
  const from = Math.max(first, Math.min(detectionHour - PLAY_SPAN / 2, last - PLAY_SPAN))
  return { from, to: Math.min(last, from + PLAY_SPAN) }
}
