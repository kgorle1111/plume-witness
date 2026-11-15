/** Why a replay file did not load, in words a reader can act on. The engine text ("Failed to fetch", a JSON parse
 *  error, a schema list) stays available as `detail` for a bug report, never as the message. */
export type LoadErrorKind = 'offline' | 'network' | 'notFound' | 'damaged' | 'noNights'

export class LoadError extends Error {
  kind: LoadErrorKind
  constructor(kind: LoadErrorKind, detail: string) {
    super(detail)
    this.kind = kind
  }
}

/** A non-OK response, or an HTML page where JSON was expected (a static host's SPA fallback for a missing file). */
export function responseError(file: string, status: number, contentType: string | null): LoadError | null {
  if (status === 404 || status === 410) return new LoadError('notFound', `${file}: HTTP ${status}`)
  if (status < 200 || status >= 300) return new LoadError('network', `${file}: HTTP ${status}`)
  if (contentType?.includes('text/html')) return new LoadError('notFound', `${file}: got an HTML page, not JSON`)
  return null
}

export function classifyLoadError(e: unknown, online: boolean): { kind: LoadErrorKind; detail: string } {
  const detail = e instanceof Error ? e.message : String(e)
  if (e instanceof LoadError) return { kind: e.kind, detail }
  // fetch() rejects with a TypeError only when no response arrived at all.
  if (e instanceof TypeError) return { kind: online ? 'network' : 'offline', detail }
  // A JSON parse error or parseEvent's missing-field error: the file arrived but cannot be shown.
  return { kind: 'damaged', detail }
}

/** A lazy chunk that failed to import. After a deploy the old hashed file is gone (404) and only a reload fixes it. */
export function chunkUrl(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e)
  if (!/dynamically imported module|module script failed|Importing a module script/i.test(msg)) return null
  return msg.match(/https?:\/\/\S+?\.js\b/)?.[0] ?? null
}
