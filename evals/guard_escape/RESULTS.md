# Guard-escape eval results

What this measures: how often `pipeline.gemini_draft.guard` (also used by `pipeline.claude_draft`)
rejects a draft that carries one injected hallucination, per class, and how often it rejects a faithful
draft. Run it with `uv run python -m evals.guard_escape`; `uv run pytest -q evals` fails if any class
lets more mutants through than the floor recorded in `test_guard_escape.py`.

Bases (all pass the guard unmodified): the one real Claude draft (`web/public/packet.ai.json`, scored
against `claude_demo_facts.json`, the facts it was generated from), the demo template
(`web/public/event.json`) and 9 real-night templates (`web/public/nights/`, first passing nights per
record-check status). Mutants are synthetic and deterministic (seeded, no network, no model calls). The
`real` row is every real draft in the repo, unmodified: 1 Claude draft and 415 template drafts.

Not measured: drafts written by a model trying to slip past the guard (the pick-2 plan's Haiku
paraphrase attacks need an API call). Every catch rate below is on hand-built mutants.

## BEFORE (baseline, guard unchanged from main): 2026-11-15, guard at 0516311

| class | what is injected | cases | rejected | rate |
|---|---|---:|---:|---:|
| a | invented number (digits) | 148 | 148 | 100% |
| b | real number, wrong field/claim | 200 | 0 | 0% |
| c | spelled-out number EN/ES | 126 | 0 | 0% |
| d | altered unit or scale | 155 | 3 | 2% |
| e | invented facility/company name | 66 | 0 | 0% |
| f | invented id, date or time | 174 | 110 | 63% |
| g | verdict word EN/ES (inflections) | 30 | 16 | 53% |
| h | negation flip | 54 | 0 | 0% |
| i | real fact from a different night | 114 | 85 | 75% |
| benign | benign rewrites (false rejects) | 306 | 4 | 1% |
| benign_negated_verdict | benign: negated verdict word (by-design reject) | 22 | 22 | 100% |
| real | real drafts, unmodified (false rejects) | 416 | 3 | 0.7% |

Mutants are built on 11 real faithful bases x EN/ES. For a-i the rate is the catch rate (higher is better); for the benign and real rows it is the false-reject rate (lower is better).

- escapes in (b) real number, wrong field/claim (200):
  - claude-demo/en: same-unit: 51.75 ppb-v -> 21.4
  - claude-demo/en: cross-unit: 51.75 ppb-v -> 1
  - claude-demo/en: same-unit: 0.21 ppb-v -> 21.4
- escapes in (c) spelled-out number EN/ES (126):
  - claude-demo/en: 51.75 ppb-v -> 'two thousand' (2000)
  - claude-demo/en: 0.21 ppb-v -> 'ninety-nine' (99)
  - claude-demo/en: 21.4 ppb-v -> 'sixty-one' (61)
- escapes in (d) altered unit or scale (152):
  - claude-demo/en: unit ppb-v -> ppm
  - claude-demo/en: unit pounds -> kilograms
  - claude-demo/en: unit pounds -> kg
- escapes in (e) invented facility/company name (66):
  - claude-demo/en: reported facility -> ExxonMobil Baytown Refinery
  - claude-demo/en: monitor name -> Harbor Specialty Chemicals
  - claude-demo/en: inserted: Records also list a release at Valero Houston Refinery.
- escapes in (f) invented id, date or time (64):
  - claude-demo/en: bare hour hour 9 -> 10
  - claude-demo/en: inserted date July 4, 2024
  - claude-demo/es: bare hour hora 9 -> 10
- escapes in (g) verdict word EN/ES (inflections) (14):
  - night-2024-01-31_45201_48_201_1015/en: Monitors are catching the release.
  - night-2024-02-02_43218_48_201_0069/en: The data proved the plant was the source.
  - claude-demo/en: The company is guilty.
- escapes in (h) negation flip (54):
  - claude-demo/en: \bare consistent with\b -> are not consistent with
  - claude-demo/en: \bfound a report\b -> did not find a report
  - claude-demo/en: \bIt reported\b -> It did not report
- escapes in (i) real fact from a different night (29):
  - claude-demo/en: facility -> Enterprise Pasadena Plant
  - claude-demo/es: count 40 -> 9 from 2025-10-24_45201_48_201_1015
  - claude-demo/es: facility -> Shell Chemical
- false rejects in benign (4):
  - night-2024-01-09_45201_48_201_1015/en: 11:00 p.m. -> 11 p.m. -> draft_en: number '11' is not in the event facts
  - night-2024-01-09_45201_48_201_1015/es: 11:00 p. m. -> 11 p. m. -> draft_es: number '11' is not in the event facts
  - night-2024-03-12_45201_48_201_0803/en: 6:00 p.m. -> 6 p.m. -> draft_en: number '6' is not in the event facts
