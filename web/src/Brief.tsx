// ?view=brief: the method brief, rendered from docs/brief.md so the page and the file cannot drift apart.
import { Fragment, useEffect, type ReactNode } from 'react'
import src from '../../docs/brief.md?raw'
import { LANDING_METRICS as M } from './landingMetrics'
import { parseMarkdown, type Inline } from './md.ts'
import { useLang, useT } from './useT'
import './Brief.css'

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

const blocks = parseMarkdown(src)
// Impact measures live in i18n, not brief.md, so Spanish readers get them in Spanish while the brief stays English.
const IMPACT = ['sent', 'answers', 'wrong', 'time'] as const

export default function Brief() {
  useEffect(() => { document.title = 'Method brief · Plume Witness' }, [])
  const t = useT()
  const lang = useLang()
  return (
    <main className="br-page">
      <div className="br-bar">
        <span className="br-print">
          <button type="button" onClick={() => window.print()}>{t('brief.print')}</button>
          <small>{t('brief.pdfHelp')}</small>
        </span>
      </div>
      {lang === 'es' && <p className="br-en-note" role="note">{t('brief.english')}</p>}
      <article className="br-doc" lang="en">
        {blocks.map((b, k) => {
          switch (b.t) {
            case 'h1': return <h1 key={k}>{inline(b.v)}</h1>
            case 'h2': return <h2 key={k}>{inline(b.v)}</h2>
            case 'h3': return <h3 key={k}>{inline(b.v)}</h3>
            case 'p': return <p key={k}>{inline(b.v)}</p>
            case 'ul': return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
            case 'ol': return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
          }
        })}
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
