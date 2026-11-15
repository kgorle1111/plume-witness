// Pure helpers for ?embed=1 (EmbedView.tsx). Self-contained, with .ts imports, so `npm test` can load it.
import { compass, hourLabel, statusInfo, unitFirst, unitShort } from './format.ts'
import { translate, type Lang, type StringKey, type Vars } from './i18n.ts'
import { compoundLabel } from './region.ts'
import type { PlumeEvent } from './types.ts'

// Labels are the replay's own step names (i18n step.*), so the embed reads in the page's language.
export const EMBED_STEPS = [
  { id: 'detect', label: 'step.detect' },
  { id: 'trace', label: 'step.trace' },
  { id: 'check', label: 'step.check' },
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

/** A compound name from a state record ("Benzene") in the reader's language; an unknown one stays as written. */
const recordCompound = (lang: Lang, c: string): string => {
  const label = compoundLabel(lang, c.toLowerCase())
  return label === c.toLowerCase() ? c : label
}

/** One or two sentences for the current step, in the reader's language. Same facts and caveats as the full steps,
 *  nothing ranked or blamed. Numbers, names and the ISO date are data and are never translated. */
export function stepLine(ev: PlumeEvent, step: EmbedStep, lang: Lang = 'en'): string {
  const d = ev.detection
  const t = (key: StringKey, vars?: Vars) => translate(lang, key, vars)
  if (step === 'detect') {
    const m = ev.monitors.find((x) => x.site_id === d.site_id)
    return t('embed.lineDetect', {
      site: m?.name ?? d.site_id, value: d.value, unit: unitFirst(ev.compound.units, lang), compound: compoundLabel(lang, ev.compound.name),
      hour: hourLabel(d.hour_cst), date: ev.date_local, baseline: d.baseline, short: unitShort(ev.compound.units),
    })
  }
  if (step === 'trace') {
    const n = ev.facilities.filter((f) => f.in_corridor).length
    const w = ev.wind.hourly.find((h) => h.hour_cst === d.hour_cst)
    const wind = w ? t('embed.lineWind', { dir: compass(w.from_deg, lang), deg: w.from_deg, mph: w.speed_mph }) : t('embed.lineNoWind')
    return `${wind} ${t(n === 1 ? 'embed.lineTraceOne' : 'embed.lineTrace', { n })}`
  }
  const rc = ev.record_check
  const status = statusInfo(rc.status)[lang]
  const filed = rc.status === 'reported' && rc.incident
    ? ` ${t('embed.lineFiled', { id: rc.incident, compound: rc.reported?.compound ? recordCompound(lang, rc.reported.compound) : t('embed.theCompound') })}`
    : ''
  return `${t('embed.lineCheck', { status })}${filed} ${t('embed.lineNotFinding')}`
}
