"""Run the walk-back reader over the cached STEERS pages, behind a cost estimate and a hard budget cap.

  uv run python -m evals.walkback --dry-run                       # estimate only, no key, no call
  ANTHROPIC_API_KEY=... uv run python -m evals.walkback --model sonnet --yes

Every invocation prints the estimate first. Without --yes it stops there. With --yes it needs
ANTHROPIC_API_KEY (exit 2 if unset), calls the API once per page, writes one JSONL row per page as it goes, and
stops cleanly before any page whose worst-case cost would push the measured running cost over --max-usd.
Output goes to data/build/walkback/ (gitignored); nothing here touches the website.

Exit: 0 finished; 2 refused (no --yes, no key, estimate over the cap, bad args); 3 stopped at the budget cap.
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from evals.walkback import report
from pipeline import walkback as wb

OUT = wb.ROOT / "data" / "build" / "walkback"
EVAL_SET = Path(__file__).resolve().parent / "eval_set.json"


def estimate_table(pages: list[dict], eval_ids: list[str]) -> str:
    ev = [p for p in pages if p["page_id"] in set(eval_ids)]
    lines = [(f"Cost estimate (input ~chars/{wb.CHARS_PER_TOKEN}; output {wb.EST_OUTPUT_TOKENS} tokens/page "
              f"expected, {wb.MAX_TOKENS} worst case; list prices per MTok):"),
             f"{'tier':7} {'model':18} {'in $/out $':>11} | {'eval set':>22} | {'all pages':>22}"]
    for tier, t in wb.TIERS.items():
        e, a = wb.estimate(ev, tier), wb.estimate(pages, tier)
        pin, pout = wb.PRICES[t["model"]]
        lines.append(f"{tier:7} {t['model']:18} {pin:>5.2f}/{pout:<5.2f} | {e['pages']:>3} pp ${e['usd']:>6.3f} "
                     f"(<=${e['usd_worst']:>6.2f}) | {a['pages']:>3} pp ${a['usd']:>6.3f} (<=${a['usd_worst']:>6.2f})")
    return "\n".join(lines)


def main(argv: list[str] | None = None, client=None, sleep=time.sleep, out_dir: Path = OUT) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model", choices=sorted(wb.TIERS), default=wb.DEFAULT_TIER)
    ap.add_argument("--pages", choices=("all", "eval"), default="all", help="all 315 pages, or the eval set only")
    ap.add_argument("--limit", type=int, help="first N pages of the selection (sorted by incident)")
    ap.add_argument("--max-usd", type=float, default=30.0)
    ap.add_argument("--dry-run", action="store_true", help="print the estimate and exit 0")
    ap.add_argument("--yes", action="store_true", help="actually call the API (costs money)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.limit is not None and args.limit < 1:
        print("error: --limit must be at least 1", file=sys.stderr)
        return 2

    pages = [wb.load_page(p) for p in wb.page_paths()]
    eval_ids = json.loads(EVAL_SET.read_text())["page_ids"] if EVAL_SET.exists() else []
    sel = [p for p in pages if args.pages == "all" or p["page_id"] in set(eval_ids)][: args.limit]
    print(estimate_table(pages, eval_ids))
    est = wb.estimate(sel, args.model)
    print(f"\nThis run: {args.model} ({wb.TIERS[args.model]['model']}) on {len(sel)} pages: expected "
          f"${est['usd']:.3f}, worst case ${est['usd_worst']:.2f}; hard cap --max-usd ${args.max_usd:.2f}.")
    if args.dry_run:
        return 0
    if not args.yes:
        print("Estimate only. Re-run with --yes to call the API.", file=sys.stderr)
        return 2
    if est["usd"] > args.max_usd:
        print(f"refusing: the expected cost ${est['usd']:.2f} is over --max-usd ${args.max_usd:.2f}", file=sys.stderr)
        return 2
    if client is None:
        try:
            client = wb.make_client()
        except wb.MissingKeyError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    urls = wb.page_urls()
    out_dir.mkdir(parents=True, exist_ok=True)
    run = out_dir / f"run-{args.model}-{time.strftime('%Y%m%dT%H%M%S')}.jsonl"
    spent, done, stopped = 0.0, 0, False
    with run.open("w") as fh:
        for page in sel:
            nxt = wb.worst_case_next(page, args.model)
            if spent + nxt > args.max_usd:
                print(f"budget stop before {page['page_id']}: spent ${spent:.4f} + worst case ${nxt:.4f} for the "
                      f"next page > --max-usd ${args.max_usd:.2f}; {done}/{len(sel)} pages written", file=sys.stderr)
                stopped = True
                break
            rec = wb.llm_read(page, client, args.model, sleep=sleep)
            spent += rec["cost_usd"]
            row = {"page_id": page["page_id"], "url": urls.get(page["page_id"]), "llm": rec,
                   "regex": wb.regex_read(page), "parser": wb.parser_read(page)}
            fh.write(wb.redact(json.dumps(row, ensure_ascii=False)) + "\n")
            fh.flush()  # partial results survive a crash or a budget stop
            done += 1
    rows = report.load_run(run)
    rep = run.with_suffix(".report.md")
    rep.write_text(report.render(rows, run.name))
    print(f"wrote {run} ({done} pages, measured ${spent:.4f}) and {rep}")
    return 3 if stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
