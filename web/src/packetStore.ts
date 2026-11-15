import type { PacketReview } from './packet.ts'

/** Edits to a draft survive a reload or Back/Forward in the same tab (sessionStorage), one entry per night.
 *  Approval is never restored: a person approves the text in front of them, in this visit. */
export const packetKey = (eventId: string) => `pw-packet:${eventId}`

export function encodeReview(r: PacketReview): string {
  return JSON.stringify({ source: r.source, drafts: r.drafts })
}

export function decodeReview(raw: string | null, fallback: PacketReview): PacketReview {
  if (!raw) return fallback
  try {
    const j: unknown = JSON.parse(raw)
    if (!j || typeof j !== 'object') return fallback
    const { source, drafts } = j as { source?: unknown; drafts?: { en?: unknown; es?: unknown } }
    if ((source !== 'template' && source !== 'ai') || typeof drafts?.en !== 'string' || typeof drafts?.es !== 'string') return fallback
    return { ...fallback, source, drafts: { en: drafts.en, es: drafts.es }, approved: false }
  } catch {
    return fallback
  }
}
