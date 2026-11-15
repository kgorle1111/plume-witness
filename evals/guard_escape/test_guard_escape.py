"""The guard's measured catch rates are a floor: a guard change that lets more mutants through fails here.

Floors are the rates measured in RESULTS.md, written as counts so a single extra escape is a failure.
Raise them when the guard gets stricter; never lower one without a RESULTS.md entry saying why.
"""

import pytest

from evals.guard_escape.harness import CLASSES, all_cases, load_bases, score, score_real
from pipeline.gemini_draft import guard

# class -> (minimum mutants generated, maximum escapes allowed)
MAX_ESCAPES = {"a": (146, 0), "b": (196, 76), "c": (124, 0), "d": (149, 0), "e": (64, 7),
               "f": (170, 2), "g": (30, 0), "h": (53, 45), "i": (112, 1), "j": (264, 0)}
MAX_BENIGN_REJECTS = 0  # of 394 benign rewrites (304 before the 8 cause questions and limits per base, review M3)
# The template used to round reported pounds (8,470 for 8469.74 twice; 67 for 66.6; "0 pounds" for 0.07) and the guard
# rejected those drafts. It prints the reported figure since 2026-11-15, so no real draft may be rejected; see RESULTS.md.
MAX_REAL_REJECTS = 0


@pytest.fixture(scope="module")
def result():
    bases = load_bases()
    return bases, score(all_cases(bases), bases), score_real()


def test_every_class_has_enough_mutants(result):
    _, rows, _ = result
    for cls in CLASSES:
        assert rows[cls].total >= max(10, MAX_ESCAPES[cls][0]), f"class {cls} produced {rows[cls].total} mutants"
    assert rows["benign"].total >= 20


@pytest.mark.parametrize("cls", sorted(CLASSES))
def test_catch_rate_floor(result, cls):
    _, rows, _ = result
    r = rows[cls]
    allowed = MAX_ESCAPES[cls][1]
    shown = "\n".join(f"  {c.base}/{c.lang}: {c.note}" for c in r.escapes[:10])
    assert len(r.escapes) <= allowed, f"({cls}) {CLASSES[cls]}: {len(r.escapes)} escapes > {allowed}\n{shown}"


def test_benign_false_rejects_ceiling(result):
    _, rows, real = result
    benign = rows["benign"]
    shown = "\n".join(f"  {c.base}/{c.lang}: {c.note}: {why[0]}" for c, why in benign.rejects[:10])
    assert benign.rejected <= MAX_BENIGN_REJECTS, shown
    assert real.rejected <= MAX_REAL_REJECTS, [(c.base, why[0]) for c, why in real.rejects]


def test_bases_pass_and_run_is_deterministic(result):
    bases, rows, _ = result
    assert len(bases) >= 10 and {"claude-demo", "template-demo"} <= {b.id for b in bases}
    assert all(guard(b.drafts, b.facts) == [] for b in bases)
    again = score(all_cases(load_bases()), load_bases())
    assert {k: (r.total, r.rejected) for k, r in again.items()} == {k: (r.total, r.rejected) for k, r in rows.items()}
