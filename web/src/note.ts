import type { PlumeEvent } from './types'
import { cannotSayEs, compass, hourLabel, readingText, safeHttpUrl, statusLabel } from './format.ts'
import { translate, type Lang, type StringKey, type Vars } from './i18n.ts'
import { compoundLabel, eventTitle, regionByKey } from './region.ts'

/** The replay link a note carries: this page (night and region included) opened on the Check step. */
export function noteUrl(href: string): string {
  const u = new URL(href)
  u.hash = 'check'
  return u.href
}

/** Plain-text note for volunteers or reporters to forward, in the reader's language. Every value is read from
 *  event.json; the wording around them adds no claim, and the limits travel with the numbers. Pipeline text with
 *  no reviewed Spanish (a limit, the wind-source note) stays in English rather than being guessed at. */
export function incidentNote(ev: PlumeEvent, pageUrl?: string, lang: Lang = 'en'): string {
  const t = (k: StringKey, vars?: Vars) => translate(lang, k, vars)
  const d = ev.detection
  const u = ev.compound.units
  const m = ev.monitors.find((x) => x.site_id === d.site_id)
  const wind = ev.wind.hourly.find((w) => w.hour_cst === d.hour_cst)
  const windSite = ev.monitors.find((x) => x.site_id === ev.wind.site_id)?.name ?? ev.wind.site_id
  const rc = ev.record_check
  const matched = ev.facilities.find((f) => f.id === rc.matched_facility_id)
  const url = safeHttpUrl(rc.source_url)
  const title = eventTitle(lang, ev.title, ev.compound.name, regionByKey(ev.region?.key).key).text
  const lines = [
    t('note.title', { title, date: ev.date_local }),
    t('note.draft'),
    '',
    t('note.monitor', { monitor: m ? `${m.name} (${t('det.siteId', { id: m.site_id })})` : d.site_id }),
    t('note.reading', { reading: readingText(d.value, null, u), compound: compoundLabel(lang, ev.compound.name), hour: hourLabel(d.hour_cst), base: d.baseline, unit: u }),
    wind
      ? t('note.wind', { hour: hourLabel(wind.hour_cst), site: windSite, dir: compass(wind.from_deg, lang), deg: wind.from_deg, mph: wind.speed_mph })
      : t('note.noWind', { hour: hourLabel(d.hour_cst) }),
    ...(ev.wind.source_note ? [ev.wind.source_note] : []),
    `${t('note.status', { status: statusLabel(rc.status, lang) })}${rc.incident ? t('note.report', { id: rc.incident }) : ''}${matched ? ` (${matched.name})` : ''}`,
    url ? t('note.record', { url }) : t('note.noRecord'),
    '',
    t('note.cannot'),
    ...ev.cannot_say.map((line) => `- ${(lang === 'es' ? cannotSayEs(line) : null) ?? line}`),
  ]
  if (pageUrl) lines.push('', t('note.replay', { url: pageUrl }))
  return lines.join('\n')
}
