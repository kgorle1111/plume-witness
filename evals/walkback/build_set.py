"""Build the optional labeled eval set: every regex-flagged page plus a seeded random sample of unflagged pages.

Writes, next to this file:
  eval_set.json   page ids and stratum (flagged / unflagged). Used by the scorer; do not read it while labeling.
  label_sheet.md  each page's TCEQ link and raw free-text fields only, in a seeded shuffled order, with no
                  machine answers and no stratum, so the labeler reads blind.
  labels.csv      one empty row per page for the labeler's kind / compound / old / new / unit / date.

Usage: uv run python -m evals.walkback.build_set   (refuses to overwrite a labels.csv that has any label in it)
"""

import csv
import json
import random
import sys
from pathlib import Path

from pipeline import walkback as wb

HERE = Path(__file__).resolve().parent
SEED = 20261115
N_UNFLAGGED = 30
LABEL_COLS = ("page_id", "kind", "compound", "old_value", "new_value", "unit", "date_of_change", "notes")


def select(pages: list[dict]) -> dict:
    flagged = sorted(p["page_id"] for p in pages if wb.regex_flagged(p))
    unflagged = sorted(p["page_id"] for p in pages if not wb.regex_flagged(p))
    picked = wb.sample(unflagged, N_UNFLAGGED, SEED)
    return {"seed": SEED, "flagged": flagged, "unflagged_sample": picked,
            "unflagged_population": len(unflagged), "page_ids": sorted(flagged + picked)}


def _quote_block(text: str) -> str:
    esc = "".join("\\" + ch if ch in "\\`*_[]<>#|~" else ch for ch in text)
    return "> " + (esc or "(empty)")


def sheet(pages: list[dict], ids: list[str], urls: dict[str, str]) -> str:
    by_id = {p["page_id"]: p for p in pages}
    order = list(ids)
    random.Random(SEED + 1).shuffle(order)
    L = ["# Walk-back label sheet (blind)", "",
         ("Read each page's free text and fill its row in `labels.csv`. Kinds: none, revised_down, revised_up, "
          "declared_not_reportable_or_retracted, replaced_by_other_report, calculation_corrected, "
          "affirmative_defense_claimed. See README.md for the rules. Open the TCEQ link for the contaminant "
          "table."), ""]
    for n, pid in enumerate(order, 1):
        p = by_id[pid]
        L += ["---", "", f"## {n}. {pid}", "", f"TCEQ: {urls.get(pid, '(no url)')}  ",
              f"Local copy: `data/raw/backtest/{pid}.html`", ""]
        for key in ("cause", "actions", "basis"):
            L += [f"**{key}**", "", _quote_block(p["fields"][key]), ""]
    return "\n".join(L)


def main() -> int:
    labels = HERE / "labels.csv"
    if labels.exists():
        with labels.open() as fh:
            if any(any(row.get(c) for c in LABEL_COLS[1:]) for row in csv.DictReader(fh)):
                print(f"refusing: {labels} already has labels in it; move it aside first", file=sys.stderr)
                return 2
    pages = [wb.load_page(p) for p in wb.page_paths()]
    sel = select(pages)
    (HERE / "eval_set.json").write_text(json.dumps(sel, indent=1) + "\n")
    (HERE / "label_sheet.md").write_text(sheet(pages, sel["page_ids"], wb.page_urls()))
    with labels.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(LABEL_COLS)
        w.writerows([pid] + [""] * (len(LABEL_COLS) - 1) for pid in sel["page_ids"])
    print(f"eval set: {len(sel['flagged'])} flagged + {len(sel['unflagged_sample'])} of "
          f"{sel['unflagged_population']} unflagged = {len(sel['page_ids'])} pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
