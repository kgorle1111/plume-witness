import { useEffect, useState } from 'react'
import type { Lang, Source } from './packet'

interface Entry { file: string; voice: string; sha256: string; seconds: number }
type Manifest = Record<string, Entry>

let manifest: Promise<Manifest | null> | null = null

// Recordings exist only for the default demo night; a replayed night (?night=) has none, so skip the fetch.
const loadManifest = (): Promise<Manifest | null> => {
  if (new URLSearchParams(window.location.search).has('night')) return Promise.resolve(null)
  manifest ??= fetch(`${import.meta.env.BASE_URL}audio/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null)
  return manifest
}

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** URL of the pre-recorded read-aloud for this exact draft text, or null when there is none.
 *  `checked` is false until the lookup for the current text finishes, so the UI does not flash
 *  "no recording" while loading, and a stale result is never shown for different text. */
export function useRecordedClip(source: Source, lang: Lang, text: string): { url: string | null; checked: boolean } {
  const id = `${source}_${lang}\n${text}`
  const [done, setDone] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const m = await loadManifest()
      const entry = m?.[`${source}_${lang}`]
      // crypto.subtle is missing on insecure origins; no hash means no proof the text matches, so no recording.
      const match = entry && globalThis.crypto?.subtle ? (await sha256Hex(text)) === entry.sha256 : false
      if (live) setDone({ id, url: match && entry ? `${import.meta.env.BASE_URL}audio/${entry.file}` : null })
    })().catch(() => live && setDone({ id, url: null }))
    return () => { live = false }
  }, [id, source, lang, text])
  return done?.id === id ? { url: done.url, checked: true } : { url: null, checked: false }
}
