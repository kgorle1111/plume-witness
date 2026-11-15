# Walk-back reader: runner, validation report, optional labeled eval

The reader (`pipeline/walkback.py`) reads the company's free text on each cached STEERS page (cause, actions
taken, basis for quantities, and any UPDATE notes inside them) and returns one record:
`{kind, compound, old_value, new_value, unit, date_of_change, quote}`. `kind` is one of `none`, `revised_down`,
`revised_up`, `declared_not_reportable_or_retracted`, `replaced_by_other_report`, `calculation_corrected`,
`affirmative_defense_claimed`.

A deterministic guard runs after every model answer. The quote must be a whitespace-normalized substring of one
free-text field. `old_value` and `new_value` must be plain numbers that appear in the free text or the
contaminant table (canonicalized with `gemini_draft._canon`, so `7,634` matches `7634.0`). The compound and unit
must appear on the page. The date must be one the page writes. If any check fails, or the call is refused, cut
off or fails, the page is recorded as `flagged_by_rule_not_read` and the answer is dropped. `new_value` is also
compared with the contaminant table for that compound. A mismatch is listed for a person and never resolved in
code. The only wording a reader sees is `The report says: "<quote>"`. Nothing here writes to the website.

## Run it (costs money; needs a key)

```sh
uv run python -m evals.walkback --dry-run                          # estimate only: no key, no call
ANTHROPIC_API_KEY=... uv run python -m evals.walkback --model sonnet --yes
```

- The default is `--model sonnet` (`claude-sonnet-5-5`) on all 317 pages. `--pages eval` runs only the eval set,
  and `--limit N` runs only the first N pages.
- The estimate is printed before anything else. Without `--yes` the run stops there (exit 2). With `--yes` but
  no `ANTHROPIC_API_KEY` it also exits 2. The key comes from the environment only, never from a file.
- **Hard budget.** Before each page, the runner adds that page's worst-case cost (estimated input plus a full
  `max_tokens` of output, priced at Opus rates because a server-side fallback can choose the model) to the
  *measured* spend so far, taken from `usage` × list price. If the sum would pass `--max-usd` (default 30), the
  runner stops cleanly and exits 3. Rows are flushed one per page, so partial results survive.
- Only 429 and 5xx responses are retried, with backoff of 2 s, 4 s, then 8 s (or `retry-after`, if longer), for
  at most 4 attempts. The SDK's own retries are off. Each call has a 60 s timeout. Each page's `request_id` is
  logged and stored in its row.
- Output goes to `data/build/walkback/run-<tier>-<stamp>.jsonl` plus `.report.md`, which is gitignored.

## The validation report is not an accuracy measurement

`run-*.report.md` (rebuild it with `uv run python -m evals.walkback.report <run.jsonl>`) shows what can be
checked without labels:

- the guard pass rate and the rejection reasons
- counts per kind
- the contaminant-table cross-check
- agreement with the regex flagger and with `parse.steers_revisions`, with every page where they disagree
  listed for spot-checking
- a seeded 20-page sample to skim against the TCEQ links: up to 10 of the LLM's material changes, the rest drawn
  from the other pages

Agreeing with a baseline does not make a reading correct.

## Baselines (no labels needed)

- **Parser** (`parse.steers_revisions`): reads 1 of 317 pages, `steers_425347`, the INEOS demo page.
- **Regex flagger** (`walkback.regex_read`): flags 43 of 317 using change, walk-back and UPDATE wording. An
  earlier pattern counted 39. It flags known noise as well: "piping was revised", "operator incorrectly
  assumed".

## Optional: the labeled eval (the only real accuracy number)

Nothing depends on this. Skip it unless you want precision and recall.

1. `uv run python -m evals.walkback.build_set` writes `eval_set.json`, `label_sheet.md` and an empty
   `labels.csv`. The set is all 43 regex-flagged pages plus 30 seeded-random unflagged pages, 73 in total.
   (Already generated; it refuses to overwrite labels.)
2. Label blind, about 1.5 h. Read `label_sheet.md` (shuffled, no machine answers, no stratum) and fill
   `labels.csv`: a kind for every row; old/new/compound/unit/date only where the page writes them. Copy numbers
   as written. "Material change" means any kind except `none` and `affirmative_defense_claimed`. Labels must come
   from a person, not a model. Don't open `eval_set.json` or any run file while labeling.
3. Run `uv run python -m evals.walkback.score`. It prints precision and recall (Wilson 95% CI), exact (old, new)
   pairs, verbatim-quote rate and changes claimed on unflagged pages, for the parser, the regex and each tier's
   newest run. The pass bar is P ≥ 0.90, R ≥ 0.90, ≥ 95% exact pairs, 100% verbatim, and 0 hallucinated changes
   on unflagged pages. Ship the smallest tier that passes.

With roughly 15 positives, 14/15 is a Wilson 95% CI of about 70-99%. Treat any pass on 73 pages as provisional
until it holds on a held-out set.
