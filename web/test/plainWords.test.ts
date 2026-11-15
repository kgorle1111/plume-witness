import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { checkAt, ruleParts } from '../src/plainWords.ts'

test('ruleParts reads the detector rule and keeps its numbers as written', () => {
  assert.deepEqual(ruleParts('value >= max(10 x 7-day median baseline, 10 ppb)'), { k: '10', days: '7', min: '10', unit: 'ppb' })
  assert.deepEqual(ruleParts('value >= max(2.5 x 30-day median baseline, 0.5 ppb-v)'), { k: '2.5', days: '30', min: '0.5', unit: 'ppb-v' })
  assert.equal(ruleParts('value >= 3 x mean'), null)
})

test('checkAt reads the check offsets', () => {
  assert.deepEqual(checkAt('T+24h'), { n: '24', unit: 'h' })
  assert.deepEqual(checkAt('T+14d'), { n: '14', unit: 'd' })
  assert.equal(checkAt('later'), null)
})

test('every night in the data uses label shapes the plain-words readers understand', () => {
  const dir = new URL('../public/nights/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  let nights = 0
  for (const f of files) {
    const ev = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    if (!ev.detection) continue
    nights++
    assert.ok(ruleParts(ev.detection.rule), `${f}: rule not understood: ${ev.detection.rule}`)
    for (const c of ev.record_check.checks) assert.ok(checkAt(c.at), `${f}: check label not understood: ${c.at}`)
  }
  assert.ok(nights > 100, `expected the full set of nights, read ${nights}`)
})
