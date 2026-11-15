// Which corridor facilities the Trace step shows before "Show all". Self-contained so `node --test` can load it.

/**
 * Corridor positions (0-based, list order) to show first: the nearest `n`, plus every entry for the facility with the
 * filed report when it sits further out. The whole list when hiding it would save fewer than two cards.
 */
export function shortlist(ids: readonly string[], matchedId: string | null | undefined, n = 5): number[] {
  const all = ids.map((_, i) => i)
  const picked = all.filter((i) => i < n || (matchedId != null && ids[i] === matchedId))
  return ids.length - picked.length < 2 ? all : picked
}
