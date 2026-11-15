// Run: npm test. Phone and narrow-desktop layout budgets measured with Playwright on 2026-11-15 (fix/phone-replay).
// CSS cannot be laid out under node --test, so these pin the rules against the measured heights they depend on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
/** The body of the first `@media <query> { ... }` block (one level of nested rules). */
function media(css: string, query: string): string {
  const at = css.indexOf(`@media ${query} {`)
  assert.ok(at >= 0, `no @media ${query}`)
  const body = css.slice(at)
  const end = body.search(/\n}\n/)
  return body.slice(0, end)
}

test('320x568: the step tabs end above the fold (header 162 + map + play block 178 + stepper 69 <= 568)', () => {
  const block = media(src('App.css'), '(max-width: 640px) and (max-height: 600px)')
  const svh = Number(/height:\s*([\d.]+)svh/.exec(block)?.[1])
  const floor = Number(/min-height:\s*([\d.]+)px/.exec(block)?.[1])
  assert.ok(svh > 0 && floor > 0, block)
  const map = Math.max(568 * svh / 100, floor)
  assert.ok(162 + map + 178 + 69 <= 568, `map ${map}px pushes the stepper to ${162 + map + 178 + 69}px`)
  // It must come after the 32svh phone rule, which has the same specificity.
  const css = src('App.css')
  assert.ok(css.indexOf('(max-width: 640px) and (max-height: 600px)') > css.indexOf('.stage .map-wrap { height: 32vh; height: 32svh; }'))
})

test('landscape phones and tablets: the calendar strip keeps 900px (2.46 px a day), not 900px minus the name column', () => {
  const block = media(src('SpikeLog.css'), '(min-width: 640px) and (max-width: 1023.98px)')
  assert.match(block, /\.sl-cal-year\s*{\s*min-width:\s*calc\(900px \+ 10\.5rem \+ 8px\)/)
  // The name column it adds back is the one the row grid gives it.
  assert.match(src('SpikeLog.css'), /\.sl-cal-row { display: grid; grid-template-columns: 10\.5rem 1fr; align-items: center; gap: 8px; }/)
})

test('1024-1279px replay footer: the licence line gets its own row (Spanish was 279px tall at 1024x768)', () => {
  const block = media(src('App.css'), '(min-width: 1024px) and (max-width: 1279.98px)')
  assert.match(block, /\.app \.site-foot\s*{[^}]*flex-wrap:\s*wrap/)
  assert.match(block, /\.app \.site-foot > span\s*{\s*flex:\s*1 0 100%/)
})

test('the filing dialog shows the same preview link the copied note carries', () => {
  const steps = src('Steps.tsx')
  assert.match(steps, /const replayUrl = noteShareUrl\(import\.meta\.env\.BASE_URL, location\.href\) \?\? noteUrl\(location\.href\)/)
  assert.match(steps, /<a href=\{replayUrl\}>\{replayUrl\}<\/a>/)
  assert.match(steps, /incidentNote\(ev, replayUrl, lang\)/)
})

test('each step reads title first, then its limits as a neutral note (not the orange box above the title)', () => {
  const app = src('App.tsx')
  const h2 = app.indexOf('<h2 key={step}>'), limits = app.indexOf('<CannotSay items=')
  assert.ok(h2 > 0 && limits > h2, 'CannotSay renders after the step heading')
  const block = /\.cannot-say \{[^}]*\}/.exec(src('App.css'))?.[0] ?? ''
  assert.doesNotMatch(block, /peach/, block)
})

test('Back/Next, and Approve/File on Packet, stick to the bottom of the step on screens taller than 500px', () => {
  const css = src('App.css')
  const tall = media(css, '(min-height: 501px)')
  assert.match(tall, /\.step-nav \{\s*position: sticky; bottom: 0;/)
  assert.match(media(css, '(min-height: 700px)'), /\.file-steps \{\s*position: sticky; bottom: 0;/)
  // With the limits inside the step, scroll anchoring to the swapped step put the ES Trace heading 10px under the
  // stepper at 320x568 (y 59, stepper bottom 69); every tab change now lands it at 83.
  assert.match(css, /\.step-panel \{ overflow-anchor: none; \}/)
})

test('Past spikes: the calendar legend comes before the strips it explains', () => {
  const cal = src('SpikeCalendar.tsx')
  assert.ok(cal.indexOf('className="sl-cal-legend"') < cal.indexOf('className="sl-cal-scroll"'))
})
