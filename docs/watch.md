# Watch feeds

Plume Witness publishes RSS feeds of its past-spikes log, so anyone can follow a monitor without an account.
The site is static: there is no server, no email and nothing posted to social media. A feed is a file; your feed
reader fetches it.

| Feed | Contents |
| --- | --- |
| `feeds/all.xml` | The 100 newest spikes at all monitors |
| `feeds/<site_id>.xml` | Every spike at one monitor, newest first (for example `48_201_0069` is Houston Milby Park) |
| `feeds/index.json` | The list of feeds with item counts |

Live addresses start with `https://kgorle1111.github.io/plume-witness/feeds/`. Paste one into any feed reader
(for example Feedly or NetNewsWire). The site also advertises `all.xml` in its page head, so most readers find it
from the home page.

## What an item says

Date and hour (CST), monitor, compound, the reading against its own 7-day baseline, and the record-check result in
plain words, with links to the replay (`?night=<id>`) and to that monitor's spike list. Item text never names a
facility; a test checks every item against the facility names in the backtest. For a spike with no matching
company report the text is: "No matching company report was found in a complete search. This is a question for the
state, not a finding."

GUIDs are `plume-witness:<night_id>`, so a reader will not show the same spike twice when a feed is rebuilt.
Feed output depends only on `spikes.json` (no clock), so rebuilding unchanged data changes no bytes.

## Coverage and freshness (read this before relying on it)

- **Fixed period.** The feeds cover 2024-2025 (468 spikes). They are rebuilt with
  `uv run python -m pipeline.feeds` when `spikes.json` is regenerated; no scheduled job fetches newer TCEQ data,
  so a feed reader shows new items only after a rebuild.
- **Data lag is not measured.** How long after an hour TCEQ publishes AutoGC values, and how long after a
  release a STEERS report appears, are not measured here. A recent spike may show a result that changes later.

## False-alarm caveat

A spike is a monitor reading at or above 10 times its own 7-day median and at least 10 ppb. How many spikes are
instrument faults or come from non-industrial sources (traffic, ships) is not measured, and TCEQ marks these hourly
values provisional. "No matching report" is a question to ask the state, not a conclusion. A hand audit of a random
sample of the "no report" results is in [`audit-no-report.md`](audit-no-report.md).
