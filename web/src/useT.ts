import { useCallback, useSyncExternalStore } from 'react'
import { getLang, subscribeLang, translate, type Lang, type StringKey, type Vars } from './i18n'

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang)
}

export type Translate = (key: StringKey, vars?: Vars) => string

export function useT(): Translate {
  const lang = useLang()
  return useCallback((key, vars) => translate(lang, key, vars), [lang])
}
