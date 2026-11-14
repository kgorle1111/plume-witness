# Plume Witness

**When a Texas state air monitor catches a pollution spike, Plume Witness traces the air upwind, ranks the facilities in its path, and checks whether they filed the emissions-event report Texas requires, so community advocates get evidence they can review and file.**

> **Status: in progress.** Built at GDG on Campus UCSC DevFest Hackathon 2026 (Best Social Impact track). Nothing here is a finished product. Results are labeled with what they are measured on.

## Why

Industrial facilities in Texas report their own unplanned releases ("emissions events") to the state. The Environmental Integrity Project counted **21,769** such events in Texas in FY2017-2022; the state designated **0.5%** of them "excessive". Fenceline advocates check these self-reports against what the air actually showed by hand, slowly, for a few events a year. Plume Witness automates that check for one corridor, starting with the Houston Ship Channel.

## What it does

1. **Detect**: a spike on a state (TCEQ) regulator-grade monitor, such as hourly benzene from an AutoGC site. Low-cost sensors are never the trigger.
2. **Trace**: the hourly wind at the monitor points upwind; facilities within about 10 km are ranked by how often the wind came from their direction. This is a wind-sector ranking, not a dispersion model, and it says so.
3. **Check the record**: at 24 hours and again at 14 days, it looks for a matching emissions-event report in the state's public database. Status is one of: *reported*, *not yet reported*, *no report after the deadline*, *reported, but compounds or timing don't match*.
4. **Packet**: a hedged evidence summary ("evidence consistent with…") in English and Spanish. A person always reviews, edits and files it. Nothing is sent automatically.

## What it can't say

- **"Not yet reported" is not "illegal".** Texas requires a report only when a release exceeds a reportable quantity (30 TAC 101.201), and air readings can't measure how much was released.
- Upwind ranking among closely clustered facilities is uncertain; the uncertainty is shown, not hidden.
- It sees only what the state's monitors see. Many neighborhoods have no regulator-grade monitor.

## Data (all public)

- TCEQ ambient monitoring (AutoGC hourly VOCs, site meteorology)
- TCEQ Air Emission Event Report Database (STEERS)
- EPA ECHO / TRI facility locations
- Map data © OpenStreetMap contributors

## Stack

- `pipeline/`: Python 3.12, uv, pytest. Pulls public data, detects, ranks, checks the record, writes `web/public/event.json`.
- `web/`: Vite + React + MapLibre GL + deck.gl. A replay of one real night, mobile-first.
- One Gemini call at build time drafts the packet narrative; a deterministic guard rejects any number or ID not present in the input. No API key ships in the web app.

## Run

```bash
uv sync && uv run pytest
cd web && npm install && npm run dev
```

## License

MIT. See [LICENSE](LICENSE).
