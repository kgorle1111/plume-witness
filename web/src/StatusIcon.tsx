import type { StatusIconKind } from './format'

// Each status has its own outline, so none depends on colour: circle (check, clock, mismatch, search incomplete),
// diamond (no matching report, an open question), triangle (unknown status).
export function StatusIcon({ kind, size = 18 }: { kind: StatusIconKind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': true, focusable: false, className: 'status-icon' } as const
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  switch (kind) {
    case 'check':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M6 10.5l2.7 2.7L14 7.5" {...stroke} /></svg>
    case 'clock':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M10 5.5V10l3 2" {...stroke} /></svg>
    case 'mismatch':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} /><path d="M6 8h8M6 12h8M12.5 5.5l-5 9" {...stroke} /></svg>
    case 'question':
      return <svg {...common}><path d="M10 1.2L18.8 10 10 18.8 1.2 10z" {...stroke} /><path d="M8 8a2.1 2.1 0 1 1 3 1.9c-.6.3-1 .8-1 1.4v.2" {...stroke} /><circle cx="10" cy="14.2" r=".7" fill="currentColor" /></svg>
    case 'partial':
      return <svg {...common}><circle cx="10" cy="10" r="8.5" {...stroke} strokeDasharray="3 3" /><circle cx="6.5" cy="10" r=".9" fill="currentColor" /><circle cx="10" cy="10" r=".9" fill="currentColor" /><circle cx="13.5" cy="10" r=".9" fill="currentColor" /></svg>
    default:
      return <svg {...common}><path d="M10 2.5l8 14.5H2z" {...stroke} /><path d="M10 8v4" {...stroke} /><circle cx="10" cy="14.4" r=".6" fill="currentColor" /></svg>
  }
}
