"""Replayable nights: every generated night is a contract-valid event from the shared pipeline path."""

import json
from pathlib import Path

import pytest

from pipeline import build, nights
from pipeline.contract import validate

ROOT = Path(__file__).resolve().parent.parent
BANNED = ("illegal", "violation", "unreported", "caught", "polluter", "proves")
DEMO_ID = "2024-06-21_45201_48_201_0069"


@pytest.fixture(scope="module")
def generated():
    return nights.generate()


def test_every_night_passes_contract_and_banned_words(generated):
    evs, _ = generated
    assert len(evs) > 400
    for ev, row in evs:
        assert validate(ev) == [], row["id"]
        text = " ".join((ev["packet"]["draft_en"], ev["packet"]["draft_es"], ev["title"], ev["record_check"]["search_scope"])).lower()
        assert not [w for w in BANNED if w in text], row["id"]
        assert ev["label"] == "real" and ev["cannot_say"] and ev["provenance"]
        assert len(ev["monitors"]) >= 1 and all(len(m["hourly"]) == 24 for m in ev["monitors"])


def test_demo_night_matches_the_hand_configured_build(generated):
    evs, _ = generated
    ev = next(e for e, r in evs if r["id"] == DEMO_ID)
    demo = build.build()
    assert ev["detection"] == demo["detection"]
    rc, drc = ev["record_check"], demo["record_check"]
    assert (rc["status"], rc["incident"], rc["matched_facility_id"]) == (drc["status"], drc["incident"], drc["matched_facility_id"])
    # The demo's ECHO file was fetched at 8 mi (12.9 km) but the corridor reaches 15 km; the nights use the 10 mi
    # file, so they add only facilities beyond 8 mi and drop none.
    ids = {f["id"] for f in demo["facilities"]}
    assert ids <= {f["id"] for f in ev["facilities"]}
    assert all(f["distance_km"] > 12.8 for f in ev["facilities"] if f["id"] not in ids)
    assert ev["corridor"] == demo["corridor"]


def test_demo_event_json_is_still_the_build_output():
    assert json.dumps(build.build(), indent=1) == (ROOT / "web" / "public" / "event.json").read_text()


def test_incomplete_search_never_claims_absence(generated):
    evs, _ = generated
    inc = [e for e, r in evs if r["status"] == "search_incomplete"]
    assert inc
    for ev in inc:
        rc = ev["record_check"]
        assert "complete search" not in ev["packet"]["draft_en"].replace("search is incomplete", "")
        assert "No matching report found in a complete search" not in rc["search_scope"]
        assert "incomplete" in rc["search_scope"] or any(d["in_corridor"] is None for d in rc["day_incidents"])
        assert all(c["status"] == "search_incomplete" for c in rc["checks"])


def test_no_report_night_says_so_and_keeps_cannot_say(generated):
    evs, _ = generated
    none = [e for e, r in evs if r["status"] == "no_report_after_deadline"]
    assert none
    for ev in none:
        assert "No matching report found in a complete search" in ev["record_check"]["search_scope"]
        assert "No matching report found in a complete search" in ev["packet"]["draft_en"]
        assert all(d["in_corridor"] is not None for d in ev["record_check"]["day_incidents"])
        assert len(ev["cannot_say"]) >= 5


def test_committed_files_are_current(generated):
    evs, _ = generated
    index = json.loads((nights.OUT / "index.json").read_text())
    assert [r["id"] for r in index] == [r["id"] for _, r in evs]
    for ev, row in evs:
        assert (nights.OUT / f"{row['id']}.json").read_text() == nights.dumps(ev), f"stale: {row['id']}; rerun pipeline.nights"


def test_cap_keeps_top_values_and_says_so(generated, tmp_path):
    evs, _ = generated
    stats = nights.write(evs[:20], out=tmp_path / "n", cap=60_000)
    assert 0 < stats["written"] < 20 and stats["dropped_over_cap"] == 20 - stats["written"]
    kept = {r["id"] for r in json.loads((tmp_path / "n" / "index.json").read_text())}
    top = sorted((r for _, r in evs[:20]), key=lambda r: -r["value"])[: stats["written"]]
    assert kept == {r["id"] for r in top}
