"""Past-spikes export: one row per backtest spike, no facility names, contract statuses only, under budget."""

import json
import re
from pathlib import Path

import pytest

from pipeline import backtest, spikes
from pipeline.contract import STATUSES

ROOT = Path(__file__).resolve().parent.parent
BT = ROOT / "data" / "build" / "backtest.json"


@pytest.fixture(scope="module")
def bt() -> dict:
    return json.loads(BT.read_text())


@pytest.fixture(scope="module")
def out(bt) -> dict:
    return spikes.export(bt, {s: backtest.site_coords(s) for s in backtest.SITE_NAMES})


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def facility_names(bt: dict) -> set[str]:
    """Every facility name the backtest saw: reporting entities plus every ECHO facility near a monitor."""
    names = {e["entity"] for e in bt["events"] if e.get("entity")}
    for p in (ROOT / "data" / "raw" / "backtest").glob("echo_*_10mi.json"):
        names |= {f["AIRName"] for f in json.loads(p.read_text())["Results"]["Facilities"] if f.get("AIRName")}
    return {_norm(n) for n in names} - {_norm(n) for n in backtest.SITE_NAMES.values()}


def test_one_row_per_backtest_spike(bt, out):
    assert len(out["rows"]) == len(bt["spikes"]) == out["summary"]["spikes"]
    assert out["summary"]["spike_days"] == len({s["day"] for s in bt["spikes"]})


def test_rows_carry_only_whitelisted_fields(out):
    allowed = set(spikes.ROW_KEYS) | set(spikes.OPTIONAL_KEYS)
    for r in out["rows"]:
        assert set(spikes.ROW_KEYS) <= set(r) <= allowed


def test_no_row_names_a_facility(bt, out):
    names = facility_names(bt)
    assert len(names) > 50, "ECHO facility list did not load; the name check would be vacuous"
    for r in out["rows"]:
        text = " " + _norm(" ".join(str(v) for v in r.values())) + " "
        hits = [n for n in names if f" {n} " in text]
        assert not hits, f"{r['date']} {r['site_id']} names a facility: {hits}"


def test_statuses_are_contract_statuses(out):
    assert {r["status"] for r in out["rows"]} <= set(STATUSES)
    assert sum(out["summary"]["by_status"].values()) == len(out["rows"])


def test_incident_only_on_reported_rows(out):
    for r in out["rows"]:
        assert ("matched_incident" in r) == (r["status"] == "reported")
        assert ("report_url" in r) == (r["status"] == "reported")


def test_no_wind_spike_abstains_with_a_reason(bt, out):
    n = sum(1 for s in bt["spikes"] if s["status"] == "no_wind")
    assert sum(1 for r in out["rows"] if r.get("reason") == spikes.ABSTAIN["no_wind"][1]) == n


def test_unknown_status_fails_loud(bt):
    bad = dict(bt, spikes=[dict(bt["spikes"][0], status="light_wind")])
    with pytest.raises(spikes.SpikeExportError, match="ABSTAIN"):
        spikes.export(bad, {s: (0.0, 0.0) for s in backtest.SITE_NAMES})


def test_bad_value_fails_loud(bt):
    bad = dict(bt, spikes=[dict(bt["spikes"][0], value=float("nan"))])
    with pytest.raises(spikes.SpikeExportError, match="value"):
        spikes.export(bad, {s: (0.0, 0.0) for s in backtest.SITE_NAMES})


def test_published_file_is_current_and_under_budget(out):
    published = (ROOT / "web" / "public" / "spikes.json").read_bytes()
    assert len(published) < spikes.MAX_BYTES
    assert json.loads(published) == json.loads(json.dumps(out)), "re-run `uv run python -m pipeline.spikes`"


def test_night_id_matches_the_replay_file_format(out):
    ids = [r["night_id"] for r in out["rows"]]
    assert len(set(ids)) == len(ids)
    assert "2024-06-21_45201_48_201_0069" in ids
    for r in out["rows"]:
        assert r["night_id"] == f"{r['date']}_{r['param']}_{r['site_id']}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}_(45201|43218)_48_201_\d{4}", r["night_id"])


def test_every_incomplete_check_says_why(out):
    assert all(r.get("reason") for r in out["rows"] if r["status"] == "search_incomplete")
    assert not any(r.get("reason") for r in out["rows"] if r["status"] != "search_incomplete")
