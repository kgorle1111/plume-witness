Plume Witness is a fact-checker for the pollution reports Texas companies file about themselves. When a state air monitor spikes, it traces the air upwind, lists the facilities in its path, and checks whether any of them filed the emissions-event report Texas requires. A person reviews and files every packet; the app sends nothing. <!-- CL-008 -->

**Live site:** https://kgorle1111.github.io/plume-witness/

## Highlights

- **Four-step replay of a real spike: Detect, Trace, Check, Packet.** On 2024-06-21 the Houston Milby Park monitor read 51.75 ppb of benzene against a 7-day median of 0.21 ppb, below the Texas 1-hour benzene health value. <!-- CL-001 --> The upwind corridor holds 47 major facilities within 9.3 mi (15 km); it is wind direction at one monitor, not a dispersion model, so it cannot tell facilities on the same bearing apart. <!-- CL-004 --> The record check finds the company's own report, filed inside both deadlines; the company reported, so this spike shows the check passing, not a missing report. <!-- CL-005 CL-006 -->
- **Past spikes.** A log of 468 spikes at 12 monitors with a CSV download and a calendar, replays 466 of those spikes, and a place search with neighborhood shortcuts. <!-- CL-031 -->
- **Statewide coverage and a second report source.** All 45 Texas AutoGC monitors in 10 regions on a Coverage page, the same check on every one with 2024-2025 data, and every spike checked against the federal National Response Center as well as the state's STEERS reports. <!-- CL-033 -->
- **Built for the people who check reports by hand.** A two-year spike timeline, a history page for each of 194 facilities near the Houston monitors, RSS feeds per monitor, an embeddable replay for newsrooms, a printable 2-page method brief, documented open data files, and install-as-app with offline replay. <!-- CL-033 -->
- **Plain status labels.** Every record check ends as Reported, Filed after the window, Reported to NRC, No matching report (a question, not a finding), or Can't say followed by the cause, such as "Can't say: wind too light". Distances read in miles first, with km in brackets.
- **English and Spanish,** with read-aloud on the packet. <!-- CL-009 -->
- **AI behind a guard.** An optional Claude draft of the packet passed the same number check, which rejects any number, ID or time not in the event; a person still approves and files it. <!-- CL-022 -->
- **Traceable data.** Every raw file is stored with its source URL, fetch time and SHA-256 hash. <!-- CL-018 -->

## Measured

- Across all 468 spikes in the Past spikes log, 167 ended as No matching report after a complete search, and 284 ended with the search incomplete, labeled Can't say with the cause named. A No matching report is a question for the state, never a finding, and no facility is named. <!-- CL-011 -->
- The federal National Response Center's 1,508 reports for Harris and Jefferson counties added 0 matches that STEERS had not found. <!-- CL-036 -->
- A hand check of 10 No matching report spikes picked at random: the gap held in 8 of 10, 2 of 10 could not be settled from public data, and 0 of 10 was a report the pipeline missed. With 10 spikes the true miss rate could be as high as 28%. <!-- CL-032 -->
- Backtest on 82 releases companies reported: only 5 of 82 showed a spike at a state monitor from 1 hour before to 6 hours after the reported start, and the pipeline matched 1 of 82 end to end. A spike near the start is consistent with the release, not proof it caused the reading. <!-- CL-023 -->
- In 64 of 82 a state monitor within 9.3 mi (15 km) was downwind near the start, yet ordinary days at the same monitors and hours spiked in 27 of 429 windows; the 95% intervals overlap at every setting tested. <!-- CL-029 -->

## Method and limits

- The upwind corridor is geometry, not a plume model, and it never names a source.
- Texas requires a report only for an emissions event at or above a reportable quantity, so a missing report is a question for the state, not a finding. <!-- CL-013 -->
- For the releases we backtested, hourly state monitors cannot confirm or contradict a company's report.
- It uses only regulator-grade TCEQ monitors, and many neighborhoods have none. TCEQ labels AutoGC data provisional.

Full method: [method brief](https://github.com/kgorle1111/plume-witness/blob/main/docs/brief.md) and [backtest report](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md).

## Credits

- Kannishk Naidu: pipeline, AI drafting and data; submits the project.
- Chanchal: landing page design and build; final check.
- Nagatanmayee ([@NagaGun](https://github.com/NagaGun)): replay redesign, ported into the app in PR #117.

## Links

- Live site: https://kgorle1111.github.io/plume-witness/
- Source: https://github.com/kgorle1111/plume-witness (MIT)
