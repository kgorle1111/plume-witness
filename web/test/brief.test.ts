import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inlineText, parseInline, parseMarkdown, type Block } from '../src/md.ts'

const src = readFileSync(new URL('../../docs/brief.md', import.meta.url), 'utf8')
const blocks = parseMarkdown(src)
const allText = (bs: Block[]) =>
  bs.map((b) => ('items' in b ? b.items.map(inlineText).join('\n') : inlineText(b.v))).join('\n')

test('inline: bold, code, https link; a non-http link keeps its words but loses its target', () => {
  assert.deepEqual(parseInline('a **b** `c` [d](https://x.org/y)'), [
    { t: 'text', v: 'a ' }, { t: 'strong', v: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' },
    { t: 'code', v: 'c' }, { t: 'text', v: ' ' }, { t: 'link', href: 'https://x.org/y', v: [{ t: 'text', v: 'd' }] },
  ])
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ t: 'text', v: 'x' }, { t: 'text', v: ')' }])
})

test('blocks: heading, list run, paragraph, numbered list', () => {
  const b = parseMarkdown('# T\n\n- one\n- two\npara\n\n1. a\n2. b\n')
  assert.deepEqual(b.map((x) => x.t), ['h1', 'ul', 'p', 'ol'])
  assert.equal((b[1] as { items: unknown[] }).items.length, 2)
})

test('the brief renders every section it promises, with one title', () => {
  assert.equal(blocks.filter((b) => b.t === 'h1').length, 1)
  const h2 = blocks.filter((b) => b.t === 'h2').map((b) => inlineText((b as { v: never }).v))
  for (const s of ['The question', 'Findings', 'What it does not show', 'What would close the gap', 'Limits', 'Reproducibility'])
    assert.ok(h2.some((h) => h.startsWith(s)), `missing section ${s}`)
})

test('the brief keeps its headline numbers with their denominators', () => {
  const t = allText(blocks)
  for (const s of ['52 of 72', '3 of 72', '19 of 386', '95% CI 61-81%', '95% CI 1-12%', '95% CI 3-8%']) assert.ok(t.includes(s), s)
})

test('the brief avoids words that assert wrongdoing or proof', () => {
  for (const w of ['illegal', 'violation', 'unreported', 'caught', 'polluter', 'proves'])
    assert.ok(!new RegExp(`\\b${w}`, 'i').test(src), `banned word: ${w}`)
})

test('every link in the brief survives as an https citation (none silently dropped)', () => {
  const targets = [...src.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
  assert.ok(targets.length > 0)
  for (const t of targets) assert.match(t, /^https:\/\//, t)
})

test('a bracketed citation link keeps its brackets outside the link text', () => {
  const href = 'https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md'
  assert.deepEqual(parseInline(`overlap. [[detector.md](${href})]`), [
    { t: 'text', v: 'overlap. [' }, { t: 'link', href, v: [{ t: 'text', v: 'detector.md' }] }, { t: 'text', v: ']' },
  ])
  // No link in the brief swallows a neighbouring bracket.
  const links: string[] = []
  const walk = (v: ReturnType<typeof parseInline>) => v.forEach((i) => { if (i.t === 'link') links.push(inlineText(i.v)); else if (i.t === 'strong' || i.t === 'em') walk(i.v) })
  blocks.forEach((b) => ('items' in b ? b.items.forEach(walk) : walk(b.v)))
  assert.ok(links.length > 5)
  for (const l of links) assert.ok(!/^\[|\]$/.test(l), `link text carries a bracket: ${l}`)
})
