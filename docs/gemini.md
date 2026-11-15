# Gemini packet drafter

> **Status: untested against the live API.** Every test uses a fake client, and one smoke run used the
> real `google-genai` client against a local stub server. That run checked the request path, the
> key-in-header behavior and the config serialization. No call has reached Google yet. Remove this
> label only after someone runs the command below with a real key and pastes the output into the PR.

`pipeline/gemini_draft.py` turns the event facts into a plain-language EN/ES packet draft with **one**
structured Gemini call. A deterministic guard then checks the draft, and a person always reviews it.

```
event.json facts  ->  one Gemini call (JSON schema {draft_en, draft_es})  ->  guard  ->  packet
                                                                        \->  guard fails / call fails:
                                                                             template packet, guard.passed=false
```

## Enable it

```bash
GEMINI_API_KEY=... uv run python -m pipeline.gemini_draft \
  --event web/public/event.json --out data/build/packet.gemini.json
```

- The key is read **only** from `GEMINI_API_KEY`. No `.env` file is read. The key is sent to the API
  as the `x-goog-api-key` header, is never logged, and is scrubbed from any error text before output.
- Exit codes: `0` means the Gemini draft passed the guard. `1` means the file was written, but it holds
  the template fallback and lists the rejected items. `2` means a missing key or an invalid event, and
  nothing was written.
- `data/build/` is gitignored. This module does not write into `event.json`. Wiring it into
  `pipeline/build.py` is a separate integration step.

## What the model sees

`facts_for(event)` passes only event facts: the detection, the monitors over the trigger that hour, the
wind at that hour, the corridor facility count and the 5 nearest facilities (with ids), the record
check (incident, matched facility, reported pounds and times), and `cannot_say`. The prompt adds the
wording rules: hedged "consistent with", no verdict words, roughly 6th-grade language, Spanish for
`draft_es`, and numbers copied exactly in both languages. Provenance hashes, the full hourly arrays and
the template text are **not** sent.

## The guard (fail closed)

Any one of these rejects the draft and returns the template packet with `guard.passed = false`:

| Check | Rule |
|---|---|
| Numbers | Every number in either draft must exist in the facts. `7,634` matches `7634.0` and `06` matches `6`. |
| Ids | AQS site ids, RNs and digit runs of 6 or more (STEERS incidents, EPA registry ids) must appear character for character. |
| Times | `H:MM` must be a time in the facts or the detection hour (12-hour forms allowed). |
| Words | `illegal`, `violat*`, `unreported`, `polluter`, `caught`, `catches`, `proves`, `proven`, plus the Spanish verdicts (`ilegal`, `violación`, `infracción`, `no reportad*`, `contaminador`, `demuestra`...). The check runs after NFKC normalization and after zero-width characters are removed. |
| Length | 150 to 1,600 characters per draft. |
| Call | Timeout of 30 s. One retry, only on 429/5xx. Any other error, empty output or non-JSON output falls back. |

**Known ceilings:**
- The number check is set membership. A wrong number that happens to appear elsewhere in the facts
  (an hour from 0 to 23, a rank) still passes.
- Numbers written as words and invented names are not checked.
- A Spanish draft that writes `51,75` (decimal comma) is rejected. That is fail closed, but it costs a
  fallback. The prompt tells the model to keep `.` for decimals in Spanish.

Upgrade path: bind each number to its field and check named entities against the facts.

## Model and cost

- Model: `gemini-3.8-flash`, stable, Flash tier. Source: <https://aistudio.google.com/docs/models/gemini-3.8-flash>.
  `ai.google.dev/gemini-api/docs/*` now redirects to aistudio.google.com/docs.
- SDK: `google-genai==3.3.0`, released 2026-11-12 on PyPI. The SDK's own retries are turned off, so this
  module owns the single retry.
- Thinking level: `LOW`. This model rejects `minimal`.

Pricing source: <https://aistudio.google.com/docs/pricing>, checked 2026-11-14. Paid tier per 1M tokens:
input $0.75 and output (including thinking) $3.75 through 2026-12-31, then $1.50 and $7.50 from
2027-01-01. A free tier exists.

These are estimates, not measured. The prompt is about 4,000 characters, roughly 1,000 to 1,300 input
tokens. Output is two drafts of about 700 characters plus low thinking, roughly 600 to 1,500 tokens.

| Per call | Through 2026-12-31 | From 2027-01-01 |
|---|---|---|
| Typical (1.3k in, 1.5k out) | ~$0.007 | ~$0.013 |
| Worst case (1.3k in, 4,096-token output cap, retried once) | ~$0.033 | ~$0.066 |

One call per built event, so a 5-night demo costs well under $0.50. Replace these estimates with
`usage_metadata` from the first live run.

Cheaper option to evaluate: `gemini-3.5-flash-lite` ($0.30 / $2.50). Switch only after comparing
guard-pass rates on real events.

## Needs a key to verify

1. A live call succeeds and `response.text` is the JSON object (no fences or extra keys).
2. The API accepts `thinkingConfig.thinking_level` as the SDK serializes it (snake_case inside a
   camelCase body).
3. The real draft passes the guard on `web/public/event.json`, including that Spanish numbers keep `.`
   decimals.
4. Real token counts and latency, recorded here in place of the estimates above.
