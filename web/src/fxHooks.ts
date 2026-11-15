// Hooks and handlers for the effects in fx.tsx (kept apart so fx.tsx exports only components).
import { useEffect, useState, type PointerEvent, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'

/* ---------- Spotlight (pointer-tracked glow) ---------- */
export const spotlight = {
  onPointerMove: (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  },
  onPointerLeave: (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.style.removeProperty('--mx')
    e.currentTarget.style.removeProperty('--my')
  },
}

/* ---------- Gradual Blur: shown while the panel has more to scroll ---------- */
export function useMoreBelow(anchor: RefObject<HTMLElement | null>, dep: unknown) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const box = anchor.current?.closest('.panel') as HTMLElement | null
    if (!box) return
    const check = () => setMore(box.scrollHeight - box.clientHeight - box.scrollTop > 4)
    check()
    box.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(box)
    if (box.firstElementChild) ro.observe(box.firstElementChild)
    const mo = new MutationObserver(check)
    mo.observe(box, { childList: true, subtree: true })
    return () => { box.removeEventListener('scroll', check); ro.disconnect(); mo.disconnect() }
  }, [anchor, dep])
  return more
}

/* ---------- Text Type: hook for the draft ---------- */
/** Reveals `text` over ~1.8 s. Returns the visible slice and whether it is still typing; `skip` shows it all. */
export function useTypewriter(text: string, run: boolean, ms = 1800) {
  const reduce = useReducedMotion()
  const [n, setN] = useState(run && !reduce ? 0 : text.length)
  const [typing, setTyping] = useState(run && !reduce)
  useEffect(() => {
    if (!run || reduce) { setN(text.length); setTyping(false); return }
    setN(0); setTyping(true)
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      setN(Math.ceil(text.length * k))
      if (k < 1) raf = requestAnimationFrame(tick)
      else setTyping(false)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `text` is read at start only: edits after the user takes over are theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduce, ms])
  const skip = () => { setN(text.length); setTyping(false) }
  return { shown: typing ? text.slice(0, n) : text, typing, skip }
}

