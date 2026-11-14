"""Pipeline tests: contract gate, the real-night golden case, and the safety rules that protect named facilities."""

import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import build
from pipeline.contract import validate

ROOT = Path(__file__).resolve().parent.parent
INEOS_REGISTRY_ID = "110000462623"  # EPA ECHO registry id for INEOS Americas Pasadena Site


@pytest.fixture(scope="module")
def real_event() -> dict:
    return build.build()


def test_fixture_passes_contract():
    fx = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    fx_errors = [e for e in validate(fx) if "in_corridor" not in e and "matched_facility_id" not in e
                 and "search_scope" not in e]
    assert fx_errors == []


def test_real_event_passes_contract(real_event):
    assert validate(real_event) == []
    assert real_event["label"] == "real" and real_event["provenance"]


def test_golden_detection_on_real_night(real_event):
    d = real_event["detection"]
    assert (d["site_id"], d["hour_cst"], d["value"]) == ("48_201_0069", 9, 51.75)


def test_triggered_monitors_are_downwind_pair_not_nearest(real_event):
    trig = {m["name"] for m in real_event["monitors"] if m["triggered"]}
    assert trig == {"Houston Milby Park", "Manchester East Ave N"}


def test_reporting_facility_is_in_corridor_and_matched(real_event):
    ids = [f["id"] for f in real_event["facilities"]]
    assert INEOS_REGISTRY_ID in ids
    rc = real_event["record_check"]
    assert rc["matched_facility_id"] == INEOS_REGISTRY_ID
    assert [c["status"] for c in rc["checks"]] == ["reported", "reported"]
    assert rc["reported"]["pounds"] == 7634.0


def test_absence_is_never_claimed_from_incomplete_search(real_event):
    rc = build.record_check([], date(2024, 6, 21), 9, real_event["facilities"], search_complete=False)
    assert rc["status"] == "search_incomplete"
    assert rc["matched_facility_id"] is None
    assert all(c["status"] == "search_incomplete" for c in rc["checks"])


def test_corridor_lists_by_distance_not_by_blame(real_event):
    dists = [f["distance_km"] for f in real_event["facilities"]]
    assert dists == sorted(dists)
    assert all(f["in_corridor"] for f in real_event["facilities"])


def test_banned_words_rejected():
    ev = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    ev["packet"]["draft_en"] = "This facility made an illegal release."
    assert any("illegal" in e for e in validate(ev))
