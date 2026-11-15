// Link previews: the 1200x630 image, the site-wide og: tags in index.html, and one stub page per listed night
// (share/stubs.ts) that unfurls with that night's own words and sends a person on to the replay.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collectNights } from '../share/collect.ts'
import { OG_IMAGE, OG_IMAGE_ALT, PAGES_URL, STUB_ID, describe, escapeHtml, replayHref, statusWords, stubHtml, stubPath, type StubNight } from '../share/stubs.ts'
import { shareUrl } from '../src/shareLink.ts'
import { STATUS_TEXT, statusLabel } from '../src/format.ts'
import { NIGHT_ID } from '../src/routes.ts'
import { BANNED_WORDS } from '../src/i18n.ts'
import { precacheList } from '../pwa/precache.ts'

const pub = fileURLToPath(new URL('../public/', import.meta.url))
const nights = collectNights(pub)

/** The value of `<meta property|name="key" content="...">`, still escaped as written. */
const meta = (html: string, key: string): string | undefined =>
  new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`).exec(html)?.[1]
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, c: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[c]!)

test('every night file in every region is listed, and each listed night gets exactly one stub', () => {
  const files = (dir: string) => readdirSync(new URL(dir, `file://${pub}`)).filter((f) => f !== 'index.json').map((f) => f.replace(/\.json$/, ''))
  const expected = [...files('nights/'), ...readdirSync(new URL('regions/', `file://${pub}`)).flatMap((r) => files(`regions/${r}/nights/`))]
  assert.deepEqual(nights.map((n) => n.id).sort(), expected.sort())
  assert.ok(nights.length > 400, `only ${nights.length} nights`)
  assert.ok(nights.some((n) => n.region === 'beaumont'), 'a second region is covered')
  assert.equal(new Set(nights.map((n) => stubPath(n.id))).size, nights.length)
})

test('each stub redirects three ways to its own replay and names itself as og:url', () => {
  for (const n of nights) {
    const html = stubHtml(n)
    const target = `../?night=${n.id}&intro=0${n.region === 'houston' ? '' : `&region=${n.region}`}#detect`
    assert.equal(replayHref(n), target)
    assert.ok(html.includes(`<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">`), `${n.id}: meta refresh`)
    assert.ok(html.includes(`<a id="go" href="${escapeHtml(target)}">`), `${n.id}: visible link`)
    assert.match(html, /location\.replace\(u\.href\)/)
    assert.equal(meta(html, 'og:url'), `${PAGES_URL}s/${n.id}.html`)
    assert.equal(meta(html, 'og:image'), PAGES_URL + OG_IMAGE)
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
    const { title, description } = describe(n)
    assert.equal(unescape(meta(html, 'og:title')!), `${title} · Plume Witness`)
    assert.equal(unescape(meta(html, 'og:description')!), description)
    for (const re of BANNED_WORDS) assert.ok(!re.test(title) && !re.test(description), `${n.id}: ${description}`)
  }
})

test('the description reads the night in plain words: monitor, compound, value against usual, status', () => {
  const n = nights.find((x) => x.id === '2024-01-04_43218_48_201_0069')!
  assert.deepEqual(describe(n), {
    title: '1,3-butadiene spike at Houston Milby Park, Jan 4, 2024',
    description: 'The Houston Milby Park air monitor read 10.75 ppb of 1,3-butadiene at 17:00 CST on Jan 4, 2024, '
      + 'about 154× its usual level of 0.07 ppb. State record check: Search incomplete.',
  })
  const q = describe({ ...n, status: 'no_report_after_deadline', baseline: 0 }).description
  assert.match(q, /its usual level was 0 ppb\. State record check: No matching report \(a question\)\.$/)
  assert.doesNotMatch(describe({ ...n, baseline: null }).description, /usual/)
})