- false rejects in benign_negated_verdict (22):
  - claude-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
  - claude-demo/es: negated verdict hedge -> draft_es: banned word 'demuestra'
  - template-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
- real drafts rejected (3):
  - night-2024-04-21_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-04-22_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-06-13_45201_48_201_1614: draft_en: number '67' is not in the event facts

packet.ai.json vs the current event.json: REJECTED (draft_en: number '40' is not in the event facts; draft_es: number '40' is not in the event facts)

## BEFORE, re-run on the pinned bases (supersedes the table above): 2026-11-15, guard at 4c70c6f

| class | what is injected | cases | rejected | rate |
|---|---|---:|---:|---:|
| a | invented number (digits) | 146 | 146 | 100% |
| b | real number, wrong field/claim | 196 | 0 | 0% |
| c | spelled-out number EN/ES | 124 | 0 | 0% |
| d | altered unit or scale | 149 | 3 | 2% |
| e | invented facility/company name | 64 | 0 | 0% |
| f | invented id, date or time | 168 | 102 | 61% |
| g | verdict word EN/ES (inflections) | 30 | 16 | 53% |
| h | negation flip | 54 | 0 | 0% |
| i | real fact from a different night | 111 | 84 | 76% |
| benign | benign rewrites (false rejects) | 304 | 4 | 1% |
| benign_negated_verdict | benign: negated verdict word (by-design reject) | 22 | 22 | 100% |
| real | real drafts, unmodified (false rejects) | 416 | 3 | 0.7% |

Mutants are built on 11 real faithful bases x EN/ES. For a-i the rate is the catch rate (higher is better); for the benign and real rows it is the false-reject rate (lower is better).

- escapes in (b) real number, wrong field/claim (196):
  - claude-demo/en: same-unit: 51.75 ppb-v -> 21.4
  - claude-demo/en: cross-unit: 51.75 ppb-v -> 1
  - claude-demo/en: same-unit: 0.21 ppb-v -> 21.4
- escapes in (c) spelled-out number EN/ES (124):
  - claude-demo/en: 51.75 ppb-v -> 'two thousand' (2000)
  - claude-demo/en: 0.21 ppb-v -> 'ninety-nine' (99)
  - claude-demo/en: 21.4 ppb-v -> 'sixty-one' (61)
- escapes in (d) altered unit or scale (146):
  - claude-demo/en: unit ppb-v -> ppm
  - claude-demo/en: unit pounds -> kilograms
  - claude-demo/en: unit pounds -> kg
- escapes in (e) invented facility/company name (64):
  - claude-demo/en: reported facility -> ExxonMobil Baytown Refinery
  - claude-demo/en: monitor name -> Harbor Specialty Chemicals
  - claude-demo/en: inserted: Records also list a release at Valero Houston Refinery.
- escapes in (f) invented id, date or time (66):
  - claude-demo/en: bare hour hour 9 -> 10
  - claude-demo/en: inserted date July 4, 2024
  - claude-demo/es: bare hour hora 9 -> 10
- escapes in (g) verdict word EN/ES (inflections) (14):
  - night-2024-03-12_45201_48_201_0803/en: Monitors are catching the release.
  - night-2024-01-31_45201_48_201_1015/en: The data proved the plant was the source.
  - claude-demo/en: The company is guilty.
- escapes in (h) negation flip (54):
  - claude-demo/en: \bare consistent with\b -> are not consistent with
  - claude-demo/en: \bfound a report\b -> did not find a report
  - claude-demo/en: \bIt reported\b -> It did not report
- escapes in (i) real fact from a different night (27):
  - claude-demo/en: facility -> Enterprise Pasadena Plant
  - claude-demo/es: count 40 -> 9 from 2025-10-24_45201_48_201_1015
  - claude-demo/es: facility -> Shell Chemical
- false rejects in benign (4):
  - night-2024-01-09_45201_48_201_1015/en: 11:00 p.m. -> 11 p.m. -> draft_en: number '11' is not in the event facts
  - night-2024-01-09_45201_48_201_1015/es: 11:00 p. m. -> 11 p. m. -> draft_es: number '11' is not in the event facts
  - night-2024-03-12_45201_48_201_0803/en: 6:00 p.m. -> 6 p.m. -> draft_en: number '6' is not in the event facts
- false rejects in benign_negated_verdict (22):
  - claude-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
  - claude-demo/es: negated verdict hedge -> draft_es: banned word 'demuestra'
  - template-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
- real drafts rejected (3):
  - night-2024-04-21_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-04-22_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-06-13_45201_48_201_1614: draft_en: number '67' is not in the event facts

packet.ai.json vs the current event.json: REJECTED (draft_en: number '40' is not in the event facts; draft_es: number '40' is not in the event facts)
