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
