/** The hour a Play press starts from. The button says "Play 06:00–12:00", so a fresh press plays that whole window
 *  (the replay opens on the 09:00 detection hour, and the first press used to skip 06:00–08:00). Only a press that
 *  resumes the user's own Pause continues where it stopped. */
export function playStartHour(hour: number, from: number, to: number, resuming: boolean): number {
  return resuming && hour >= from && hour < to ? hour : from
}
