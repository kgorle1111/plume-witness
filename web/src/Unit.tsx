import { type Lang } from './i18n'
import { unitLong, unitShort, unitTitle } from './format'
import { useLang } from './useT'

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
