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

Not measured: drafts written by a model trying to slip past the guard (model-written paraphrase
attacks need an API call). Every catch rate below is on hand-built mutants.

## BEFORE (baseline, guard unchanged from main): 2026-11-15, guard at 02f3646 (rebased; was 0516311)

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

## BEFORE, re-run on the pinned bases (supersedes the table above): 2026-11-15, guard at d5e2a7a (rebased; was 4c70c6f)

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

## AFTER (guard fixes): 2026-11-15, guard at e5d66af (rebased; was 689e160)

| class | what is injected | cases | rejected | rate |
|---|---|---:|---:|---:|
| a | invented number (digits) | 146 | 146 | 100% |
| b | real number, wrong field/claim | 196 | 120 | 61% |
| c | spelled-out number EN/ES | 124 | 124 | 100% |
| d | altered unit or scale | 149 | 149 | 100% |
| e | invented facility/company name | 64 | 57 | 89% |
| f | invented id, date or time | 168 | 166 | 99% |
| g | verdict word EN/ES (inflections) | 30 | 30 | 100% |
| h | negation flip | 54 | 1 | 2% |
| i | real fact from a different night | 111 | 109 | 98% |
| benign | benign rewrites (false rejects) | 304 | 0 | 0% |
| benign_negated_verdict | benign: negated verdict word (by-design reject) | 22 | 22 | 100% |
| real | real drafts, unmodified (false rejects) | 416 | 4 | 1.0% |

Mutants are built on 11 real faithful bases x EN/ES. For a-i the rate is the catch rate (higher is better); for the benign and real rows it is the false-reject rate (lower is better).

- escapes in (b) real number, wrong field/claim (76):
  - claude-demo/en: same-unit: 51.75 ppb-v -> 21.4
  - claude-demo/en: same-unit: 0.21 ppb-v -> 21.4
  - claude-demo/en: same-unit: 21.4 ppb-v -> 51.75
- escapes in (e) invented facility/company name (7):
  - template-demo/en: inserted: Acme Chemical also operates in the upwind corridor.
  - claude-demo/en: single-word name: Acme also operates nearby.
  - claude-demo/es: single-word name: Acme también opera cerca.
- escapes in (f) invented id, date or time (2):
  - night-2025-03-06_45201_48_201_0307/en: date March 6, 2025 -> March 7, 2025
  - night-2025-03-06_45201_48_201_0307/es: date 6 de marzo de 2025 -> 7 de marzo de 2025
- escapes in (h) negation flip (53):
  - claude-demo/en: \bare consistent with\b -> are not consistent with
  - claude-demo/en: \bfound a report\b -> did not find a report
  - claude-demo/en: \bIt reported\b -> It did not report
- escapes in (i) real fact from a different night (2):
  - claude-demo/es: facility -> Shell Chemical
  - template-demo/es: count 47 -> 5 from 2024-01-26_45201_48_201_1015
- false rejects in benign_negated_verdict (22):
  - claude-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
  - claude-demo/es: negated verdict hedge -> draft_es: banned word 'demuestra'
  - template-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
- real drafts rejected (4):
  - night-2024-04-21_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-04-22_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-06-13_45201_48_201_1614: draft_en: number '67' is not in the event facts

packet.ai.json vs the current event.json: REJECTED (draft_en: number '40' is not in the event facts; draft_en: '40' is not a facility count in the event facts; draft_es: number '40' is not in the event facts; draft_es: '40' is not a facility count in the event facts)

## Summary: before -> after (pinned bases, same 1,042 mutants)

| class | what is injected | before | after |
|---|---|---:|---:|
| a | invented number (digits) | 146/146 (100%) | 146/146 (100%) |
| b | real number, wrong field/claim | 0/196 (0%) | 120/196 (61%) |
| c | spelled-out number EN/ES | 0/124 (0%) | 124/124 (100%) |
| d | altered unit or scale | 3/149 (2%) | 149/149 (100%) |
| e | invented facility/company name | 0/64 (0%) | 57/64 (89%) |
| f | invented id, date or time | 102/168 (61%) | 166/168 (99%) |
| g | verdict word EN/ES (inflections) | 16/30 (53%) | 30/30 (100%) |
| h | negation flip | 0/54 (0%) | 1/54 (2%) |
| i | real fact from a different night | 84/111 (76%) | 109/111 (98%) |
| benign | false rejects on 304 benign rewrites | 4 (1.3%) | 0 (0%) |
| real | false rejects on 416 real drafts | 3 (0.7%) | 4 (1.0%) |

Read the after column as an upper bound: the fixes were written against these mutants, so it is an
in-sample score. The out-of-sample test is model-written attacks, which this eval does not run.

