// ?view=brief: the method brief, rendered from docs/brief.md so the page and the file cannot drift apart.
import { Fragment, useEffect, type ReactNode } from 'react'
import src from '../../docs/brief.md?raw'
import { LANDING_METRICS as M } from './landingMetrics'
import { BRIEF_ES } from './briefEs'
import { parseMarkdown, type Block, type Inline } from './md.ts'
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
// The title and the one-line lede come before the print button, so the page opens on what it is, not on a button.
const LEDE = blocks.findIndex((b) => b.t === 'p') + 1
// Impact measures live in i18n, not brief.md, so Spanish readers get them in Spanish while the brief stays English.
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

/** The answer and the limits in Spanish, above the English sections they translate. Screen only: paper keeps two pages. */
function SpanishSummary() {
  const t = useT()
  return (
    <section className="br-es" lang="es" aria-labelledby="br-es-title">
      <p className="br-en-note" role="note">{t('brief.english')}</p>
      <h2 id="br-es-title">{BRIEF_ES.title}</h2>
      {BRIEF_ES.sections.map((s) => {
        const List = s.ordered ? 'ol' : 'ul'
        return (
          <Fragment key={s.en}>
            <h3>{s.title}</h3>
            <List>{s.items.map((it) => <li key={it}>{it}</li>)}</List>
          </Fragment>
        )
      })}
    </section>
  )
}

export default function Brief() {
  const t = useT()
  const lang = useLang()
  useEffect(() => { document.title = t('brief.docTitle') }, [t])
  return (
    <main className="br-page">
      <article className="br-doc" lang="en">
        <p className="br-kicker" lang={lang}>{t('brief.kicker')}</p>
        {blocks.slice(0, LEDE).map(block)}
        <p className="br-print" lang={lang}>
          <button type="button" className="btn" onClick={() => window.print()}>{t('brief.print')}</button>
          <small>{t('brief.pdfHelp')}</small>
        </p>
        {lang === 'es' && <SpanishSummary />}
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
