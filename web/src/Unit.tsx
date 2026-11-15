import { type Lang } from './i18n'
import { decimalParts, unitLong, unitShort, unitTitle } from './format'
import { useLang } from './useT'
import './Unit.css'

/** A concentration unit in running text: "ppb" with a tooltip that explains "ppb-v"; `first` spells it out once
 *  per page ("parts per billion by volume (ppb)" for ppb-v data). `lang` pins the language for panels whose prose isn't translated yet. */
export function Unit({ units, first = false, lang }: { units: string; first?: boolean; lang?: Lang }) {
  const site = useLang()
  const l = lang ?? site
  const title = unitTitle(units, l)
  if (!title) return <>{units}</>
  const abbr = <abbr title={title}>{unitShort(units)}</abbr>
  return first ? <>{unitLong(units, l)} ({abbr})</> : abbr
}

/** A number in a right-aligned table column, its digits exactly as the data writes them, with its decimal point in
 *  line with the column's. `frac` is the column's most decimals (format.ts maxFracDigits). The digits a value lacks
 *  (and the "." of a whole number) are drawn after it by an invisible CSS pad, so the visible text, the copied text and
 *  the accessible name stay just the number. A null value is a dash in the whole-number place. */
export function Num({ value, frac, suffix = '', group = false }: { value: number | null; frac: number; suffix?: string; group?: boolean }) {
  if (value === null) {
    const pad = `${frac > 0 ? `.${'0'.repeat(frac)}` : ''}${suffix}`
    return <span className="dnum">—{pad && <span className="dnum-pad" data-pad={pad} />}</span>
  }
  const { int, frac: dec } = decimalParts(value, group)
  const have = dec ? dec.length - 1 : 0
  const pad = frac > have ? `${dec ? '' : '.'}${'0'.repeat(frac - have)}` : ''
  return <span className="dnum">{int}{dec}{pad && <span className="dnum-pad" data-pad={pad} />}{suffix}</span>
}
