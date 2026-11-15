import './LangSwitch.css'
import { Fragment, useId, useState, type ReactNode } from 'react'
import { STRINGS, fmt, setLang, type StringKey, type Vars } from './i18n'
import { useLang, useT } from './useT'

/** A string with `{slot}`s filled by React nodes (links, code) and `**bold**` runs. Plain strings use useT(). */
export function T({ k, v }: { k: StringKey; v?: Record<string, ReactNode> }) {
  const lang = useLang()
  const parts = STRINGS[lang][k].split(/(\*\*[^*]+\*\*|\{\w+\})/)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**')) return <strong key={i}>{fmtNodes(p.slice(2, -2), v)}</strong>
        return <Fragment key={i}>{fmtNodes(p, v)}</Fragment>
      })}
    </>
  )
}

function fmtNodes(p: string, v?: Record<string, ReactNode>): ReactNode {
  const m = /^\{(\w+)\}$/.exec(p)
  if (m && v && m[1] in v) return v[m[1]]
  // Slots inside a bold run are plain text.
  const plain: Vars = {}
  for (const [k, n] of Object.entries(v ?? {})) if (typeof n === 'string' || typeof n === 'number') plain[k] = n
  return fmt(p, plain)
}

/** The same two-button group as the stepper's switch; every page shares one language setting. */
export function LangSwitch({ note = true, compact = true }: { note?: boolean; compact?: boolean }) {
  const lang = useLang()
  const t = useT()
  const [noteOpen, setNoteOpen] = useState(false)
  const noteId = useId()
  const showNote = note && lang === 'es'
  return (
    <div className="lang-switch">
      {/* Phones only (LangSwitch.css): the three-line note made the Spanish header 193px of 812, so it folds behind
          this button, which sits left of the switch on the switch's own row. Before the switch, so Tab follows what
          the eye sees. Wider screens hide the button and always show the note. */}
      {showNote && (
        <button type="button" className="es-note-toggle" aria-expanded={noteOpen} aria-controls={noteId}
          onClick={() => setNoteOpen((o) => !o)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 7v4.5M8 4.5v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {t('common.reviewToggle')}
        </button>
      )}
      <div className={compact ? 'seg seg-compact' : 'seg'} role="group" aria-label={t('common.langGroup')}>
        <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">English</button>
        <button type="button" aria-pressed={lang === 'es'} onClick={() => setLang('es')} lang="es">Español</button>
      </div>
      {showNote && <ReviewNote id={noteId} className={`muted small es-note${noteOpen ? '' : ' es-note-folded'}`} />}
    </div>
  )
}

export function ReviewNote({ className = 'muted small es-note', id }: { className?: string; id?: string }) {
  return (
    <p className={className} id={id}>
      <span lang="es">{STRINGS.es['common.reviewNote']}</span> <span lang="en">({STRINGS.en['common.reviewNote']})</span>
    </p>
  )
}
