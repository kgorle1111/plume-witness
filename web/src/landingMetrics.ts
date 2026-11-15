// The landing's key numbers. Constants, not a fetch: the landing should not pull the 150 KB spike log for four
// numbers. test/landingMetrics.test.ts recomputes every one from its source file, so a pipeline re-run that changes
// a number fails the tests instead of leaving the landing stale.
export const LANDING_METRICS = {
  /** web/public/spikes.json → summary.spikes (Houston, all detected spikes). */
  spikes: 468,
  /** web/public/spikes.json → distinct rows[].site_id. */
  monitors: 12,
  /** web/public/spikes.json → years.length (2024, 2025). */
  years: 2,
  /** web/public/spikes.json → rows[] with status 'no_report_after_deadline': a question for the state, not a finding. */
  noReport: 167,
  /** docs/audit-no-report.json → counts['likely missed by us'] of n hand-checked "no matching report" nights. */
  auditMissed: 0,
  /** docs/audit-no-report.json → n. */
  auditNights: 10,
  /** docs/audit-no-report.json → counts["can't tell"]: nights that public data could not settle either way. */
  auditUnclear: 2,
  /** docs/audit-no-report.json → missed_or_doubtful.wilson_95[1], as a whole percent: how high the true miss rate could be. */
  auditUpperPct: 28,
  /** data/build/backtest.json → summary.candidates: releases companies reported, used to test the method. */
  backtestReleases: 82,
  /** data/build/backtest.json → summary.spike_near_start: a monitor spiked from 1 h before to 6 h after the start. */
  backtestSpiked: 5,
  /** data/build/backtest.json → summary.detected_and_matched: the pipeline matched the release end to end. */
  backtestMatched: 1,
  /** web/public/people.json → near_open_questions.population: residents (ACS) within 3 km of a monitor with at least
   *  one "no matching report" spike, each tract counted once. Residents, not people exposed. */
  residentsNearQuestions: 103373,
  /** web/public/people.json → near_open_questions.site_ids.length. */
  questionMonitors: 8,
  /** Latest fetched_at (UTC date) across every provenance.json under data/raw/: when the newest public file was saved. */
  rawFetchedLatest: '2026-11-15',
} as const

/** What one hand check involves, counted over the night files of the spikes with no matching report
 *  (web/public/nights/*.json, record_check.status 'no_report_after_deadline'). A count of the work, not a timing:
 *  test/landingMetrics.test.ts recomputes each number. */
export const HAND_CHECK = {
  /** Spikes counted: the "no matching report" spikes that have a night file. */
  nights: 167,
  /** record_check.search_scope: reports that started this many days before the spike and were still running. */
  priorDays: 30,
  /** record_check.day_incidents + ongoing_incidents: reports a person has to open and read. */
  reportsMedian: 1,
  reportsMax: 4,
  reportsTotal: 136,
  /** facilities[] with in_corridor: facilities a person has to place against the wind. */
  facilitiesMedian: 9,
  facilitiesMax: 51,
  facilitiesTotal: 2519,
} as const
