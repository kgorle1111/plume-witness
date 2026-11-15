"""The no-report audit: the sample is reproducible, and no row that keeps a 'no matching report' reading names
a facility, a company or an incident."""

import json
import re
from pathlib import Path

import pytest

from pipeline import audit_no_report as audit
from pipeline import backtest
from pipeline.parse import _text

ROOT = Path(__file__).resolve().parent.parent
PUBLISHED = ROOT / "docs" / "audit-no-report.json"
DOC = ROOT / "docs" / "audit-no-report.md"
SAMPLE_IDS = [
    "2024-03-29_45201_48_201_0057", "2025-10-17_43218_48_201_0069", "2024-09-25_45201_48_201_1015",
    "2025-11-18_43218_48_201_0307", "2025-03-25_43218_48_201_0069", "2025-09-11_45201_48_201_0057",
    "2025-06-12_43218_48_201_0026", "2024-04-15_43218_48_201_0069", "2025-09-19_45201_48_201_0057",
    "2025-10-31_45201_48_201_1614",
]


@pytest.fixture(scope="module")
def spikes() -> list[dict]:
    return json.loads(audit.SRC.read_text())["spikes"]


@pytest.fixture(scope="module")
def names() -> set[str]:
    """Every regulated-entity, owner and ECHO facility name the audit could have seen, lowercased."""
    out = set()
    universe, _ = backtest.load_universe()
    out |= {r["entity"].lower() for r in universe}
    for p in backtest.BT.glob("steers_[0-9]*.html"):
        t = re.sub(r"\s+", " ", _text(p))
        for label, until in (("Regulated Entity Name:", "RN:"), ("Name of Owner or Operator:", "CN:")):
            m = re.search(re.escape(label) + r" (.+?) " + until, t)
            if m:
                out.add(m.group(1).strip().lower())
    _, echo_rows = backtest.load_echo()
    out |= {r["AIRName"].lower() for r in echo_rows if r.get("AIRName")}
    return {n for n in out if len(n) >= 6}


def test_sample_is_deterministic_and_stratified(spikes):
    a, b = audit.sample(spikes), audit.sample(list(reversed(spikes)))
    assert [audit.spike_id(s) for s in a] == [audit.spike_id(s) for s in b] == SAMPLE_IDS
    assert all(s["status"] == "no_report_after_deadline" for s in a)
    per = {}
    for s in a:
        per[s["site_id"]] = per.get(s["site_id"], 0) + 1
    assert max(per.values()) <= audit.MAX_PER_MONITOR
    assert audit.sample(spikes, seed=audit.SEED + 1) != a


def test_every_sampled_spike_has_a_hand_verdict():
    assert set(audit.VERDICTS) == set(SAMPLE_IDS)
    valid = {audit.GAP, audit.MISSED, audit.DOUBTFUL, audit.CANT}
    assert all(v["verdict"] in valid and v["rule"] and v["evidence"] for v in audit.VERDICTS.values())


def test_published_json_matches_sample_and_verdicts():
    pub = json.loads(PUBLISHED.read_text())
    assert pub["seed"] == audit.SEED and [r["id"] for r in pub["rows"]] == SAMPLE_IDS
    assert all(r["reproduced"] for r in pub["rows"])
    for r in pub["rows"]:
        assert (r["verdict"], r["evidence"]) == (audit.VERDICTS[r["id"]]["verdict"], audit.VERDICTS[r["id"]]["evidence"])


def _kept_rows() -> list[str]:
    """Text of every published row that keeps the 'no matching report' reading or leaves it open."""
    pub = json.loads(PUBLISHED.read_text())
    rows = [json.dumps(r).lower() for r in pub["rows"] if r["verdict"] in (audit.GAP, audit.CANT)]
    rows += [json.dumps(v).lower() for v in audit.VERDICTS.values() if v["verdict"] in (audit.GAP, audit.CANT)]
    table = [ln.lower() for ln in DOC.read_text().splitlines()
             if ln.startswith("|") and ("gap stands" in ln.lower() or "can't tell" in ln.lower())]
    assert len(table) >= sum(1 for v in audit.VERDICTS.values() if v["verdict"] in (audit.GAP, audit.CANT))
    return rows + table


def test_no_gap_or_cant_tell_row_names_a_facility_or_company(names):
    hits = [(n, row[:60]) for row in _kept_rows() for n in names if n in row]
    assert not hits, hits


def test_no_gap_or_cant_tell_row_gives_an_incident_number():
    incidents = {p.stem.split("_")[-1] for p in backtest.BT.glob("steers_[0-9]*.html")}
    hits = [(i, row[:60]) for row in _kept_rows() for i in incidents if i in row]
    assert not hits, hits


def test_banned_words_absent():
    banned = re.compile(r"\b(illegal|violations?|unreported|caught|polluters?|proves?)\b", re.IGNORECASE)
    for p in (PUBLISHED, DOC, Path(audit.__file__)):
        assert not banned.search(p.read_text()), p.name


def test_beaumont_audit_names_no_facility_and_gives_no_incident_number():
    from pipeline import regions
    raw = regions.BEAUMONT.raw
    doc = (ROOT / "docs" / "audit-beaumont.md").read_text()
    text = doc.lower()
    assert "gap stands" in text
    names = {r["entity"].lower() for r in backtest.load_universe(raw)[0]}
    names |= {r["AIRName"].lower() for p in raw.glob("echo_*.json")
              for r in json.loads(p.read_text())["Results"]["Facilities"] if r.get("AIRName")}
    assert not [n for n in names if len(n) >= 6 and n in text]
    assert not [p.stem.split("_")[-1] for p in raw.glob("steers_[0-9]*.html") if p.stem.split("_")[-1] in text]
    assert not re.search(r"\b(illegal|violations?|unreported|caught|polluters?|proves?)\b", doc, re.IGNORECASE)
