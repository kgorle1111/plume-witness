# Audit: are the "no matching report" nights right?

Hand audit of a random sample of the spikes that the backtest labels `no_report_after_deadline` (172 of the 415 detected
spikes in 2024-2025 when sampled, 170 now: see the update below; `data/build/backtest.json`). Reproduce the sample and its evidence with
`uv run python -m pipeline.audit_no_report` (prints the evidence for local review) and
`uv run python -m pipeline.audit_no_report --write` (writes `docs/audit-no-report.json`). No network: everything
comes from the cached pages in `data/raw/backtest/`.

**Population is frozen (2026-11-15).** The sample was drawn from the 8-monitor scan, saved as
`docs/audit-no-report-population.json`. With 12 Harris County monitors, and each monitor's own AutoGC-form wind tried
before a neighbour's, the live scan has 168 no-report spikes. 8 of the 10 audited nights keep their id and status;
2025-06-12 (1,3-butadiene) now triggers first at Channelview Drive Water Tower (still no matching report), and
2025-10-31 (benzene) now triggers first at Pasadena Richey Elementary School and abstains (search incomplete). The 4
Galena Park nights now use Galena Park's own AutoGC-form wind, not Milby Park's or Manchester's, so the wind lines in
their evidence below describe the borrowed wind the audit read; for 2025-09-19 that own wind is what the evidence
says would settle it, and it has not been re-read by hand. The audit says nothing about the new monitors' spikes.

## Result

| Verdict | Spikes (of 10) |
|---|---|
| gap stands | 8 |
| likely missed by us | 0 |
| spike doubtful | 0 |
| can't tell | 2 |

**Likely missed + spike doubtful: 0 of 10, 95% Wilson interval 0-28%.** If both "can't tell" nights were
counted as errors, it would be 2 of 10 (6-51%). Ten nights cannot rule out an error rate in the 20s; they do
rule out a tool that is wrong most of the time.

An automated sweep of all 170 nights (checks 1 and 3 below, no hand reading) adds one number the sample is too
small to see: on **5 of 170 (2.9%, 95% CI 1.3-6.7%)** a report that lists the spiking compound was running at the
spike, inside a wider 45 deg wedge but outside the pipeline's 22.5 deg corridor. None of those 5 is in the sample.
That is the size of the main systematic weakness found (proposal A).

## Plain-language sentences for the pitch

- "We picked 10 'no matching report' nights at random and checked each one by hand against every report filed
  within 12 hours. In 8 the gap held up, 2 could not be settled from public data, and in none did we find a
  report we had missed (0 of 10; with 10 nights the true miss rate could still be as high as 28%)."
- "Across all 170 such nights, widening the upwind wedge from 22.5 to 45 degrees would have found a report
  listing the same chemical on 5 of them, about 1 in 35."
- "'No matching report' is never a finding about a facility: Texas requires a report only above a reportable
  quantity, and traffic, ships, tanks and permitted emissions also raise readings."

## Update: duplicate names fixed (finding B)

The sample below was drawn from 172 spikes when the pipeline placed a report at the last ECHO site that shared its
name. `build.place_incidents` now uses `build.locate` (name, then the report's own street number, then street
address); a name that stays ambiguous is marked unresolved and the check abstains. Re-running the backtest moved
four spikes (all at two monitors, none in the 10-night sample): two nights at one monitor went from
`no_report_after_deadline` to `search_incomplete` because the name is shared and the address does not settle it, and two
went from `reported_mismatch` to `reported` (the report was placed outside the corridor because the corridor
list holds one name per site, while ECHO lists that site under five names). The population is now 170. The 10 hand
verdicts are unchanged: the shuffle still draws from the 172 that existed when the sample was taken
(`DRAWN_BEFORE_NAME_FIX`), and the sweep below counts the 170 that remain. The two sweep rows about name lookups
(9 and 8) measure the old last-row lookup and are kept as the record of what was fixed.

## Method

**Population.** The spikes with status `no_report_after_deadline` after PR #35 (172 when the sample was drawn, before a facility-name fix; 170 now): the day's STEERS search is
complete, every report of the day and every overlapping earlier report was located in ECHO, the wind was at least
3 mph, and the 30 days before were searched.

**Sample.** Sort the 172 drawn from before the facility-name fix (170 now) by (date, compound, monitor), shuffle with `random.Random(20261114)`, then take spikes
in shuffled order, skipping any whose monitor already has 3, until there are 10 (`audit_no_report.sample`).
Galena Park and Houston Milby Park each hit the cap of 3. Sorting first means the sample does not depend on the
order of the JSON file; a test pins the 10 ids.

**Rebuild.** Each night is rebuilt with the unchanged pipeline code (`backtest.scan_monitors`, `build.detect`,
`backtest.day_reports`, `backtest.earlier_reports`, `build.trace`). All 10 sampled nights, and all 170 in the
sweep, reproduce `no_report_after_deadline` with the same monitor, hour and value.

