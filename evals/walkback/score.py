"""Optional labeled scorer. Needs labels.csv filled in by a person (never by a model); until then it refuses.

Scores the parser, the regex flagger and each LLM run on the eval set against the gold labels:
precision / recall on material changes (Wilson 95% intervals), exact (old, new) pairs, verbatim quotes, and
changes claimed on unflagged pages whose gold label is not a change. Pass bar from the D9 plan; the rule is to
ship the smallest tier that passes.

Usage: uv run python -m evals.walkback.score [--run sonnet=data/build/walkback/run-sonnet-....jsonl ...]
       (without --run, the newest run file per tier in data/build/walkback/ is used)
"""

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

from evals.walkback.__main__ import EVAL_SET, OUT
from evals.walkback.build_set import LABEL_COLS
from pipeline import walkback as wb
from pipeline.gemini_draft import _canon

LABELS = Path(__file__).resolve().parent / "labels.csv"
BAR = {"precision": 0.90, "recall": 0.90, "exact_pairs": 0.95, "verbatim": 1.0, "hallucinated_unflagged": 0}
TIER_ORDER = ("haiku", "sonnet", "opus")  # smallest first


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, mid - half), min(1.0, mid + half))


def load_gold(path: Path = LABELS) -> dict[str, dict[str, Any]]:
    gold = {}
    with path.open() as fh:
        for n, row in enumerate(csv.DictReader(fh), 2):
            kind = (row.get("kind") or "").strip()
            if not kind:
                continue
            if kind not in wb.KINDS:
                raise ValueError(f"{path.name} line {n}: kind {kind!r} is not one of {', '.join(wb.KINDS)}")
            gold[row["page_id"]] = {c: (row.get(c) or "").strip() or None for c in LABEL_COLS}
    return gold


def _pair(rec: dict[str, Any]) -> tuple[str | None, str | None]:
    return tuple(_canon(v.strip()) if v else None for v in (rec.get("old_value"), rec.get("new_value")))


def score(preds: dict[str, dict], gold: dict[str, dict], pages: dict[str, dict], unflagged: set[str]) -> dict:
    tp = fp = fn = pairs_ok = pairs_n = verb_ok = verb_n = halluc = 0
    for pid, g in gold.items():
        p = preds.get(pid) or {"status": "missing", "kind": None}
        gm, pm = g["kind"] not in wb.NOT_MATERIAL, wb.is_material(p)
        tp, fp, fn = tp + (gm and pm), fp + (pm and not gm), fn + (gm and not pm)
        if gm and (g["old_value"] or g["new_value"]):
            pairs_n += 1
            pairs_ok += pm and _pair(p) == _pair(g)
        if pm and p.get("quote"):
            verb_n += 1
            verb_ok += any(wb.norm(p["quote"]) in wb.norm(v) for v in pages[pid]["fields"].values())
        halluc += pid in unflagged and pm and not gm
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    out = {"tp": tp, "fp": fp, "fn": fn, "precision": prec, "precision_ci": wilson(tp, tp + fp), "recall": rec,
           "recall_ci": wilson(tp, tp + fn), "exact_pairs": pairs_ok / pairs_n if pairs_n else 0.0,
           "pairs_n": pairs_n, "verbatim": verb_ok / verb_n if verb_n else 1.0, "verbatim_n": verb_n,
           "hallucinated_unflagged": halluc, "n": len(gold)}
    out["passes"] = (prec >= BAR["precision"] and rec >= BAR["recall"] and out["exact_pairs"] >= BAR["exact_pairs"]
                     and out["verbatim"] >= BAR["verbatim"] and halluc <= BAR["hallucinated_unflagged"])
    return out


def _latest(tier: str) -> Path | None:
    runs = sorted(OUT.glob(f"run-{tier}-*.jsonl"))
    return runs[-1] if runs else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="append", default=[], help="tier=path to a run JSONL")
    args = ap.parse_args(argv)
    gold = load_gold() if LABELS.exists() else {}
    if not gold:
        print(f"no gold labels in {LABELS}: a person fills it (see evals/walkback/README.md). For an unlabeled "
              "check of a run, use: uv run python -m evals.walkback.report <run.jsonl>", file=sys.stderr)
        return 2
    sel = json.loads(EVAL_SET.read_text())
    unflagged = set(sel["unflagged_sample"])
    pages = {p["page_id"]: p for p in (wb.load_page(x) for x in wb.page_paths()) if p["page_id"] in gold}
    systems = {"parser": {pid: wb.parser_read(p) for pid, p in pages.items()},
               "regex": {pid: wb.regex_read(p) for pid, p in pages.items()}}
    runs = dict(r.split("=", 1) for r in args.run)
    for tier in TIER_ORDER:
        path = Path(runs[tier]) if tier in runs else _latest(tier)
        if path:
            rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
            systems[tier] = {r["page_id"]: r["llm"] for r in rows}
    print(f"{len(gold)} labeled pages ({len(unflagged & set(gold))} from the unflagged sample of "
          f"{sel['unflagged_population']}). Bar: P>={BAR['precision']} R>={BAR['recall']} pairs>={BAR['exact_pairs']}"
          " verbatim=1.0 hallucinated-on-unflagged=0")
    print(f"{'system':7} {'P':>5} {'95% CI':>11} {'R':>5} {'95% CI':>11} {'pairs':>9} {'verb':>5} {'hall':>4}  pass")
    results = {}
    for name, preds in systems.items():
        s = results[name] = score(preds, gold, pages, unflagged)
        print(f"{name:7} {s['precision']:5.2f} {s['precision_ci'][0]:5.2f}-{s['precision_ci'][1]:<5.2f} "
              f"{s['recall']:5.2f} {s['recall_ci'][0]:5.2f}-{s['recall_ci'][1]:<5.2f} "
              f"{s['exact_pairs']:5.2f}/{s['pairs_n']:<3} {s['verbatim']:5.2f} {s['hallucinated_unflagged']:>4}  "
              f"{'PASS' if s['passes'] else 'fail'}")
    ship = next((t for t in TIER_ORDER if results.get(t, {}).get("passes")), None)
    print(f"\nShip: {ship} (smallest passing tier)" if ship else "\nNo LLM tier passes: keep the regex flag and "
          "a person reading the flagged pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
