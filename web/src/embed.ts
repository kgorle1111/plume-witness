// Pure helpers for ?embed=1 (EmbedView.tsx). Self-contained, with .ts imports, so `npm test` can load it.
import { compass, hourLabel, statusInfo, unitFirst, unitShort } from './format.ts'
import type { PlumeEvent } from './types.ts'

export const EMBED_STEPS = [
  { id: 'detect', label: 'Detect' },
  { id: 'trace', label: 'Trace' },
  { id: 'check', label: 'Check' },
] as const
export type EmbedStep = (typeof EMBED_STEPS)[number]['id']

export const isEmbed = (search: string): boolean => new URLSearchParams(search).get('embed') === '1'

export const stepFromHash = (hash: string): EmbedStep => EMBED_STEPS.find((s) => `#${s.id}` === hash)?.id ?? 'detect'

/** The night's own page: the embed URL's query without `embed`, so "Open in Plume Witness" lands on the full replay.
 *  A bare URL opens the landing page (routes.ts), so the demo night keeps `intro=0` to stay on the replay. */
export function fullUrl(origin: string, pathname: string, search: string): string {
  const q = new URLSearchParams(search)
  q.delete('embed')
  if (!q.toString()) q.set('intro', '0')
  return `${origin}${pathname}?${q.toString()}`
}

/** The chrome-free URL for the same night, as an iframe would load it. */
export function embedUrl(origin: string, pathname: string, search: string): string {
  const q = new URLSearchParams(search)
  q.set('embed', '1')
  return `${origin}${pathname}?${q.toString()}`
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function iframeHtml(src: string, title: string): string {
  return `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title)}" width="100%" height="520" style="border:0;max-width:720px" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`
}

/** One or two sentences for the current step. Same facts and caveats as the full steps, nothing ranked or blamed. */
export function stepLine(ev: PlumeEvent, step: EmbedStep): string {
  const d = ev.detection
  if (step === 'detect') {
    const m = ev.monitors.find((x) => x.site_id === d.site_id)
    return `${m?.name ?? d.site_id} recorded ${d.value} ${unitFirst(ev.compound.units)} of ${ev.compound.name} at ${hourLabel(d.hour_cst)} on ${ev.date_local}; its usual level is ${d.baseline} ${unitShort(ev.compound.units)}.`
  }
  if (step === 'trace') {
    const n = ev.facilities.filter((f) => f.in_corridor).length
    const w = ev.wind.hourly.find((h) => h.hour_cst === d.hour_cst)
    const wind = w ? `Wind came from the ${compass(w.from_deg)} (${w.from_deg}°) at ${w.speed_mph} mph. ` : 'No wind reading for that hour. '
    return `${wind}${n} listed facilit${n === 1 ? 'y sits' : 'ies sit'} in that upwind direction. Wind at one monitor cannot tell them apart.`
  }
  const rc = ev.record_check
  const status = statusInfo(rc.status).en
  const filed = rc.status === 'reported' && rc.incident ? ` Report #${rc.incident} lists ${rc.reported?.compound ?? 'the compound'} in the corridor.` : ''
  return `State record: ${status}.${filed} This is not a finding about any facility.`
}
