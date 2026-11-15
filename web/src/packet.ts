import { useEffect, useState, useSyncExternalStore } from 'react'
import { parseAiDraft, type AiDraft, type PlumeEvent } from './types.ts'

import { getLang, type Lang } from './i18n.ts'

export type { Lang }

export type Source = 'template' | 'ai'

/** Packet review state. It lives in the stepper (carried over from PR #21) so leaving Packet to re-check the
 *  record and coming back keeps the drafts, the language, the draft source and the approval. */
export interface PacketReview {
  lang: Lang
  source: Source
  drafts: Record<Lang, string>
  approved: boolean
}

// Edits survive a reload or Back in this tab (sessionStorage), keyed by night. Approval is never restored: it
// covers text a person read on this visit.
const SAVE_PREFIX = 'pw-packet:'
const MAX_DRAFT = 50_000
const saveKey = (ev: PlumeEvent) => `${SAVE_PREFIX}${ev.event_id}:${ev.date_local}:${ev.detection.site_id}`

interface Saved { source: Source; drafts: Record<Lang, string> }

/** Trust boundary: storage can hold anything (another build, a hand edit). Only a well-formed, bounded entry passes. */
export function parseSaved(raw: string | null): Saved | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { source?: unknown; drafts?: { en?: unknown; es?: unknown } }
    const ok = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_DRAFT
    if ((v.source !== 'template' && v.source !== 'ai') || !ok(v.drafts?.en) || !ok(v.drafts?.es)) return null
    return { source: v.source, drafts: { en: v.drafts.en, es: v.drafts.es } }
  } catch {
    return null
  }
}

/** The review a replay opens with: saved edits when this tab has some for the night, otherwise the template. */
export function restoreReview(ev: PlumeEvent, raw: string | null, lang: Lang): PacketReview {
  const saved = parseSaved(raw)
  return {
    lang,
    source: saved?.source ?? 'template',
    drafts: saved?.drafts ?? { en: ev.packet.draft_en, es: ev.packet.draft_es },
    approved: false,
  }
}

function storage(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

export const initialPacketReview = (ev: PlumeEvent): PacketReview => {
  let raw: string | null = null
  try { raw = storage()?.getItem(saveKey(ev)) ?? null } catch { /* blocked storage: start from the template */ }
  return restoreReview(ev, raw, getLang())
}

/** Keeps the drafts for this tab; an untouched template is not stored. A failed write only loses the reload copy. */
export function savePacketReview(ev: PlumeEvent, r: PacketReview): void {
  const s = storage()
  if (!s) return
  const untouched = r.source === 'template' && r.drafts.en === ev.packet.draft_en && r.drafts.es === ev.packet.draft_es
  try {
    if (untouched) s.removeItem(saveKey(ev))
    else s.setItem(saveKey(ev), JSON.stringify({ source: r.source, drafts: r.drafts }))
  } catch { /* quota or blocked storage */ }
}

// Whether the optional AI draft failed to load, so Packet can say so instead of dropping the choice silently.
let aiFailed = false
const aiListeners = new Set<() => void>()
const setAiFailed = (v: boolean) => {
  if (v === aiFailed) return
  aiFailed = v
  for (const fn of aiListeners) fn()
}
const subscribeAi = (fn: () => void) => { aiListeners.add(fn); return () => { aiListeners.delete(fn) } }
export const useAiDraftFailed = (): boolean => useSyncExternalStore(subscribeAi, () => aiFailed, () => false)

/** The AI draft is optional: a missing or malformed file leaves the template-only packet, as before.
 *  packet.ai.json is drafted from event.json (the demo night) and carries no event id, so a `?night=` replay
 *  never offers it: its numbers belong to another night.
 *  kn: match on an event id in packet.ai.json once the pipeline writes one; then per-night AI drafts can show. */
export function useAiDraft(): AiDraft | null {
  const [ai, setAi] = useState<AiDraft | null>(null)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('night')) return
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}packet.ai.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        const draft = parseAiDraft(raw)
        setAi(draft)
        setAiFailed(draft === null)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setAi(null)
        setAiFailed(true)
      })
    return () => ctrl.abort()
  }, [])
  return ai
}
