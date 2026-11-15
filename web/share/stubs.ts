// Per-night link-preview pages. GitHub Pages serves files only and unfurlers (Slack, iMessage, X, Facebook) do not run
// JS, so each night gets a tiny static page at s/<night id>.html carrying its own og: tags, which sends a person on to
// the replay. Pure (no node: imports) so the build plugin, the app's share helper and node --test can all load it.
// Status words must equal the app's (src/format.ts statusLabel); test/linkPreviews.test.ts pins them.

/** The deployed site; og:url and og:image must be absolute, and unfurlers only ever see the Pages copy. */
export const PAGES_URL = 'https://kgorle1111.github.io/plume-witness/'
export const OG_IMAGE = 'og-image.png'
export const OG_IMAGE_ALT = 'Plume Witness: a monitor dot on a map with the upwind wedge it reads from. Checks Texas air-monitor spikes against companies’ own pollution reports.'

/** Same shape as src/routes.ts NIGHT_ID (pinned by test); anything else never gets a stub. */
export const STUB_ID = /^\d{4}-\d{2}-\d{2}_\d{5}_[\d_]+$/
export const stubPath = (id: string): string => `s/${id}.html`

/** Replay steps a stub link may carry in its hash (#check opens the record check); anything else opens Detect. */
export const STUB_STEPS = ['detect', 'trace', 'check', 'packet'] as const

export interface StubNight {
  id: string
  /** Region key; 'houston' keeps the replay URL without ?region=, as the app does. */
  region: string
  date: string
  hour_cst: number
  site_name: string
  compound: string
  value: number
  /** The monitor's usual level (7-day median) from the night file; null when the file has none. */
  baseline: number | null
  units: string
  status: string
}

const STATUS_WORDS: Record<string, string> = {
  reported: 'Reported',
  reported_late: 'Filed after the window',
  not_yet_reported: 'Not yet reported',
  no_report_after_deadline: 'No matching report (a question)',
  reported_mismatch: "Reported, but doesn't match",
  search_incomplete: 'Can’t say',
  reported_nrc: 'Reported to NRC',
}
export const statusWords = (s: string): string =>
  Object.hasOwn(STATUS_WORDS, s) ? STATUS_WORDS[s] : `Unknown status (${s})`

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** For text and double- or single-quoted attributes alike. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dateWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso
}
const unitShort = (u: string) => (/^ppb(-?v)?$/i.test(u.trim()) ? 'ppb' : u)
const cap = (s: string) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s)

/** The replay URL, relative to the stub (s/ is one level below the site root, whatever the build base). */
export function replayHref(n: Pick<StubNight, 'id' | 'region'>): string {
  const q = new URLSearchParams({ night: n.id, intro: '0' })
  if (n.region !== 'houston') q.set('region', n.region)
  return `../?${q}#detect`
}

/** Title and description in plain words: what the monitor read, against its usual level, and the record status. */
export function describe(n: StubNight): { title: string; description: string } {
  const unit = unitShort(n.units)
  const title = `${cap(n.compound)} spike at ${n.site_name}, ${dateWords(n.date)}`
  const usual = n.baseline === null ? ''
    : n.baseline > 0
      ? `, about ${Math.round(n.value / n.baseline).toLocaleString('en-US')}× its usual level of ${n.baseline} ${unit}`
      : `; its usual level was ${n.baseline} ${unit}`
  const description = `The ${n.site_name} air monitor read ${n.value} ${unit} of ${n.compound} at `
    + `${String(n.hour_cst).padStart(2, '0')}:00 CST on ${dateWords(n.date)}${usual}. `
    + `State record check: ${statusWords(n.status)}.`
  return { title, description }
}

export function stubHtml(n: StubNight): string {
  if (!STUB_ID.test(n.id)) throw new Error(`not a night id: ${n.id}`)
  const { title, description } = describe(n)
  const e = escapeHtml
  const href = e(replayHref(n))
  const self = e(`${PAGES_URL}${stubPath(n.id)}`)
  const full = e(`${title} · Plume Witness`)
  // The anchor is the one copy of the target; the script reads it back, so no data value is ever inside the script.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<meta name="description" content="${e(description)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Plume Witness">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${full}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${self}">
<meta property="og:image" content="${e(PAGES_URL + OG_IMAGE)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${href}">
<style>body{margin:0;padding:24px 16px;font:16px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#214349;background:#fff}a{color:#36666d}</style>
</head>
<body>
<p>${e(description)}</p>
<p><a id="go" href="${href}">Open this spike in Plume Witness</a></p>
<script>
var u = new URL(document.getElementById('go').href)
if (/^#(${STUB_STEPS.join('|')})$/.test(location.hash)) u.hash = location.hash
location.replace(u.href)
</script>
</body>
</html>
`
}
