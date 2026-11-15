// ?view=brief: the method brief, rendered from docs/brief.md (or docs/brief.es.md in Spanish) so the page and the
// files cannot drift apart. test/brief.test.ts holds the Spanish file to the English one's numbers and links.
import { Fragment, useEffect, type ReactNode } from 'react'
import srcEn from '../../docs/brief.md?raw'
import srcEs from '../../docs/brief.es.md?raw'
import { LANDING_METRICS as M } from './landingMetrics'
import { parseMarkdown, type Block, type Inline } from './md.ts'
import type { Lang } from './i18n'
import { useLang, useT } from './useT'
import './Brief.css'
import './BriefEs.css'

function inline(v: Inline[]): ReactNode {
  return v.map((i, k) => {
    switch (i.t) {
      case 'text': return <Fragment key={k}>{i.v}</Fragment>
      case 'strong': return <strong key={k}>{inline(i.v)}</strong>
      case 'em': return <em key={k}>{inline(i.v)}</em>
      case 'code': return <code key={k}>{i.v}</code>
      case 'link': return <a key={k} href={i.href} rel="noreferrer">{inline(i.v)}</a>
    }
  })
}

const BLOCKS: Record<Lang, Block[]> = { en: parseMarkdown(srcEn), es: parseMarkdown(srcEs) }
// The title and the one-line lede come before the print button, so the page opens on what it is, not on a button.
const lede = (bs: Block[]) => bs.findIndex((b) => b.t === 'p') + 1
// Impact measures live in i18n, not the brief files: they are UI strings with live counts, not part of the method.
const IMPACT = ['sent', 'answers', 'wrong', 'time'] as const

function block(b: Block, k: number): ReactNode {
  switch (b.t) {
    case 'h1': return <h1 key={k}>{inline(b.v)}</h1>
    case 'h2': return <h2 key={k}>{inline(b.v)}</h2>
    case 'h3': return <h3 key={k}>{inline(b.v)}</h3>
    case 'p': return <p key={k}>{inline(b.v)}</p>
    case 'ul': return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
    case 'ol': return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
  }
}

export default function Brief() {
  const t = useT()
  const lang = useLang()
  const blocks = BLOCKS[lang]
  const LEDE = lede(blocks)
  useEffect(() => { document.title = t('brief.docTitle') }, [t])
  return (
    <main className="br-page">
      <article className="br-doc" lang={lang}>
        <p className="br-kicker">{t('brief.kicker')}</p>
        {blocks.slice(0, LEDE).map(block)}
        <p className="br-print">
          <button type="button" className="btn" onClick={() => window.print()}>{t('brief.print')}</button>
          <small>{t('brief.pdfHelp')}</small>
        </p>
        {blocks.slice(LEDE).map((b, k) => block(b, k + LEDE))}
      </article>
      <section className="br-doc br-impact" aria-labelledby="br-impact-title">
        <h2 id="br-impact-title">{t('brief.impact.title')}</h2>
        <p>{t('brief.impact.theory')}</p>
        <ul>
          {IMPACT.map((k) => (
            <li key={k}><strong>{t(`brief.impact.${k}.h`)}</strong> {t(`brief.impact.${k}`, { k: M.auditMissed, n: M.auditNights })}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
