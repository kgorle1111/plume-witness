// A deliberately tiny Markdown reader for docs/brief.md: headings, paragraphs, - and 1. lists, **bold**, *italic*,
// `code` and [text](https://...). It returns data, never HTML, so nothing in the file can inject markup.
// kn: covers only the syntax the brief uses; a table or nested list in brief.md renders as plain text.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: Inline[] }
  | { t: 'em'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: Inline[] }

export type Block =
  | { t: 'h1' | 'h2' | 'h3'; v: Inline[] }
  | { t: 'p'; v: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }

const TOKEN = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let rest = s
  while (rest) {
    const m = TOKEN.exec(rest)
    if (!m) { out.push({ t: 'text', v: rest }); break }
    if (m.index) out.push({ t: 'text', v: rest.slice(0, m.index) })
    if (m[1] !== undefined) out.push({ t: 'strong', v: parseInline(m[1]) })
    else if (m[2] !== undefined) out.push({ t: 'em', v: parseInline(m[2]) })
    else if (m[3] !== undefined) out.push({ t: 'code', v: m[3] })
    else if (/^https?:\/\//.test(m[5])) out.push({ t: 'link', href: m[5], v: parseInline(m[4]) })
    else out.push({ t: 'text', v: m[4] }) // relative or non-http link: keep the words, drop the target
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', v: parseInline(para.join(' ')) })
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) })
    para = []
    list = null
  }
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const h = /^(#{1,3}) (.*)$/.exec(line)
    const ul = /^- (.*)$/.exec(line)
    const ol = /^\d+\. (.*)$/.exec(line)
    if (!line.trim()) flush()
    else if (h) { flush(); blocks.push({ t: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], v: parseInline(h[2]) }) }
    else if (ul || ol) {
      const t = ul ? 'ul' : 'ol'
      if (para.length || (list && list.t !== t)) flush()
      list ??= { t, items: [] }
      list.items.push((ul ?? ol)![1])
    } else if (list && /^\s+\S/.test(raw)) list.items[list.items.length - 1] += ' ' + line.trim()
    else { if (list) flush(); para.push(line.trim()) }
  }
  flush()
  return blocks
}

export function inlineText(v: Inline[]): string {
  return v.map((i) => (i.t === 'text' || i.t === 'code' ? i.v : inlineText(i.v))).join('')
}
