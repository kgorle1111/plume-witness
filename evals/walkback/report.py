"""Unlabeled validation report for a walk-back run. NOT an accuracy measurement.

Without gold labels nothing here says whether a reading is right. It reports what can be checked without a
person: how often the guard passed, what kinds came back, where the LLM disagrees with the two deterministic
baselines (listed so a person can spot-check them), and a seeded sample of pages to skim against TCEQ.

Usage: uv run python -m evals.walkback.report data/build/walkback/run-sonnet-<stamp>.jsonl
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from pipeline.walkback import is_material, sample

SAMPLE_SEED = 20261115
SAMPLE_N = 20
TITLE = "Walk-back reader validation report: not an accuracy measurement"


def load_run(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _md(text: str | None) -> str:
    """One table-safe line of page text."""
    return (text or "").replace("|", "\\|").replace("\n", " ").replace("*", "\\*").replace("_", "\\_")


def _link(r: dict[str, Any]) -> str:
    return f"[{r['page_id']}]({r['url']})" if r.get("url") else r["page_id"]


def _reason_kind(reason: str) -> str:
    """Group rejection reasons by type: drop the quoted values and numbers that vary per page."""
    return re.sub(r"(?<![\d])(?<!status )\d+", "N", re.sub(r"'[^']*'|\"[^\"]*\"", "<v>", reason))


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    llm = [r["llm"] for r in rows]
    read = [x for x in llm if x["status"] == "read"]
    usage = Counter()
    for x in llm:
        usage.update(x.get("usage") or {})
    agree = {}
    for base in ("regex", "parser"):
        cells = Counter((is_material(r["llm"]), is_material(r[base])) for r in rows)
        agree[base] = {"both_change": cells[(True, True)], "llm_only": cells[(True, False)],
                       "baseline_only": cells[(False, True)], "neither": cells[(False, False)]}
    return {
        "pages": len(rows), "read": len(read), "not_read": len(llm) - len(read),
        "guard_pass_rate": len(read) / len(llm) if llm else 0.0,
        "rejections": Counter(_reason_kind(reason) for x in llm for reason in x.get("rejected", [])),
        "kinds": Counter(x["kind"] for x in read),
        "material": sum(is_material(x) for x in llm),
        "table_check": Counter(x.get("table_check", {}).get("status") for x in read if x["kind"] != "none"),
        "usage": dict(usage), "cost_usd": round(sum(x.get("cost_usd") or 0 for x in llm), 4),
        "served_models": Counter(x.get("served_model") for x in llm), "agreement": agree,
    }


def render(rows: list[dict[str, Any]], run_name: str) -> str:
    s = summarize(rows)
    L = [f"# {TITLE}", "",
         (f"Run: `{run_name}`. Pages: {s['pages']}. No gold labels were used: agreement with a baseline is not "
          "correctness, and a guard pass means only that every quote, number, name and date is on the page."), "",
         "## Guard", "",
         f"- Read (guard passed): **{s['read']} / {s['pages']}** ({s['guard_pass_rate']:.1%})",
         (f"- Not read (guard failed, refusal, cut off, or call failed; shown as \"flagged by rule, not read\"): "
          f"{s['not_read']}")]
    L += [f"  - {n} x {reason}" for reason, n in s["rejections"].most_common()]
    L += ["", "## Kinds returned (guard-passed pages only)", ""]
    L += [f"- {k}: {n}" for k, n in s["kinds"].most_common()]
    L += [f"- Material changes read (any kind but none / affirmative_defense_claimed): {s['material']}", "",
          "Contaminant-table cross-check of new_value (surfaced, never resolved): "
          + (", ".join(f"{k} {n}" for k, n in s["table_check"].most_common()) or "none"), ""]
    L += ["## Agreement with the deterministic baselines", "",
          "| Baseline | both say change | LLM only | baseline only | neither |", "|---|---|---|---|---|"]
    for base, a in s["agreement"].items():
        L.append(f"| {base} | {a['both_change']} | {a['llm_only']} | {a['baseline_only']} | {a['neither']} |")
    for base in ("regex", "parser"):
        dis = [r for r in rows if is_material(r["llm"]) != is_material(r[base])]
        L += ["", f"### Pages where the LLM and the {base} baseline disagree ({len(dis)}), for spot-checking", ""]
        if dis:
            L += ["| Page | LLM | LLM quote | " + base + " quote |", "|---|---|---|---|"]
            for r in dis:
                x = r["llm"]
                llm_kind = x["kind"] if x["status"] == "read" else "not read"
                L.append(f"| {_link(r)} | {llm_kind} | {_md(x.get('quote'))} | {_md(r[base].get('quote'))} |")
    mism = [r for r in rows if r["llm"].get("table_check", {}).get("status") == "mismatch_with_table"]
    if mism:
        L += ["", f"### new_value differs from the contaminant table ({len(mism)})", "",
              "| Page | compound | old | new | table | quote |", "|---|---|---|---|---|---|"]
        for r in mism:
            x = r["llm"]
            L.append(f"| {_link(r)} | {_md(x['compound'])} | {x['old_value']} | {x['new_value']} | "
                     f"{', '.join(x['table_check']['table_quantities'])} | {_md(x['quote'])} |")
    by_id = {r["page_id"]: r for r in rows}
    pos = [r["page_id"] for r in rows if is_material(r["llm"])]
    rest = [r["page_id"] for r in rows if not is_material(r["llm"])]
    half = SAMPLE_N // 2
    picked = sample(pos, half, SAMPLE_SEED)
    picked += sample(rest, SAMPLE_N - len(picked), SAMPLE_SEED)
    L += ["", f"## Seeded sample to skim ({len(picked)} pages, seed {SAMPLE_SEED})", "",
          (f"Up to {half} pages drawn from the LLM's material changes and the rest from all other pages, so "
           "both directions get a look. Open each link and check the quote and kind against the page."), "",
          "| Page | status | kind | old -> new | date | quote |", "|---|---|---|---|---|---|"]
    for pid in sorted(picked):
        x = by_id[pid]["llm"]
        L.append(f"| {_link(by_id[pid])} | {x['status']} | {x['kind'] or '-'} | {x['old_value'] or '-'} -> {x['new_value'] or '-'} | "
                 f"{x['date_of_change'] or '-'} | {_md(x.get('quote')) or '(no change read)'} |")
    u = s["usage"]
    L += ["", "## Cost (measured usage x list price)", "",
          (f"- ${s['cost_usd']:.4f} total; input {u.get('input_tokens', 0):,} tokens, output "
           f"{u.get('output_tokens', 0):,} tokens (thinking included)"),
          "- Served by: " + ", ".join(f"{m} x{n}" for m, n in s["served_models"].most_common()), ""]
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("run", type=Path)
    ap.add_argument("--out", type=Path, help="default: <run>.report.md")
    args = ap.parse_args(argv)
    rows = load_run(args.run)
    if not rows:
        print(f"{args.run} has no rows", file=sys.stderr)
        return 2
    out = args.out or args.run.with_suffix(".report.md")
    out.write_text(render(rows, args.run.name))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
