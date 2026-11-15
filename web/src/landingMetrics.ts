// The landing's key numbers. Constants, not a fetch: the landing should not pull the 150 KB spike log for four
// numbers. test/landingMetrics.test.ts recomputes every one from its source file, so a pipeline re-run that changes
// a number fails the tests instead of leaving the landing stale.
export const LANDING_METRICS = {
  /** web/public/spikes.json → summary.spikes (Houston, all detected spikes). */
  spikes: 415,
  /** web/public/spikes.json → distinct rows[].site_id. */
  monitors: 8,
  /** web/public/spikes.json → years.length (2024, 2025). */
  years: 2,
  /** web/public/spikes.json → rows[] with status 'no_report_after_deadline': no matching report, a question for the state. */
  noReport: 170,
  /** docs/audit-no-report.json → counts['likely missed by us'] of n hand-checked "no matching report" nights. */
  auditMissed: 0,
  /** docs/audit-no-report.json → n. */
  auditNights: 10,
  /** docs/audit-no-report.json → counts["can't tell"]: nights that public data could not settle either way. */
  auditUnclear: 2,
  /** docs/audit-no-report.json → missed_or_doubtful.wilson_95[1], as a whole percent: how high the true miss rate could be. */
  auditUpperPct: 28,
} as const