Known leaks (left open on purpose; the floors in `test_guard_escape.py` allow exactly these):
- (b) 76: a real number moved within one unit (the baseline stated as the peak, one monitor's
  reading given to another, the 5 nearest facilities called the corridor), and a real number with no
  unit next to it ("filed 47 reports"). Closing it needs claim-level slots (which sentence states the
  peak, the baseline, the pounds), not more regex.
- (h) 53: negation flips ("did not file", "not consistent with", "the search is complete"). The guard
  has no notion of polarity; the 1 catch is "No reportó", which now hits the verdict list.
- (e) 7: a one-word invented name at the start of a sentence ("Acme also operates nearby"), any
  one-word invented name in Spanish (single capitalized words are skipped there because translated place
  names are capitalized: "el Canal de Navegación"), and names built only from words of one real name
  ("Acme Chemical" passes because "Chemical" is in "Flint Hills Resources Houston Chemical").
- (f) 2: a real date from elsewhere in the facts (2025-03-07, the reported release's end date) stated as the event date
  passes, for the same reason as (b).
- (i) 2: another night's corridor count (5) that equals this night's 5 nearest facilities, and another
  night's "Shell Chemical" at the start of a Spanish sentence ("Chemical" is in a real fact name).
- By design: a negated verdict ("This is not proof that...", "Esto no demuestra que...") is rejected
  22/22. The ban list cannot see negation, and loosening it would let the positive form through.

Findings outside the guard (not fixed here):
- `web/public/packet.ai.json` is stale. It was generated against the event that had 40 corridor
  facilities; the event was regenerated with 47 in 18f8abd, and the published draft still says 40. Both
  the old and the fixed guard reject it against the current `event.json` (number 40), yet the web app
  shows it with `guard.passed: true`. The eval scores it against `claude_demo_facts.json`, the facts it
  was made from, where it passes. (Resolved in da3f919: the draft was regenerated against the 47-facility
  event, and it passes against the current `event.json`; see the last entry below.)
- The deterministic template rounds reported pounds: "8,470" for 8469.74 (2 nights), "67" for 66.6,
  and "0 pounds" for a 0.07 lb report. The guard demands the exact figure, so these 4 of 416 real drafts
  are rejected. The old guard let "0 pounds" through only because a 0 appeared elsewhere in the facts.

## 2026-11-15 rebased on the refreshed Claude draft (47 facilities): 2026-11-15, guard at da3f919 + uncommitted changes

| class | what is injected | cases | rejected | rate |
|---|---|---:|---:|---:|
| a | invented number (digits) | 148 | 148 | 100% |
| b | real number, wrong field/claim | 200 | 122 | 61% |
| c | spelled-out number EN/ES | 126 | 126 | 100% |
| d | altered unit or scale | 149 | 149 | 100% |
| e | invented facility/company name | 64 | 57 | 89% |
| f | invented id, date or time | 168 | 166 | 99% |
| g | verdict word EN/ES (inflections) | 30 | 30 | 100% |
| h | negation flip | 53 | 1 | 2% |
| i | real fact from a different night | 111 | 109 | 98% |
| benign | benign rewrites (false rejects) | 300 | 0 | 0% |
| benign_negated_verdict | benign: negated verdict word (by-design reject) | 22 | 22 | 100% |
| real | real drafts, unmodified (false rejects) | 416 | 4 | 1.0% |

Mutants are built on 11 real faithful bases x EN/ES. For a-i the rate is the catch rate (higher is better); for the benign and real rows it is the false-reject rate (lower is better).

- escapes in (b) real number, wrong field/claim (78):
  - claude-demo/en: same-unit: 51.75 ppb-v -> 21.4
  - claude-demo/en: same-unit: 0.21 ppb-v -> 21.4
  - claude-demo/en: same-unit: 21.4 ppb-v -> 51.75
- escapes in (e) invented facility/company name (7):
  - template-demo/en: inserted: Acme Chemical also operates in the upwind corridor.
  - claude-demo/en: single-word name: Acme also operates nearby.
  - claude-demo/es: single-word name: Acme también opera cerca.
- escapes in (f) invented id, date or time (2):
  - night-2025-03-06_45201_48_201_0307/en: date March 6, 2025 -> March 7, 2025
  - night-2025-03-06_45201_48_201_0307/es: date 6 de marzo de 2025 -> 7 de marzo de 2025
- escapes in (h) negation flip (52):
  - claude-demo/en: \bare consistent with\b -> are not consistent with
  - claude-demo/en: \bIt reported\b -> It did not report
  - claude-demo/en: \bcannot tell\b -> can tell
- escapes in (i) real fact from a different night (2):
  - claude-demo/es: facility -> Shell Chemical
  - template-demo/es: count 47 -> 5 from 2024-01-26_45201_48_201_1015
- false rejects in benign_negated_verdict (22):
  - claude-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
  - claude-demo/es: negated verdict hedge -> draft_es: banned word 'demuestra'
  - template-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
- real drafts rejected (4):
  - night-2024-04-21_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-04-22_43218_48_201_0069: draft_en: number '8,470' is not in the event facts
  - night-2024-06-13_45201_48_201_1614: draft_en: number '67' is not in the event facts

packet.ai.json vs the current event.json: passes

## 2026-11-15 template wording (S60, S62), exact pounds, display names (S57, S124), demo = night file (S51): 2026-11-15, guard at 383ccff + uncommitted changes

| class | what is injected | cases | rejected | rate |
|---|---|---:|---:|---:|
| a | invented number (digits) | 148 | 148 | 100% |
| b | real number, wrong field/claim | 200 | 122 | 61% |
| c | spelled-out number EN/ES | 126 | 126 | 100% |
| d | altered unit or scale | 149 | 149 | 100% |
| e | invented facility/company name | 64 | 57 | 89% |
| f | invented id, date or time | 168 | 166 | 99% |
| g | verdict word EN/ES (inflections) | 30 | 30 | 100% |
| h | negation flip | 53 | 1 | 2% |
| i | real fact from a different night | 112 | 111 | 99% |
| benign | benign rewrites (false rejects) | 300 | 0 | 0% |
| benign_negated_verdict | benign: negated verdict word (by-design reject) | 22 | 22 | 100% |
| real | real drafts, unmodified (false rejects) | 468 | 0 | 0.0% |

Mutants are built on 11 real faithful bases x EN/ES. For a-i the rate is the catch rate (higher is better); for the benign and real rows it is the false-reject rate (lower is better).

- escapes in (b) real number, wrong field/claim (78):
  - claude-demo/en: same-unit: 51.75 ppb-v -> 21.4
  - claude-demo/en: same-unit: 0.21 ppb-v -> 21.4
  - claude-demo/en: same-unit: 21.4 ppb-v -> 51.75
- escapes in (e) invented facility/company name (7):
  - template-demo/en: inserted: Acme Chemical also operates in the upwind corridor.
  - claude-demo/en: single-word name: Acme also operates nearby.
  - claude-demo/es: single-word name: Acme también opera cerca.
- escapes in (f) invented id, date or time (2):
  - night-2025-03-06_45201_48_201_0307/en: date March 6, 2025 -> March 7, 2025
  - night-2025-03-06_45201_48_201_0307/es: date 6 de marzo de 2025 -> 7 de marzo de 2025
- escapes in (h) negation flip (52):
  - claude-demo/en: \bare consistent with\b -> are not consistent with
  - claude-demo/en: \bIt reported\b -> It did not report
  - claude-demo/en: \bcannot tell\b -> can tell
- escapes in (i) real fact from a different night (1):
  - claude-demo/es: facility -> Shell Chemical
- false rejects in benign_negated_verdict (22):
  - claude-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'
  - claude-demo/es: negated verdict hedge -> draft_es: banned word 'demuestra'
  - template-demo/en: negated verdict hedge -> draft_en: banned word 'proof that'

packet.ai.json vs the current event.json: passes

What changed in the bases: only `template-demo` (web/public/event.json). It is now the demo night's file from the
nights run (12 monitors); its matched sentence reads "The reported release window and the wind line up with these
readings; other sources may also contribute." (ES "...coinciden con estas lecturas; otras fuentes también pueden
contribuir."), its ES says "reporte" for "informe", and the filer is "INEOS Americas Pasadena Site". The frozen night
bases are unchanged. The old negation patterns ("are consistent with", "son consistentes con", "presentó el
informe") no longer match the demo template, which dropped class (h) from 53 to 50 mutants; three patterns for the new
wording ("line up with", "coinciden con estas", "presentó el reporte") bring it back to 53. All three escape like the
ones they replace (the ban list cannot see negation), so every class keeps its count and catch rate and no floor in
test_guard_escape.py moved down.

Real drafts: 0 of 468 rejected (main before this change: 3). The template now prints the reported pounds as the report
gives them ("8,469.74326", "66.6") instead of rounding to "8,470" and "67", which the guard rightly rejected.
MAX_REAL_REJECTS goes from 4 to 0. packet.ai.json still passes against the new event.json (its "Ineos" differs from
"INEOS" only in case); it is to be regenerated separately.
