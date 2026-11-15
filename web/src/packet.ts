import { useEffect, useState } from 'react'
import { parseAiDraft, type AiDraft, type PlumeEvent } from './types'

export type Lang = 'en' | 'es'

export type Source = 'template' | 'ai'

/** Packet review state. It lives in the stepper (carried over from PR #21) so leaving Packet to re-check the
 *  record and coming back keeps the drafts, the language, the draft source and the approval. */
export interface PacketReview {
  lang: Lang
  source: Source
  drafts: Record<Lang, string>
  approved: boolean
}

export const initialPacketReview = (ev: PlumeEvent): PacketReview => ({
  lang: 'en',
  source: 'template',
  drafts: { en: ev.packet.draft_en, es: ev.packet.draft_es },
  approved: false,
})

/** The AI draft is optional: a missing or malformed file leaves the template-only packet, as before. */
export function useAiDraft(): AiDraft | null {
  const [ai, setAi] = useState<AiDraft | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`${import.meta.env.BASE_URL}packet.ai.json`, { signal: ctrl.signal, cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setAi(parseAiDraft(raw)))
      .catch(() => setAi(null))
    return () => ctrl.abort()
  }, [])
  return ai
}

