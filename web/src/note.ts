import type { PlumeEvent } from './types'
import { compass, hourLabel, readingText, safeHttpUrl, statusInfo } from './format.ts'

/** Plain-text note for volunteers or reporters to forward. Every value is read from event.json; the wording
 *  around them adds no claim, and the limits travel with the numbers. */
export function incidentNote(ev: PlumeEvent, pageUrl?: string): string {
  const d = ev.detection
  const u = ev.compound.units
  const m = ev.monitors.find((x) => x.site_id === d.site_id)
  const wind = ev.wind.hourly.find((w) => w.hour_cst === d.hour_cst)
  const windSite = ev.monitors.find((x) => x.site_id === ev.wind.site_id)?.name ?? ev.wind.site_id
  const rc = ev.record_check
  const matched = ev.facilities.find((f) => f.id === rc.matched_facility_id)
  const url = safeHttpUrl(rc.source_url)
  const lines = [
    `Air monitor note: ${ev.title} (${ev.date_local})`,
    'Draft for review; not a finding.',
    '',
    `Monitor: ${m ? `${m.name} (${m.site_id})` : d.site_id}`,
    `Reading: ${readingText(d.value, null, u)} ${ev.compound.name} at ${hourLabel(d.hour_cst)}; usual level (baseline) ${d.baseline} ${u}`,
    wind
      ? `Wind at ${hourLabel(wind.hour_cst)} (${windSite}): from the ${compass(wind.from_deg)} (${wind.from_deg}°) at ${wind.speed_mph} mph`
      : `Wind at ${hourLabel(d.hour_cst)}: no reading`,
    `State record check: ${statusInfo(rc.status).en}${rc.incident ? `, report #${rc.incident}` : ''}${matched ? ` (${matched.name})` : ''}`,
    url ? `State record: ${url}` : 'State record: no valid link in this file',
    '',
    "What this can't say:",
    ...ev.cannot_say.map((t) => `- ${t}`),
  ]
  if (pageUrl) lines.push('', `Replay: ${pageUrl}`)
  return lines.join('\n')
}
