// Small UI effects, written for this app and inspired by React Bits (reactbits.dev); no React Bits source is copied.
// Rules every effect follows (WCAG 2.2): prefers-reduced-motion shows the final state at once; nothing moves for
// more than 5 s; screen readers get the final value, never tweened frames (animated text is aria-hidden).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, LazyMotion, m, useReducedMotion } from 'motion/react'

const loadFeatures = () => import('./motionFeatures').then((r) => r.default)
/** Wraps motion elements; the animation engine downloads on first use, not with the app. */
export function MotionScope({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures} strict>{children}</LazyMotion>
}

const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1] as const
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3

/* ---------- Count Up ---------- */
export function CountUp({ from = 0, to, duration = 1.6, format, className }: {
  from?: number
  to: number
  duration?: number
  format: (n: number) => string
  className?: string
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })
  // A plain rAF tween (ease-out cubic): pulling motion's number animator into first paint cost ~18 kB gzip.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduce) {
      el.textContent = fmt.current(to)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / (duration * 1000))
      el.textContent = fmt.current(from + (to - from) * easeOutCubic(p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    el.textContent = fmt.current(from)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, duration, reduce])
  return (
    <span className={className}>
      <span aria-hidden="true" ref={ref}>{format(to)}</span>
      <span className="sr-only">{format(to)}</span>
    </span>
  )
}

/* ---------- Split Flap ---------- */
function FlapChar({ ch }: { ch: string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(ch)
  const [flips, setFlips] = useState(0)
  const shownRef = useRef(ch)
  useEffect(() => {
    const from = shownRef.current
    const set = (c: string) => {
      shownRef.current = c
      setShown(c)
      setFlips((n) => n + 1)
    }
    if (from === ch) return
    if (reduce || !/\d/.test(ch) || !/\d/.test(from)) return set(ch)
    // Step through the digits to the target, 45 ms a step, each step a short flip.
    let cur = Number(from)
    const target = Number(ch)
    const id = window.setInterval(() => {
      cur = (cur + 1) % 10
      set(String(cur))
      if (cur === target) window.clearInterval(id)
    }, 45)
    return () => window.clearInterval(id)
  }, [ch, reduce])
  return <span className="flap"><span key={flips} className="flap-face">{shown}</span></span>
}

/** Visual only: the caller keeps the real text in the DOM (the timeline's status line already announces it). */
export function SplitFlap({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`split-flap ${className ?? ''}`} aria-hidden="true">
      {text.split('').map((c, i) => (c === ':' ? <span key={i} className="flap-colon">:</span> : <FlapChar key={i} ch={c} />))}
    </span>
  )
}

/* ---------- Status Mark: the check draws itself ---------- */
export function DrawnCheck({ delay = 0, size = 18 }: { delay?: number; size?: number }) {
  const reduce = useReducedMotion()
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <m.circle cx="10" cy="10" r="8.5" {...stroke}
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.42, delay, ease: 'easeOut' }} />
      <m.path d="M6 10.5l2.7 2.7L14 7.5" {...stroke}
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, delay: delay + 0.38, ease: 'easeOut' }} />
    </svg>
  )
}

/** The status word fades in after its mark; it is in the DOM (and read) from the start. */
export function FadeWord({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <m.span initial={reduce ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: delay + 0.52 }}>
      {children}
    </m.span>
  )
}

/* ---------- Hold Button ---------- */
/** Press and hold to confirm. Pointer: hold ~1.1 s; keyboard: hold Space or Enter. A screen reader's virtual click
 *  (a click with no pointer or key behind it) confirms at once: the activation itself is the deliberate act. */
export function HoldButton({ onComplete, duration = 1100, disabled, describedBy, children }: {
  onComplete: () => void
  duration?: number
  disabled?: boolean
  describedBy?: string
  children: ReactNode
}) {
  const [holding, setHolding] = useState(false)
  const timer = useRef(0)
  const physical = useRef(false)
  const start = () => {
    if (disabled || timer.current) return
    setHolding(true)
    timer.current = window.setTimeout(() => {
      timer.current = 0
      setHolding(false)
      onComplete()
    }, duration)
  }
  const cancel = () => {
    window.clearTimeout(timer.current)
    timer.current = 0
    setHolding(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const isKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter'
  return (
    <button
      type="button"
      className="btn btn-primary hold-btn"
      data-holding={holding || undefined}
      style={{ ['--hold-ms' as string]: `${duration}ms` }}
      disabled={disabled}
      aria-describedby={describedBy}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        physical.current = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
        start()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if (!isKey(e)) return
        e.preventDefault()
        physical.current = true
        if (!e.repeat) start()
      }}
      onKeyUp={(e) => {
        if (!isKey(e)) return
        e.preventDefault()
        cancel()
      }}
      onClick={(e) => {
        if (!physical.current && e.detail === 0) onComplete()
        physical.current = false
      }}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="hold-label">{children}</span>
    </button>
  )
}

/* ---------- Radar (2D canvas, so it never competes with deck.gl for the GPU) ---------- */
export function Radar() {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const blips = Array.from({ length: 9 }, (_, i) => ({ a: (i * 2.39996) % (Math.PI * 2), r: 0.25 + ((i * 37) % 70) / 100 }))
    let raf = 0
    const t0 = performance.now()
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy)
      const sweep = reduce ? 0.9 : ((now - t0) / 1000) * 0.6 * Math.PI * 2
      ctx.strokeStyle = 'rgba(78,122,128,0.22)'
      ctx.lineWidth = 1
      for (let r = 40; r < R; r += 40) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke() }
      // Sweep with a fading trail.
      for (let i = 0; i < 24; i++) {
        const a0 = sweep - (i + 1) * 0.04, a1 = sweep - i * 0.04
        ctx.fillStyle = `rgba(78,122,128,${0.2 * (1 - i / 24)})`
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fill()
      }
      const maxR = Math.min(cx, cy) * 0.95
      for (const b of blips) {
        const since = (((sweep - b.a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
        const alpha = Math.max(0, 1 - since / 2.5)
        if (alpha <= 0) continue
        ctx.fillStyle = `rgba(51,88,93,${alpha})`
        ctx.beginPath(); ctx.arc(cx + Math.cos(b.a) * b.r * maxR, cy + Math.sin(b.a) * b.r * maxR, 3, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = '#d0604d'
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill()
      // Stops after 5 s (WCAG 2.2.2); a slow load keeps the last frame.
      if (!reduce && now - t0 < 5000) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reduce])
  return <canvas ref={ref} className="radar" aria-hidden="true" />
}

/* ---------- Swipe Toast ---------- */
export function SwipeToast({ id, message, onDone }: { id: number; message: string | null; onDone: () => void }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(onDone, 2800)
    return () => window.clearTimeout(t)
  }, [id, message, onDone])
  return (
    // Visual only: the Packet's sr-only live region announces the same words.
    <div className="toast-host" aria-hidden="true">
      <AnimatePresence>
        {message && (
          <m.div
            key={id}
            className="toast"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.32, ease: EASE_OUT_CUBIC }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 60) onDone() }}
            onClick={onDone}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8.5" /><path d="M6 10.5l2.7 2.7L14 7.5" />
            </svg>
            <span>{message}</span>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