test('every data value is HTML-escaped, in text and in attributes', () => {
  const evil: StubNight = {
    id: '2024-01-04_43218_48_201_0069', region: 'houston', date: '2024-01-04', hour_cst: 3,
    site_name: `Bob's "Plant" & <Co></title><script>alert(1)</script>`, compound: 'a&b "c"', value: 12, baseline: 1,
    units: 'ppb-v', status: `x" onload="alert(1)`,
  }
  const html = stubHtml(evil)
  assert.ok(!html.includes('<script>alert(1)'), 'raw tag passed through')
  assert.ok(!html.includes('"Plant"') && !html.includes('onload="'), 'a quote ended an attribute')
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(html.replace(/<script>[\s\S]*?<\/script>/, '')), 'bare ampersand')
  assert.ok(html.includes('Bob&#39;s &quot;Plant&quot; &amp; &lt;Co&gt;&lt;/title&gt;'))
  assert.equal(unescape(meta(html, 'og:description')!), describe(evil).description)
  assert.equal((html.match(/<script>/g) ?? []).length, 1)
  assert.throws(() => stubHtml({ ...evil, id: '../../index' }), /not a night id/)
})

test('status words match the app (src/format.ts) for every status the contract has', () => {
  for (const s of Object.keys(STATUS_TEXT)) assert.equal(statusWords(s), statusLabel(s, 'en'), s)
  assert.equal(statusWords('toString'), 'Unknown status (toString)')
})

test('shareUrl: the stub for a listed night, keeping a step other than Detect; null when there is no stub', () => {
  assert.equal(STUB_ID.source, NIGHT_ID.source)
  const id = '2024-01-04_43218_48_201_0069'
  assert.equal(shareUrl('/plume-witness/', 'https://kgorle1111.github.io', id), `${PAGES_URL}s/${id}.html`)
  assert.equal(shareUrl('/', 'http://localhost:4415', id, 'check'), `http://localhost:4415/s/${id}.html#check`)
  assert.equal(shareUrl('/', 'http://x', id, 'detect'), `http://x/s/${id}.html`)
  assert.equal(shareUrl('/', 'http://x', id, 'bogus'), `http://x/s/${id}.html`)
  for (const bad of [null, undefined, '', 'steers-425347', '../x']) assert.equal(shareUrl('/', 'http://x', bad), null)
})

test('og-image.png is a 1200x630 PNG and index.html points every unfurler at it', () => {
  const png = readFileSync(new URL(`../public/${OG_IMAGE}`, import.meta.url))
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG')
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630])
  assert.ok(png.length < 300_000, `${png.length} bytes`)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.equal(meta(html, 'og:image'), PAGES_URL + OG_IMAGE)
  assert.equal(meta(html, 'og:url'), PAGES_URL)
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
  assert.equal(meta(html, 'og:image:width'), '1200')
  assert.equal(meta(html, 'og:image:height'), '630')
  assert.equal(meta(html, 'og:image:alt'), OG_IMAGE_ALT)
  for (const k of ['og:title', 'og:description', 'og:type', 'og:site_name', 'description']) assert.ok(meta(html, k), k)
  assert.equal(meta(html, 'og:description'), meta(html, 'description'))
})

test('stubs and the preview image stay out of the service-worker precache', () => {
  const list = precacheList(['index.html', OG_IMAGE, 's/2024-01-04_43218_48_201_0069.html', 'nights/index.json'])
  assert.deepEqual(list, ['./', 'nights/index.json'])
})

const dist = new URL('../dist/', import.meta.url)
test('dist: one stub per listed night, as rendered, none precached', { skip: !existsSync(dist) && 'run npm run build first' }, () => {
  const stubs = readdirSync(new URL('s/', dist)).sort()
  assert.deepEqual(stubs, nights.map((n) => `${n.id}.html`).sort())
  for (const n of nights) assert.equal(readFileSync(new URL(stubPath(n.id), dist), 'utf8'), stubHtml(n), n.id)
  assert.ok(existsSync(new URL(OG_IMAGE, dist)))
  const { urls } = JSON.parse(readFileSync(new URL('precache.json', dist), 'utf8')) as { urls: string[] }
  assert.ok(!urls.some((u) => u.startsWith('s/') || u === OG_IMAGE), 'a stub or the preview image is precached')
})
