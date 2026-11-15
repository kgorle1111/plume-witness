import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inlineText, parseInline, parseMarkdown, type Block, type Inline } from '../src/md.ts'
import { BANNED_WORDS } from '../src/i18n.ts'

const src = readFileSync(new URL('../../docs/brief.md', import.meta.url), 'utf8')
const srcEs = readFileSync(new URL('../../docs/brief.es.md', import.meta.url), 'utf8')
const blocks = parseMarkdown(src)
const blocksEs = parseMarkdown(srcEs)
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
  for (const s of ['60 of 77', '5 of 77', '26 of 410', '95% CI 68-86%', '95% CI 3-14%', '95% CI 4-9%']) assert.ok(t.includes(s), s)
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

/** Every number in a text, in order ("95% CI 61-81%" gives 95, 61, 81). */
const numbersIn = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? []
const EN_REF = 'https://github.com/kgorle1111/plume-witness/blob/main/docs/brief.md'
const walkInline = (v: Inline[], f: (i: Inline) => void): void =>
  v.forEach((i) => { f(i); if (i.t === 'strong' || i.t === 'em' || i.t === 'link') walkInline(i.v, f) })
const inlinesOf = (b: Block): Inline[][] => ('items' in b ? b.items : [b.v])
const hrefs = (bs: Block[]) => bs.flatMap((b) => inlinesOf(b).flatMap((v) => {
  const out: string[] = []
  walkInline(v, (i) => { if (i.t === 'link') out.push(i.href) })
  return out
}))
const codes = (bs: Block[]) => bs.flatMap((b) => inlinesOf(b).flatMap((v) => {
  const out: string[] = []
  walkInline(v, (i) => { if (i.t === 'code') out.push(i.v) })
  return out
}))
/** The blocks under each h2; the title and lede come first, under the heading "". */
const sections = (bs: Block[]) => {
  const out: { h: string; bs: Block[] }[] = [{ h: '', bs: [] }]
  for (const b of bs) {
    if (b.t === 'h2') out.push({ h: inlineText(b.v), bs: [] })
    out[out.length - 1].bs.push(b)
  }
  return out
}
// The Spanish file adds one paragraph the English lacks: the translation note under the lede, linking the English.
const noteAt = blocksEs.findIndex((b) => b.t === 'p' && hrefs([b]).includes(EN_REF))
const es = blocksEs.filter((_, i) => i !== noteAt)

test('the Spanish brief opens with the translation note, right under the lede, pointing to the English', () => {
  assert.equal(noteAt, 2, 'note is not the paragraph after the title and lede')
  const note = inlineText((blocksEs[noteAt] as { v: Inline[] }).v)
  assert.match(note, /asistida por computadora/)
  assert.match(note, /no revisada por un lector de la comunidad/)
  assert.deepEqual(numbersIn(note), [], 'the note must not add a number')
})

test('the Spanish brief has the English structure: same headings, blocks, list lengths', () => {
  for (const h of ['h1', 'h2', 'h3'] as const)
    assert.equal(es.filter((b) => b.t === h).length, blocks.filter((b) => b.t === h).length, `${h} count`)
  assert.deepEqual(es.map((b) => b.t), blocks.map((b) => b.t), 'block sequence')
  es.forEach((b, i) => {
    if ('items' in b) assert.equal(b.items.length, (blocks[i] as { items: unknown[] }).items.length, `list ${i} length`)
  })
})

test('every number in the Spanish brief is the English number, in order, section by section', () => {
  const en = sections(blocks)
  const sp = sections(es)
  assert.equal(sp.length, en.length)
  en.forEach((s, i) =>
    assert.deepEqual(numbersIn(allText(sp[i].bs)), numbersIn(allText(s.bs)), `section "${s.h || 'title'}" / "${sp[i].h || 'título'}"`))
})

test('the Spanish brief cites the same links and code, in the same order', () => {
  assert.deepEqual(hrefs(es), hrefs(blocks))
  assert.deepEqual(codes(es), codes(blocks))
  // Raw source too, so a link md.ts would drop (non-https) cannot slip past the parsed comparison.
  const targets = [...srcEs.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
  assert.deepEqual(targets.filter((t) => t !== EN_REF), [...src.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]))
})

test('the Spanish brief carries no banned verdict word', () => {
  for (const re of BANNED_WORDS) assert.ok(!re.test(srcEs), `${re} in docs/brief.es.md`)
})

test('on paper only the Sources line spells out its URLs, so every other Reproducibility link shows its address', () => {
  // Brief.css prints " <href>" after links in the last item of the closing list only.
  const at = blocks.findIndex((b) => b.t === 'h2' && inlineText(b.v) === 'Reproducibility')
  const list = blocks[at + 1]
  assert.ok(at >= 0 && 'items' in list && list.t === 'ul' && blocks.slice(at + 2).every((b) => b.t !== 'ul'), 'Reproducibility is not the last list')
  assert.match(inlineText(list.items.at(-1)!), /^Sources:/)
  const bare = (s: string) => s.replace(/^https:\/\//, '').replace(/\/$/, '')
  for (const it of list.items.slice(0, -1))
    for (const i of it) if (i.t === 'link') assert.equal(bare(inlineText(i.v)), bare(i.href), `link text hides its address on paper: ${i.href}`)
})

test('the brief stays inside the word budget that prints on 2 Letter / A4 pages', () => {
  // kn: a word count stands in for the page count. Measured 2026-11-15 with Chrome page.pdf at 1432 words: 2 pages in
  // EN and ES, Letter and A4, with 84pt (about 7 lines) spare on the tightest, ES Letter. The budget leaves about half of
  // that for other browsers' fonts. Rendering the PDF in CI would replace this guess with the real count.
  const words = src.split(/\s+/).filter(Boolean).length
  assert.ok(words <= 1480, `brief.md is ${words} words; over 1480 it can spill onto a third printed page`)
})
