# Plume Witness

**Plume Witness replays real nights of Texas state air-monitor data: when a monitor records a pollution spike, it traces the air upwind, lists the facilities in its path, and checks whether any of them filed the emissions-event report Texas requires. It is built for the people who check these reports by hand today: reporters, watchdog analysts and environmental volunteers.**

**Live site:** [kgorle1111.github.io/plume-witness](https://kgorle1111.github.io/plume-witness/) (static, no login, English and Spanish).

> **Status: in progress.** Built at GDG on Campus UCSC DevFest Hackathon 2026 (Best Social Impact track). Nothing here is a finished product. Results are labeled with what they are measured on.

## Why

Industrial facilities in Texas report their own unplanned releases ("emissions events") to the state. The Environmental Integrity Project counted **21,769** such events in Texas in FY2017-2022; the state designated **0.5%** of them "excessive". Fenceline advocates check these self-reports against what the air actually showed by hand, slowly, for a few events a year. Plume Witness automates that check for one corridor, starting with the Houston Ship Channel.

## What it does

1. **Detect**: a spike on a state (TCEQ) regulator-grade monitor, such as hourly benzene from an AutoGC site. Low-cost sensors are never the trigger.
2. **Trace**: the hourly wind at the monitor points upwind; every major facility within 15 km and ±22.5° of that direction is listed, nearest first. Wind alone can't tell them apart, so nothing is ranked as a likely source. This is geometry, not a dispersion model, and it says so.
3. **Check the record**: it searches every emissions-event report filed that day in the county, places each on the map, and checks whether one in the corridor, in the time window, lists the same compound: the initial notice within 24 hours, and a FINAL report dated within 14 days of the event's end. Status is one of: *reported*, *reported late* (the final report is dated more than 14 days after the event ended), *not yet reported*, *no report after the deadline*, *reported, but the compound doesn't match*, *reported to the NRC* (no state report matched, but a federal National Response Center report in the corridor lists the compound), *search incomplete*.
4. **Packet**: a hedged evidence summary in English and Spanish that states what the record shows and asks a follow-up question. A person always reviews, edits and files it. Nothing is sent automatically.

## What it can't say

- **"Not yet reported" is not a finding about any facility.** Texas requires a report only when a release exceeds a reportable quantity (30 TAC 101.201), and air readings can't measure how much was released.
- Facilities along the same bearing can't be told apart from one monitor's wind; the app lists them and checks the record instead of naming a source.
- It sees only what the state's monitors see. Many neighborhoods have no regulator-grade monitor.

## Measured so far

- **One real night, replayed.** 2024-06-21, Milby Park: the check finds the company's own report (INEOS, 7,634 lb of benzene) inside the upwind corridor, filed on time. It shows the check passing. Across 2024-2025, at 12 Ship Channel monitors, 168 of 468 spikes ended as "no matching report" after a complete search; the site lists them as questions for the state, never as findings. A hand check of 10 of them at random (drawn from the earlier 8-monitor scan) found 0 of 10 with a report the pipeline missed, and 2 of 10 could not be settled from public data; with 10 nights the true miss rate could be as high as 28% ([docs/audit-no-report.md](docs/audit-no-report.md)).
- **Backtest on 77 releases companies reported to the state** ([docs/backtest.md](docs/backtest.md)): only 5 of 77 showed a spike at a state monitor from 1 h before to 6 h after the reported start, and the pipeline matched 1 of 77 end to end.
- **What the monitors can see** ([docs/detector.md](docs/detector.md)): in 60 of 77 a monitor within 15 km was downwind near the reported start, yet ordinary days at the same monitors and hours spiked just as often (26 of 410 windows) at every trigger setting tested. For these releases, hourly state monitors cannot confirm or contradict a company's report. How often a "no report" result is wrong is estimated only from the 10-night hand check above.
- **Also in the data:** a past-spikes log of all 468 spikes in 2024-2025 with a replay of 466 of those nights (2 have no wind for the detection hours), a pollution rose per monitor ([pipeline/rose.py](pipeline/rose.py)), who lives within 3 km of each monitor ([docs/people.md](docs/people.md)), facilities' yearly TRI totals ([docs/tri.md](docs/tri.md)), and a history page for each of 194 major facilities near the monitors (`?view=facilities`): what each reported to the state and to EPA, never a list of nights it was merely upwind.
- **Open data:** every JSON the site serves is documented, with fields, units, provenance and caveats, in [docs/api.md](docs/api.md).
- **Evals:** the AI-draft guard is scored against hand-built mutants in [evals/guard_escape/RESULTS.md](evals/guard_escape/RESULTS.md) (in-sample; model-written attacks not tested). A reader for companies' report walk-backs has a validation report, not an accuracy measure: no labeled set has been scored ([evals/walkback/README.md](evals/walkback/README.md)).
- **Method brief** for advocates and public comment: [docs/brief.md](docs/brief.md), also on the site as a printable page at `?view=brief`.
- Regenerate with `uv run python -m pipeline.backtest`; every raw file has its URL and SHA-256 in `data/raw/backtest/provenance.json`.
- **Second region: Beaumont-Port Arthur** (Jefferson County). Same trigger, corridor and record check on the two Jefferson County AutoGC sites TCEQ lists (Beaumont-Downtown, Nederland 17th Street; Port Arthur has none). Backtested the same way against 81 company-reported releases ([docs/backtest-beaumont.md](docs/backtest-beaumont.md), [docs/detector-beaumont.md](docs/detector-beaumont.md)): a monitor with data was downwind of 37 of 81 near the reported start, yet none had a trigger hit then (0 of 81; 95% CI 0-4%) and none matched end to end; ordinary-day control windows: 0 of 413. The unchanged trigger fires twice in 2024-2025 there (readings above 10 ppb are rare at these two sites), so the log has 2 rows. Spike log at `?view=spikes&region=beaumont`, nights at `?region=beaumont&night=<id>`. Regenerate with `uv run python -m pipeline.fetch_backtest --region beaumont` and `uv run python -m pipeline.backtest --region beaumont`, then `uv run python -m pipeline.spikes --region beaumont` and `uv run python -m pipeline.nights --region beaumont`; raw files and provenance in `data/raw/region_beaumont/`.
- **Adding a region** needs no web code: add a `Region` to `REGIONS` in `pipeline/regions.py` (outputs under `web/public/regions/<key>/`, `label_es`/`place_es` for the Spanish switch and titles), backtest it with `uv run python -m pipeline.backtest --region <key>` (see "Other regions" in [docs/backtest.md](docs/backtest.md)), generate its `spikes` and `nights` with `--region <key>`, then run `uv run python -m pipeline.regions --write-web` and commit `web/src/regions.generated.json`. The region switch, links and titles read that file; tests fail if it is stale or a listed region has no data.

## Data (all public)

- TCEQ ambient monitoring (AutoGC hourly VOCs, site meteorology)
- TCEQ Air Emission Event Report Database (STEERS)
- US Coast Guard National Response Center (NRC) incident reports, a second report source checked after STEERS
- EPA ECHO / TRI facility locations
- U.S. Census Bureau ACS 2024 5-year (tract level)
- Every raw file is stored under `data/raw/` with its source URL, fetch time and SHA-256 in the neighbouring `provenance.json`
- Map data © OpenStreetMap contributors

## Stack

- `pipeline/`: Python 3.12, uv, pytest. Pulls public data, detects, lists the upwind corridor, checks the record, writes `web/public/nights/` and the demo night as `web/public/event.json` (`uv run python -m pipeline.nights`).
- `web/`: Vite + React + MapLibre GL + deck.gl. A replay of one real night, mobile-first.
- The packet draft comes from a deterministic EN/ES template built only from event fields. An optional Gemini drafter (`pipeline/gemini_draft.py`, see `docs/gemini.md`) sits behind a guard that rejects any number or ID not present in the input; it has not yet run successfully against Google's live API. A Claude drafter (`pipeline/claude_draft.py`) behind the same guard ran once on the demo night; its draft is published as `web/public/packet.ai.json` only because the guard passed, and the Packet step offers it beside the template. No API key ships in the web app.

## Run

```bash
uv sync && uv run pytest
cd web && npm install && npm run dev
```

Open the local site and select **Enter the replay**. Use `?intro=0#detect` to open the demo directly, or use a step hash such as `#packet` to deep-link to one of the four steps.

## License

MIT. See [LICENSE](LICENSE).
