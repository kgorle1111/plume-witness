// Run: npm test. The landing's key numbers must match the published data they quote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LANDING_METRICS } from '../src/landingMetrics.ts'

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const spikes = read('../public/spikes.json')
const audit = read('../../docs/audit-no-report.json')

test('spike, monitor and year counts match spikes.json', () => {
  assert.equal(LANDING_METRICS.spikes, spikes.summary.spikes)
  assert.equal(LANDING_METRICS.spikes, spikes.rows.length)
  assert.equal(LANDING_METRICS.monitors, new Set(spikes.rows.map((r: { site_id: string }) => r.site_id)).size)
  assert.equal(LANDING_METRICS.years, spikes.years.length)
})

test('the hand-audit numbers match audit-no-report.json', () => {
  assert.equal(LANDING_METRICS.auditNights, audit.n)
  assert.equal(LANDING_METRICS.auditMissed, audit.counts['likely missed by us'])
})
