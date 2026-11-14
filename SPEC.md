# Plume Witness: confirmed build spec (Sat Nov 14, 2026)

**One line:** When a Texas state benzene monitor on the Houston Ship Channel spikes, Plume Witness ranks the facilities upwind and checks whether they filed the emissions-event report Texas requires, at 24 hours and at 14 days, and hands fenceline advocates a hedged, plain-language (EN/ES) packet that a person reviews and files. Shown on one real night of public data.

**Track:** Best Social Impact. **Deadline:** Sun 8:30am PST (submit by 7:00am).

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Track | Social Impact | Highest win odds (strategist ~30%); rewards the research and harms work |
| Map | Stage 1: 2D interactive replay. Stage 2 (if time): MapLibre globe projection | Same library, so the globe is an upgrade, not a rewrite |
| Stack | Python 3.12 + uv + pytest pipeline → `event.json`; Vite + React + MapLibre GL + deck.gl; OpenFreeMap tiles; Firebase Hosting (Spark) | Static site, no server to keep alive at the table |
| Gemini | One structured call at build time drafts the packet narrative; deterministic guard rejects any number or ID not in the input; labeled "drafted by Gemini" | No key in the browser; public data only |
| Data | 1 real reported night first; up to 5 if the pipeline works by ~1am | n stated on screen |
| If the data check fails | Try another Ship Channel monitor or another city for up to 1h, then decide | |
| Access | EN/ES plain-language alert mock; text equivalent of the map; read-aloud packet summary; mobile-first + QR | Access barriers are a Social Impact criterion |
| Team | You build most; teammates do outreach, research, pitch and video | Names and roles still to fill in |

## Core build (stage 1)
1. **Data gate (first):** find one 2024-2025 benzene or 1,3-butadiene event a company *did* report in STEERS near a Ship Channel TCEQ AutoGC monitor; pull that monitor's hourly readings and wind for that night.
2. Pipeline: detect spike vs site baseline → rank ECHO/TRI facilities within ~10 km by wind-sector score (labeled as such, no HYSPLIT) → STEERS status at T+24h and T+14d (`reported` / `not yet reported` / `no report after deadline` / `reported, mismatch`) → Gemini draft + guard → `event.json`. pytest on every step; a mutation test that must go red.
3. Web: replay map (monitor pulse, hourly wind path, ranked facilities); Detect → Trace → Check → Packet stepper; packet edit/approve (person files); "What this can't say" panel; EN/ES alert; ranked text list; read-aloud.
4. Deploy on Firebase Hosting; QR code on the table; re-record the 2-minute video on the real replay.

## Never
"illegal", "unreported" as a verdict, "catches", "proves". Never trigger on PurpleAir. Never name a facility in a demo without its real public record behind it. No PII anywhere.

## Evidence work (teammates)
- 3+ conversations: Houston fenceline groups (Air Alliance Houston, TEJAS, Fenceline Watch, EIP) and people at home; ask the consent and usefulness question; quote only with permission.
- Cited "Voices" slide from published accounts; impact-metrics screen (hours-to-complaint, investigations, corrected reports), no invented baselines.

## Open
- Team names; presenter, submitter, checker (checker ≠ submitter).
- Verify: AutoGC hourly history for a past date is retrievable; the monitor site reports wind; STEERS detail pages load for the chosen incident.
- OpenFreeMap terms and a dark style; deck.gl and MapLibre versions pinned.
