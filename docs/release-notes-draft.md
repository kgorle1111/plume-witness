# Plume Witness v1.0 — DevFest 2026

Plume Witness is a fact-checker for the pollution reports Texas companies file about themselves. When a state air monitor spikes, it traces the air upwind, lists the facilities in its path, and checks whether any of them filed the emissions-event report Texas requires. A person reviews and files every packet; the app sends nothing. <!-- CL-008 -->

**Live site:** https://kgorle1111.github.io/plume-witness/ · **Video:** [VIDEO_URL] · **Devpost:** [DEVPOST_URL]

## Highlights

- **Four-step replay of a real night: Detect, Trace, Check, Packet.** On 2024-06-21 the Houston Milby Park monitor read 51.75 ppb of benzene against a 7-day median of 0.21 ppb, below the Texas 1-hour benzene health value. <!-- CL-001 --> The upwind corridor holds 47 major facilities; it is wind direction at one monitor, not a dispersion model, so it cannot tell facilities on the same bearing apart. <!-- CL-004 --> The record check finds the company's own report, filed inside both deadlines, so this night shows the check passing. <!-- CL-005 CL-006 -->
- **Past spikes.** A log of 468 spikes at 12 monitors with a CSV download and a calendar, 466 replayable nights, and a place search with neighborhood shortcuts. <!-- CL-031 -->
- **Built for the people who check reports by hand.** A two-year timeline, a history page for each of 194 facilities near the monitors, RSS feeds per monitor, an embeddable replay for newsrooms, a printable 2-page method brief, documented open data files, install-as-app with offline replay, and a second region, Beaumont-Port Arthur, with 2 monitors. <!-- CL-033 -->
- **English and Spanish,** with read-aloud on the packet. <!-- CL-009 -->
- **AI behind a guard.** An optional Claude draft of the packet passed the same number check, which rejects any number, ID or time not in the event; a person still approves and files it. <!-- CL-022 -->
- **Traceable data.** Every raw file is stored with its source URL, fetch time and SHA-256 hash. <!-- CL-018 -->

## Measured

- The record check has run on all 468 spikes at 12 Ship Channel monitors; 168 ended as no report after a complete search. These are questions for the state, never findings, and no facility is named. <!-- CL-011 -->
- A hand check of 10 no-report spikes picked at random: the gap held in 8 of 10, 2 of 10 could not be settled from public data, and 0 of 10 was a report the pipeline missed. One reviewer; with 10 nights the true miss rate could be as high as 28%. <!-- CL-032 -->
- Backtest on 77 releases companies reported: only 5 of 77 showed a spike at a state monitor from 1 hour before to 6 hours after the reported start, and the pipeline matched 1 of 77 end to end. A spike near the start is consistent with the release, not proof it caused the reading. <!-- CL-023 -->
- In 60 of 77 a state monitor within 15 km was downwind near the start, yet ordinary days at the same monitors and hours spiked in 26 of 410 windows; the 95% intervals overlap at every setting tested. <!-- CL-029 -->

## Known limits

- The upwind corridor is geometry, not a plume model, and it never names a source.
- Texas requires a report only for an emissions event at or above a reportable quantity, so a missing report is a question for the state, not a finding. <!-- CL-013 -->
- For the releases we backtested, hourly state monitors cannot confirm or contradict a company's report.
- It uses only regulator-grade TCEQ monitors, and many neighborhoods have none. TCEQ labels AutoGC data provisional.

Full method: [docs/brief.md](brief.md) and [docs/backtest.md](backtest.md).

## Links

- Live site: https://kgorle1111.github.io/plume-witness/
- Video: [VIDEO_URL]
- Devpost: [DEVPOST_URL]
- Source: https://github.com/kgorle1111/plume-witness (MIT)
