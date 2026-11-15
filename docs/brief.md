# Can public hourly monitor data check companies' own release reports?

*A method brief from Plume Witness for advocates and public comment to TCEQ and EPA. Houston Ship Channel, 2024-2025. Every number is copied from the project's generated reports, cited in brackets.*

## In three sentences

1. In 60 of 77 company-reported releases (78%; 95% CI 68-86%), a state monitor within 15 km that had data that day was downwind of the facility near the reported start.
2. Yet only 5 of 77 releases (6%; 95% CI 3-14%) had a spike near the reported start, while ordinary days at the same monitors and hours spiked in 26 of 410 windows (6%; 95% CI 4-9%).
3. At all 9 trigger settings tested the 95% intervals overlap, so for these releases hourly state monitors at these triggers cannot tell a release day apart from an ordinary day at the same hours, and cannot confirm or contradict a company's report. [[detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md)]

## The question

In Texas, a facility reports its own unplanned releases ("emissions events") to TCEQ. A report is required only for an event at or above a reportable quantity: an initial notice within 24 hours and a final record within two weeks (30 TAC 101.201). Advocates such as TEJAS check these self-reports by hand today. We asked whether the state's own public hourly air data can do part of that check: when a company says it released benzene or 1,3-butadiene, did a nearby state monitor see it?

## Method, in plain words

- **Releases.** We searched every STEERS emissions-event record in Harris County that started in 2024 or 2025 (335 rows; 317 of them had a detail page we could cache) and kept the emissions events that reported benzene or 1,3-butadiene pounds, from facilities located in EPA ECHO within 15 km of one of 12 Ship Channel AutoGC monitors: 77 releases (18 more could not be placed on an EPA ECHO site). Readings are TCEQ AutoGC hourly data and site wind, which TCEQ labels provisional. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **Spike.** An hour at or above 10 times the monitor's own 7-day median and at least 10 ppb (the current trigger).
- **Downwind.** Geometry only: the facility lies within 22.5 degrees of the upwind direction and 15 km of the monitor, at some hour from 1 hour before to 6 hours after the reported start. This is not a plume model.
- **Control.** The same window moved 7, 14 or 21 days either side, same weekday, on days with no reported release: 410 ordinary-day windows.
- **Sweep.** We repeated the test at 9 trigger settings, down to 3 times the median and 1 ppb.

## Findings

