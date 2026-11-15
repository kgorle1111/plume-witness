// ?view=brief: the method brief, rendered from docs/brief.md so the page and the file cannot drift apart.
import { Fragment, type ReactNode } from 'react'
import src from '../../docs/brief.md?raw'
import { parseMarkdown, type Inline } from './md.ts'
import { LangSwitch } from './LangSwitch'
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

export default function Brief() {
  const t = useT()
  const lang = useLang()
  return (
    <main className="br-page">
      <nav className="br-bar" aria-label={t('brief.actions')}>
        <a href={import.meta.env.BASE_URL}>{t('common.backReplay')}</a>
        <a href={`${import.meta.env.BASE_URL}?view=spikes`}>{t('brief.spikesLog')}</a>
        <LangSwitch />
        <span className="br-print">
          <button type="button" onClick={() => window.print()}>{t('brief.print')}</button>
          <small>{t('brief.pdfHelp')}</small>
        </span>
      </nav>
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
    </main>
  )
}