**Checks** (`audit_no_report.evidence`), then a hand reading of the evidence and the cached detail pages:

1. **Wider time and angle.** Every saved Harris County STEERS row, of any type, whose [start, end] overlaps the
   spike hour +/-12 h (the pipeline uses -6 h/+2 h). Each is placed from its ECHO coordinates against the
   detection-hour wind at +/-22.5 deg and at +/-45 deg, within 15 km.
2. **Lumped compounds.** Contaminant lines named VOC, unspeciated VOCs, VOC - nonmethane, hydrocarbons, BTEX,
   benzene/toluene, aromatics, HRVOC, NMHC or NMOC, read at the end of the contaminant cell so a "(VOC cap)"
   authorization note does not count.
3. **Name vs address.** Where the pipeline's exact-name lookup puts the report (`place_incidents` keeps the last
   ECHO row with that name) compared with `backtest.locate` (name plus street number, or street address).
4. **The spike itself.** Hours over the trigger, values 3 h either side (past midnight for late spikes), QA flags
   on the hour before, every other monitor at that hour, and the other compound at the same monitor.

**Verdict rules.** *Gap stands*: no report found by checks 1-3 that is running near the spike hour inside the
45 deg wedge, and nothing in check 4 that undercuts the reading. *Likely missed by us*: a report that a check
places in time and in the wedge and that lists the compound or a lumped VOC line. *Spike doubtful*: the reading
itself looks like an artifact. *Can't tell*: the evidence points both ways; the row says what data would decide.
When in doubt, "can't tell".

**Naming rule.** Rows that keep or leave open the "no matching report" reading name no facility, company or
incident number; a test checks this against every entity, owner and ECHO name in the cached data. No row is
"likely missed", so no incident number appears anywhere below.

## The 10 nights

Times are CST hour of the hourly reading; values in ppb (7-day median baseline in brackets).

| Date | Monitor | Compound | Hour | Value | Verdict | Rule | Evidence |
|---|---|---|---|---|---|---|---|
| 2024-03-29 | Galena Park | benzene | 23 | 15.84 (0.27) | gap stands | 1, 4 | No STEERS report of any type running within +/-12 h. Two hours over the trigger (15.84, then 12.09 after midnight); 1,3-butadiene up at the same hour (4.37 vs 0.04). |
| 2025-10-17 | Houston Milby Park | 1,3-butadiene | 20 | 10.02 (0.30) | gap stands | 1, 4 | One report within +/-12 h: a maintenance activity 23.9 km away, 100 deg off the wind, neither compound. Three hours over the trigger. |
| 2024-09-25 | Lynchburg Ferry | benzene | 2 | 10.79 (0.26) | can't tell | 4 | No report within +/-12 h, so nothing was missed; the question is the reading. It is the first valid hour after the span (ST) and blank (BL) hours; at this site in 2024, hours right after a flagged hour read >= 10 ppb 2.8% of the time (10/351) vs 0.6% (30/5097) otherwise. A second hour is also over (11.05). Would decide it: TCEQ's final validated data (current data are provisional) or the span-check log. |
| 2025-11-18 | Manchester East Ave N | 1,3-butadiene | 20 | 10.08 (0.21) | gap stands | 1, 4 | No report running within +/-12 h. Two hours over (10.08, 38.65); the monitor 1.6 km away also rose (2.44 vs 0.0). |
| 2025-03-25 | Houston Milby Park | 1,3-butadiene | 18 | 13.96 (0.00) | gap stands | 1, 3 | One report within +/-12 h, starting 1.2 h after the spike hour, listing benzene and unspeciated VOCs, no 1,3-butadiene. By street address 5.9 km away, 63 deg off the wind; the name lookup put it at a same-name site 9.5 km away, 49 deg off. Outside the 45 deg wedge either way. |
| 2025-09-11 | Galena Park | benzene | 20 | 13.12 (0.26) | gap stands | 1, 2 | Two reports within +/-12 h: one 20.1 km away, 118 deg off the wind; one with lumped VOC only (563 lb), 14.4 km away, 63 deg off, starting 0.9 h after the spike hour (air at 3.6 mph needs ~2.5 h for 14.4 km). Wind borrowed from Milby Park. |
| 2025-06-12 | Channelview | 1,3-butadiene | 23 | 14.40 (0.03) | gap stands | 1, 4 | No report running within +/-12 h. Elevated over three hours (9.97, 14.40, then 7.14 after midnight). |
| 2024-04-15 | Houston Milby Park | 1,3-butadiene | 23 | 10.78 (0.21) | gap stands | 1, 2 | One report within +/-12 h, open for 26 days, listing C4 hydrocarbons and a lumped VOC - nonmethane line, no 1,3-butadiene; 8.8 km away at bearing 79 deg, 54 deg off the wind. The wind from 19:00 to 02:00 came from 133-210 deg, never near 79 deg. |
| 2025-09-19 | Galena Park | benzene | 20 | 13.21 (0.64) | can't tell | 1 | A flaring report was running at the spike hour, 11.3 km away and 38 deg off the wind: inside the 45 deg wedge, outside the 22.5 deg corridor. It lists SO2, CO, H2S and light hydrocarbons, no benzene and no lumped VOC line. Wind borrowed from Milby Park 3.8 km away, and it turned from 142 to 181 deg in the next hour. Would decide it: wind measured at Galena Park, or a speciated analysis of that flaring. |
| 2025-10-31 | HRM-16 Deer Park | benzene | 7 | 10.65 (0.19) | gap stands | 1 | Two reports within +/-12 h: a maintenance activity 18.5 km away, neither compound; one 9.3 km away, 119 deg off the wind (2.5 lb benzene). Neither inside the 45 deg wedge. Wind borrowed from Lynchburg Ferry. |

