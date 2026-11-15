"""Print the guard-escape table; with --append LABEL also append it to RESULTS.md.

  uv run python -m evals.guard_escape                 # table + up to 3 escapes per class
  uv run python -m evals.guard_escape --escapes 0     # table only
  uv run python -m evals.guard_escape --append AFTER  # also append a dated, sha-stamped section
"""

import argparse
import datetime as dt
import subprocess

from evals.guard_escape.harness import HERE, ROOT, Row, run, stale_ai_packet


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True,
                              timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def stamp() -> str:
    sha = _git("rev-parse", "--short", "HEAD")
    dirty = _git("status", "--porcelain", "--", "pipeline", "evals")
    return f"{sha}{' + uncommitted changes' if dirty and dirty != 'unknown' else ''}"


def table(rows: dict[str, Row], real: Row, n_bases: int) -> str:
    out = ["| class | what is injected | cases | rejected | rate |", "|---|---|---:|---:|---:|"]
    for r in rows.values():
        out.append(f"| {r.key} | {r.label} | {r.total} | {r.rejected} | {r.rate:.0%} |")
    out.append(f"| real | {real.label} | {real.total} | {real.rejected} | {real.rate:.1%} |")
    out.append("")
    out.append(f"Mutants are built on {n_bases} real faithful bases x EN/ES. For a-i the rate is the catch "
               "rate (higher is better); for the benign and real rows it is the false-reject rate (lower is "
               "better).")
    return "\n".join(out)


def escapes(rows: dict[str, Row], real: Row, n: int) -> str:
    out = []
    for r in rows.values():
        if r.key.startswith("benign"):
            items = [f"{c.base}/{c.lang}: {c.note} -> {reasons[0]}" for c, reasons in r.rejects[:n]]
            head = f"false rejects in {r.key}"
        else:
            items = [f"{c.base}/{c.lang}: {c.note}" for c in r.escapes[:n]]
            head = f"escapes in ({r.key}) {r.label}"
        if items:
            out.append(f"- {head} ({len(r.rejects) if r.key.startswith('benign') else len(r.escapes)}):")
            out += [f"  - {i}" for i in items]
    if real.rejects:
        out.append(f"- real drafts rejected ({real.rejected}):")
        out += [f"  - {c.base}: {reasons[0]}" for c, reasons in real.rejects[:n]]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--escapes", type=int, default=3, help="examples to list per class (default 3)")
    ap.add_argument("--append", metavar="LABEL", help="append the table to RESULTS.md under this label")
    args = ap.parse_args(argv)
    bases, rows, real = run()
    body = table(rows, real, len(bases))
    if args.escapes:
        body += "\n\n" + escapes(rows, real, args.escapes)
    stale = stale_ai_packet()
    body += ("\n\npacket.ai.json vs the current event.json: "
             + ("passes" if not stale else f"REJECTED ({'; '.join(stale)})"))
    print(body)
    if args.append:
        section = f"\n## {args.append}: {dt.date.today().isoformat()}, guard at {stamp()}\n\n{body}\n"
        with (HERE / "RESULTS.md").open("a") as fh:
            fh.write(section)
        print(f"\nappended to {HERE / 'RESULTS.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
