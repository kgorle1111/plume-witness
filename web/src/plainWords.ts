// The pipeline's terse labels, read into parts that a plain-language sentence can carry. Numbers pass through as
// written. Null when the label has another shape: the caller then shows it as published.

export interface RuleParts { k: string; days: string; min: string; unit: string }

/** "value >= max(10 x 7-day median baseline, 10 ppb)" -> { k: '10', days: '7', min: '10', unit: 'ppb' }. */
export function ruleParts(rule: string): RuleParts | null {
  const m = /^value >= max\((\d+(?:\.\d+)?) x (\d+)-day median baseline, (\d+(?:\.\d+)?) (\S+)\)$/.exec(rule.trim())
  return m ? { k: m[1], days: m[2], min: m[3], unit: m[4] } : null
}

export interface CheckAt { n: string; unit: 'h' | 'd' }

/** "T+24h" -> { n: '24', unit: 'h' }; "T+14d" -> { n: '14', unit: 'd' }. */
export function checkAt(at: string): CheckAt | null {
  const m = /^T\+(\d+)([hd])$/.exec(at.trim())
  return m ? { n: m[1], unit: m[2] as 'h' | 'd' } : null
}