## Sweep of all 170 nights (automated, not hand-read)

| Check | Nights |
|---|---|
| reproduce `no_report_after_deadline` | 170 |
| any STEERS report running within +/-12 h | 101 |
| a report within +/-12 h inside the 22.5 deg corridor (all start 6.4-11.1 h after the spike hour) | 3 |
| a report within +/-12 h inside the 45 deg wedge | 14 |
| ...running in the pipeline's -6 h/+2 h window | 9 |
| ...and listing the spiking compound | **5** |
| a report inside the 45 deg wedge that lists only lumped VOC | 3 |
| a report in the match window whose name is shared by several ECHO sites | 9 |
| ...placed by the name lookup at a different site than its street address | 8 (none changes the corridor outcome) |
| trigger hour comes right after a QA/calibration-flagged hour | 30 |
| only one hour over the trigger | 98 |
| wind borrowed from another site | 72 |

## Systematic findings, as proposals (no matching logic changed in this PR)

**A. The 22.5 deg corridor misses some reports just outside it.** On 5 of 170 nights a report listing the
spiking compound (in three cases thousands of pounds of 1,3-butadiene, 13.3 km away and 38-42 deg off the wind)
was running at the spike, outside the corridor but inside 45 deg. 43% of these nights borrow wind from another
site, which makes a 22.5 deg half-angle tighter than the wind data support. Proposal: keep 22.5 deg for "in the
corridor", but when a report that lists the compound is running inside 45 deg, return `search_incomplete` with
the reason "a report just outside the corridor was running" instead of `no_report_after_deadline`, and show it
on the night page as nearby, not matched. Cost: on this data it moves about 5 of 170 nights out of the count.
Measure before adopting: rerun the backtest and check that the 72-candidate match numbers do not change.

**B. Duplicate names are placed at an arbitrary site (fixed; see the update above).** `build.place_incidents` maps a report to ECHO by exact
name and keeps the last row when several sites share the name. 8 of 170 nights had a running report placed at a
different site than its own street address. None of the 8 changed a night's status in the audit sample, but the
fix did move four spikes elsewhere in the 415 (see the update above). Done: reports are placed with `build.locate`
(name plus street number, then street address) and an ambiguous name is unresolved, which blocks an absence claim.

**C. Lumped VOC lines do not cause false "no report" labels.** By construction, any report that is in the
corridor and running in the window already turns the night into `reported` or `reported_mismatch`, whatever
compounds it lists. A lumped VOC line only matters for `reported` vs `reported_mismatch`, and for the wider
wedge in A (3 of 170 nights). Proposal: when the only line that could contain the compound is a lumped VOC line,
label the match "compound not itemized" rather than `reported_mismatch`.

**D. Trigger hours right after a calibration check.** 30 of 170 trigger hours (18%) follow an hour flagged ST,
BL or another QA code; at the two site-years checked, about 6% of all hours do. Readings right after a span
check are over-represented among 10 ppb readings (2.8% vs 0.6% at Lynchburg Ferry in 2024). Proposal: mark these
nights on the page and, before calling one a gap, require a second hour over the trigger or wait for TCEQ's
validated data.

## What this audit does not cover

- Reports filed outside Harris County. The saved searches are Harris County only; every corridor facility in
  the 10 sampled nights is in Harris County, but a 45 deg wedge can reach beyond it.
- Releases below a reportable quantity, permitted emissions, ships, tanks and traffic. These never produce a
  STEERS report, so "gap stands" means only that no matching report exists in the saved searches.
- One reviewer, no second blind reading. The evidence and verdicts are in `pipeline/audit_no_report.py`
  (`VERDICTS`) so anyone can rerun the evidence and disagree with a call.
- AutoGC data are provisional; a refetch can change a reading.