- **Start day.** At any hour of the start day, 18 of 77 (23%; 95% CI 15-34%) had a spike, often hours from the release. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **A lower trigger does not help.** The most sensitive setting, 3x / 1 ppb, hits 45 of 77 releases and 252 of 410 control windows, at 13.5 alerts a week across the 12 monitors (current: 4.5 a week). Across all 9 settings, the release-day rate minus the control rate runs from -9 to +0 percentage points.
- **Many releases are small.** 27 of 77 releases reported under 10 lb of the monitored compound; of the 22 of these with a downwind monitor that had data, none had a spike near the start.
- **Calm wind blurs direction.** 149 / 465 (32%; 95% CI 28-36%) current-trigger alerts with a wind reading came under 3 mph, where the upwind direction is unreliable. [[detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md)]
- **End to end, the automated check matched 1 of 77** reports (1%; 95% CI 0-7%). [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **The other direction.** Across 2024-2025 the trigger fired 468 times on 378 days. After a complete search, 168 of 468 spikes had no matching report in the upwind corridor; on 283 the pipeline abstained ("search incomplete"; 2 of them had no wind data). No matching report is not a finding about any facility: reports are required only above a reportable quantity, and traffic, ships, tank farms and permitted emissions also raise readings. These spikes are counted, never named. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **Hand audit of "no matching report".** Of 10 such spikes picked at random (drawn from the 172 no-report spikes of an 8-monitor scan) and checked by hand, the gap held in 8 and 2 could not be settled from public data; likely missed by us or spike doubtful: 0 of 10 (95% Wilson interval 0-28%), or 2 of 10 (6-51%) if both unsettled nights count as errors. An automated sweep of the 170 no-report spikes of that 8-monitor scan found a report listing the compound running just outside the corridor on 5 of 170 (2.9%, 95% CI 1.3-6.7%); the 12-monitor scan has no audit of its own. [[audit-no-report.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/audit-no-report.md)]

## Who lives near these monitors

About 25,554 people live in the 10 census tracts within 3 km of the Houston Milby Park monitor: 82.3% Hispanic or Latino, 65.6% speak Spanish at home, 25.8% are under 18. (ACS 2024 5-year; whole tracts; margins of error not propagated; neighboring monitor areas overlap.) [[people.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/people.md)]

## What it means

For these 12 Ship Channel AutoGC monitors, in 2024-2025, for benzene and 1,3-butadiene, hourly state data at these triggers do not separate company-reported release days from ordinary days. They cannot confirm a company's report, and a quiet hour is no reason to doubt one. This does not extend to other monitors, compounds, years or regions.

## What it does not show

- It does not show that any release was larger or smaller than reported, or that any facility caused any reading.
- It does not show the monitors are faulty: a downwind monitor can miss a narrow or lofted plume.
- It does not measure a false-alarm rate; nobody knows the true cause of each alert.
- It does not cover releases that companies did not file, or the 18 releases whose facility could not be located in EPA ECHO.

## What would close the gap

Options the measurements point to, for TCEQ, EPA and advocates to weigh; not demands from this project.

- **Monitoring closer to sources.** Most releases had a monitor downwind, yet small ones left no trace at hourly, 15 km scale. Fenceline or continuous monitoring near sources is the option this points to.
- **Faster report publication.** A record check can call a report absent only after the deadline: 24 hours for an initial notice and two weeks for a final record. Until then the public record cannot answer a resident's question about a release that is happening now.
- **Machine-readable STEERS.** We rebuilt the record from week-by-week web searches, and 18 benzene or 1,3-butadiene releases could not be placed on an EPA ECHO site. A downloadable STEERS table with facility identifiers would remove both steps, including for TEJAS volunteers who verify and translate each report by hand.

## Limits

- **Start day only, in the backtest.** The detector backtest examines only the release's start day, so a release after about 18:00 CST loses part of its window. The record check on a replayed spike is wider: a report matches if it was running from 6 hours before to 2 hours after the spike hour, a window that can cross midnight, and reports that started in the 30 days before are searched too.
- **Anchors.** The window starts at the company's reported start time, and EPA ECHO facility points may not sit at the emission point.
- **Wind source.** Four monitors (Galena Park, HRM-16 Deer Park, Clinton, HRM-3 Haden Road) have no weather-station wind and use their own AutoGC analyzer's resultant wind, which agrees within 22.5 degrees with weather-station wind in 87-91% of hours where both exist and reads about 0.3-0.4 mph slower; a monitor with neither on a day uses the nearest site's (18 of 468 spikes).
- **Small numbers.** Two rates count as different only when their 95% Wilson intervals do not overlap, a deliberately conservative test. The audit had one reviewer and no blind second reading.
- **Provisional data.** TCEQ may revise AutoGC data, so a rerun can differ; a parser change that adds releases changes every denominator.

## Reproducibility

- **Code and data:** [github.com/kgorle1111/plume-witness](https://github.com/kgorle1111/plume-witness) (MIT). Interactive site: [kgorle1111.github.io/plume-witness](https://kgorle1111.github.io/plume-witness/).
- **Rerun:** `uv sync`, then `uv run python -m pipeline.backtest`, `uv run python -m pipeline.detector_eval`, `uv run python -m pipeline.people`.
- **Provenance:** every raw public file (TCEQ AutoGC and wind, TCEQ STEERS, EPA ECHO, U.S. Census ACS) is stored with its source URL, fetch time and SHA-256 in `data/raw/backtest/provenance.json` and `data/raw/census/provenance.json`.
- **Sources:** [docs/detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md), [docs/backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md), [docs/people.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/people.md), [docs/audit-no-report.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/audit-no-report.md); rule text: [30 TAC 101.201](https://www.law.cornell.edu/regulations/texas/30-Tex-Admin-Code-SS-101-201).
