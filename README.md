# Plume Witness

**When a Texas state air monitor records a pollution spike, Plume Witness traces the air upwind, lists the facilities in its path, and checks whether any of them filed the emissions-event report Texas requires, so community advocates get evidence they can review and file.**

> **Status: in progress.** Built at GDG on Campus UCSC DevFest Hackathon 2026 (Best Social Impact track). Nothing here is a finished product. Results are labeled with what they are measured on.

## Why

Industrial facilities in Texas report their own unplanned releases ("emissions events") to the state. The Environmental Integrity Project counted **21,769** such events in Texas in FY2017-2022; the state designated **0.5%** of them "excessive". Fenceline advocates check these self-reports against what the air actually showed by hand, slowly, for a few events a year. Plume Witness automates that check for one corridor, starting with the Houston Ship Channel.

## What it does

1. **Detect**: a spike on a state (TCEQ) regulator-grade monitor, such as hourly benzene from an AutoGC site. Low-cost sensors are never the trigger.
2. **Trace**: the hourly wind at the monitor points upwind; every major facility within 15 km and ±22.5° of that direction is listed, nearest first. Wind alone can't tell them apart, so nothing is ranked as a likely source. This is geometry, not a dispersion model, and it says so.
3. **Check the record**: it searches every emissions-event report filed that day in the county, places each on the map, and checks at 24 hours and 14 days whether one in the corridor matches. Status is one of: *reported*, *not yet reported*, *no report after the deadline*, *reported, but compounds or timing don't match*.
4. **Packet**: a hedged evidence summary ("evidence consistent with…") in English and Spanish. A person always reviews, edits and files it. Nothing is sent automatically.

## What it can't say

- **"Not yet reported" is not "illegal".** Texas requires a report only when a release exceeds a reportable quantity (30 TAC 101.201), and air readings can't measure how much was released.
- Facilities along the same bearing can't be told apart from one monitor's wind; the app lists them and checks the record instead of naming a source.
- It sees only what the state's monitors see. Many neighborhoods have no regulator-grade monitor.

## Data (all public)

- TCEQ ambient monitoring (AutoGC hourly VOCs, site meteorology)
- TCEQ Air Emission Event Report Database (STEERS)
- EPA ECHO / TRI facility locations
- Map data © OpenStreetMap contributors

## Stack

- `pipeline/`: Python 3.12, uv, pytest. Pulls public data, detects, lists the upwind corridor, checks the record, writes `web/public/event.json`.
- `web/`: Vite + React + MapLibre GL + deck.gl. A replay of one real night, mobile-first.
- The packet draft comes from a deterministic EN/ES template built only from event fields. An optional Gemini drafter (`pipeline/gemini_draft.py`, see `docs/gemini.md`) sits behind a guard that rejects any number or ID not present in the input; it has not been run against the live API. No API key ships in the web app.

## Run

```bash
uv sync && uv run pytest
cd web && npm install && npm run dev
```

## License

MIT. See [LICENSE](LICENSE).
