/**
 * Moves focus to the page's h1 (or its <main>) once it has rendered: after the skip link, and after Back/Forward
 * swaps the page, so a keyboard or screen-reader user starts on the new page instead of <body>. Lazy pages show a
 * busy <main> first, so this waits up to 4 s. Returns a cancel function.
 */
export function focusMainHeading(): () => void {
  let tries = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = () => {
    const main = document.querySelector<HTMLElement>('main')
    const target = main?.querySelector<HTMLElement>('h1') ?? (main && main.getAttribute('aria-busy') !== 'true' ? main : null)
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus()
      return
    }
    if (++tries < 40) timer = setTimeout(attempt, 100)
  }
  attempt()
  return () => clearTimeout(timer)
}
