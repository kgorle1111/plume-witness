import './LangSwitch.css'
import { Fragment, type ReactNode } from 'react'
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
export function LangSwitch({ compact = true }: { compact?: boolean }) {
  const lang = useLang()
  const t = useT()
  return (
    <div className="lang-switch">
      <div className={compact ? 'seg seg-compact' : 'seg'} role="group" aria-label={t('common.langGroup')}>
        <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">English</button>
        <button type="button" aria-pressed={lang === 'es'} onClick={() => setLang('es')} lang="es">Español</button>
      </div>
    </div>
  )
}
