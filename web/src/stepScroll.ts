/** Whether a step change has to bring the steps panel up. On a phone the tabs sat at 529 of a 664px screen and the
 *  new step's text started below the fold, so a tap looked like it did nothing; a panel already scrolled past the
 *  top (Next at the end of a long step) has to come back too. */
export function shouldScrollToSteps(panelTop: number, viewportHeight: number): boolean {
  return panelTop < 0 || panelTop > viewportHeight * 0.4
}

/** The step a URL hash names, or -1 when it names none (the caller shows the first step and fixes the URL). */
export function stepIndex(hash: string, ids: readonly string[]): number {
  return ids.findIndex((id) => `#${id}` === hash)
}
