// Run: npm test. The landing's key numbers must match the published data they quote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { HAND_CHECK, LANDING_METRICS } from '../src/landingMetrics.ts'

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const spikes = read('../public/spikes.json')
const audit = read('../../docs/audit-no-report.json')

test('spike, monitor and year counts match spikes.json', () => {
  assert.equal(LANDING_METRICS.spikes, spikes.summary.spikes)
  assert.equal(LANDING_METRICS.spikes, spikes.rows.length)
  assert.equal(LANDING_METRICS.monitors, new Set(spikes.rows.map((r: { site_id: string }) => r.site_id)).size)
  assert.equal(LANDING_METRICS.years, spikes.years.length)
})

test('the "no matching report" count matches the no-matching-report rows in spikes.json', () => {
  const open = spikes.rows.filter((r: { status: string }) => r.status === 'no_report_after_deadline').length
  assert.equal(LANDING_METRICS.noReport, open)
  assert.equal(LANDING_METRICS.noReport, spikes.summary.by_status.no_report_after_deadline)
})

test('the hand-check workload matches the no-matching-report night files', () => {
  const dir = new URL('../public/nights/', import.meta.url)
  const nights = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}_.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    .filter((n) => n.record_check.status === 'no_report_after_deadline')
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const reports = nights.map((n) => (n.record_check.day_incidents?.length ?? 0) + (n.record_check.ongoing_incidents?.length ?? 0))
  const facilities = nights.map((n) => n.facilities.filter((f: { in_corridor: boolean }) => f.in_corridor).length)
  assert.equal(HAND_CHECK.nights, nights.length)
  assert.equal(HAND_CHECK.nights, LANDING_METRICS.noReport)
  assert.ok(nights.every((n) => n.record_check.search_scope.includes(`${HAND_CHECK.priorDays} days before`)))
  assert.equal(HAND_CHECK.reportsMedian, median(reports))
  assert.equal(HAND_CHECK.reportsMax, Math.max(...reports))
  assert.equal(HAND_CHECK.reportsTotal, reports.reduce((a, b) => a + b, 0))
  assert.equal(HAND_CHECK.facilitiesMedian, median(facilities))
  assert.equal(HAND_CHECK.facilitiesMax, Math.max(...facilities))
  assert.equal(HAND_CHECK.facilitiesTotal, facilities.reduce((a, b) => a + b, 0))
})

test('the residents count matches people.json near_open_questions', () => {
  const q = read('../public/people.json').near_open_questions
  assert.equal(LANDING_METRICS.residentsNearQuestions, q.population)
  assert.equal(LANDING_METRICS.questionMonitors, q.site_ids.length)
  assert.equal(q.radius_km, 3)
})

test('the "data as of" date is the newest fetch in the raw provenance files', () => {
  const raw = new URL('../../data/raw/', import.meta.url)
  const slash = (p: string) => p.replace(/\\/g, '/')
  const ledgers = readdirSync(raw, { recursive: true }).map(String).map(slash).filter((p) => p.endsWith('provenance.json'))
  const dates = ledgers.flatMap((p) => JSON.parse(readFileSync(new URL(p, raw), 'utf8')) as { fetched_at?: string }[])
    .map((e) => e.fetched_at).filter((d): d is string => !!d)
  const latest = dates.map((d) => new Date(d).toISOString().slice(0, 10)).sort().at(-1)
  assert.equal(LANDING_METRICS.rawFetchedLatest, latest)
})

test('the backtest numbers match data/build/backtest.json', () => {
  const bt = read('../../data/build/backtest.json').summary
  assert.equal(LANDING_METRICS.backtestReleases, bt.candidates)
  assert.equal(LANDING_METRICS.backtestSpiked, bt.spike_near_start)
  assert.equal(LANDING_METRICS.backtestMatched, bt.detected_and_matched)
})

test('the hand-audit numbers match audit-no-report.json', () => {
  assert.equal(LANDING_METRICS.auditNights, audit.n)
  assert.equal(LANDING_METRICS.auditMissed, audit.counts['likely missed by us'])
  assert.equal(LANDING_METRICS.auditUnclear, audit.counts["can't tell"])
  // The quoted upper bound is for "missed or doubtful", the same nights the landing's {k} counts as missed.
  assert.equal(LANDING_METRICS.auditMissed, audit.missed_or_doubtful.k)
  assert.equal(LANDING_METRICS.auditUpperPct, Math.round(audit.missed_or_doubtful.wilson_95[1] * 100))
})
