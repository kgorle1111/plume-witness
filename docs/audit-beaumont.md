# Audit: the Beaumont "no matching report" spike

The Beaumont-Port Arthur region (two AutoGC sites; backtest in `docs/backtest-beaumont.md`) has two detected spikes in 2024-2025. One is
labelled `no_report_after_deadline`: **2025-08-25, benzene, Beaumont-Downtown (48_245_0009)**. This is a hand check
of that one night with the same four checks as the Houston audit (`docs/audit-no-report.md`), run on the cached
pages in `data/raw/region_beaumont/`. Evidence: `uv run python -m pipeline.audit_no_report --region beaumont`
(prints it, no network; may show names, so it is local review only).

## Verdict: gap stands

No report in the saved Jefferson County STEERS searches was running within 12 hours of the spike, so there is no
report, in or out of the wedge, that the matching step missed. The reading itself looks like a plume passing, not an
artifact. One night does not say anything about how often the label is right in this region.

## Evidence

| Check | Result |
|---|---|
| Rebuild | Reproduces `no_report_after_deadline` with the same monitor, hour (21 CST), and value (10.41 ppb; 7-day median 0.05, trigger 10 ppb). The day's search is complete (0 reports starting that day) and so is the 30-day look-back. |
| 1. Reports within +/-12 h (any type) | **None.** The pipeline window is -6 h/+2 h; this check widens it to +/-12 h and counts every saved Jefferson County row of any event type. With none to place, the 45 deg wedge question does not arise. |
| 1. Nearest reports in time | Two emissions events ended before the window: one 21.5 h before the spike hour (20.2 km away, 32 deg off the wind; neither benzene nor 1,3-butadiene listed) and one 26.6 h before (18.5 km away, 30 deg off the wind; lists benzene, 45 lb, and 1,3-butadiene, 34 lb). Both are beyond the 15 km corridor limit, and at 3.5-3.8 mph air needs about 3 h to cover 18.5 km. The next report starts 39.7 h after the spike. |
| 2. Lumped compound lines | Not applicable: no report in the +/-12 h window. |
| 3. Name vs address | Not applicable for the same reason (the pipeline places a report by street address when several sites share its name). |
| 4. The spike itself | The wind was from 179-181 deg at 3.8 and 3.5 mph, just above the 3 mph cutoff for tracing. The rise is not a single point: 0.65, 0.75, **10.41**, 2.71, 1.25 ppb over hours 19-23, all above the 0.5 ppb (10x median) level. The hour before is not QA-flagged; the first flagged hour (a span check) is three hours after the peak. 1,3-butadiene at the same monitor stayed at baseline (0.03, 0.02, 0.04). |

## What keeps this from being stronger

- **One hour over the trigger, and only by 0.41 ppb** (10.41 against the 10 ppb floor). A slightly different
  threshold would not have flagged the night.
- **The only other monitor, 9.0 km away, did not rise** (0.14 ppb at the hour; its largest value from the hour
  before to two hours after was 0.45). Two sites 9 km apart cannot tell a local plume from an instrument problem.
- **Wind is from the monitor itself, near the lower limit** of what the corridor can use; the wind turned to 125 deg
  and 105 deg in the next two hours (2.0 and 2.9 mph).
- **A benzene-listing report ended 26.6 h earlier**, 18.5 km away and 30 deg off the wind. Nothing here ties it to
  the reading, but a lingering release is not excluded by public data.

## What this does not cover

- Reports outside Jefferson County. The searches are county-wide; by coordinates (no county boundary file was
  checked) the 22.5 deg corridor to the south stays inside the county out to 15 km, but a wedge can reach beyond it.
- Releases below a reportable quantity, permitted emissions, ships, tanks and traffic. These never produce a
  STEERS report, so "gap stands" means only that no matching report exists in the saved searches.
- One reviewer, no second blind reading. AutoGC data are provisional and a refetch can change a reading.
- Nothing here is a finding about any facility. The verdict names none, and no incident number appears.
