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


def _outside(incident: str) -> dict:
    return {"incident": incident, "entity": "Elsewhere Plant", "rn": "RN0", "start_local": "2024-06-21T09:00",
            "compound": "Benzene", "pounds": 1.0, "facility_id": "X", "distance_km": 30.0, "bearing_deg": 200.0,
            "in_corridor": False, "resolution": "outside the corridor"}


def test_absence_is_never_claimed_from_incomplete_search():
    rc = build.record_check([], {}, date(2024, 6, 21), 9, search_complete=False, param="45201")
    assert rc["status"] == "search_incomplete"
    assert rc["matched_facility_id"] is None
    assert all(c["status"] == "search_incomplete" for c in rc["checks"])


def test_absence_needs_every_incident_located():
    unresolved = _outside("1") | {"in_corridor": None, "resolution": "unresolved: facility not located"}
    rc = build.record_check([unresolved], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "search_incomplete"


def test_absence_only_with_complete_search_and_all_located():
    rc = build.record_check([_outside("1")], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "no_report_after_deadline"


def test_day_search_places_other_report_outside_corridor(real_event):
    day = {d["incident"]: d for d in real_event["record_check"]["day_incidents"]}
    assert set(day) == {"425347", "425367"}
    assert day["425367"]["in_corridor"] is False and day["425347"]["in_corridor"] is True
    assert "complete" in real_event["record_check"]["search_scope"]


def test_corridor_lists_by_distance_not_by_blame(real_event):
    dists = [f["distance_km"] for f in real_event["facilities"]]
    assert dists == sorted(dists)
    assert all(f["in_corridor"] for f in real_event["facilities"])


def test_banned_words_rejected():
    ev = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    ev["packet"]["draft_en"] = "This facility made an illegal release."
    assert any("illegal" in e for e in validate(ev))


def test_real_event_without_corridor_fails_contract(real_event):
    broken = {k: v for k, v in real_event.items() if k != "corridor"}
    assert any("corridor" in e for e in validate(broken))


def test_corridor_lists_each_facility_once(real_event):
    ids = [f["id"] for f in real_event["facilities"]]
    assert len(ids) == len(set(ids))


def _inside(incident: str, lbs: dict, report_type: str = "FINAL", report_date: str = "2024-07-03") -> tuple[dict, dict]:
    placed = {"incident": incident, "entity": "Upwind Plant", "rn": "RN1", "start_local": "2024-06-21T09:38",
              "compound": "X", "pounds": 1.0, "facility_id": "F", "distance_km": 3.0, "bearing_deg": 77.0,
              "in_corridor": True, "resolution": "in the corridor"}
    detail = {"incident": incident, "entity": "Upwind Plant", "start_local": "2024-06-21T09:38",
              "end_local": "2024-06-21T10:42", "notified_local": "2024-06-21T14:38", "compound": "X", "pounds": 1.0,
              "cause": None, "lbs_by_param": lbs, "report_type": report_type, "report_date": report_date}
    return placed, {incident: detail}


def test_report_must_list_the_monitored_compound():
    placed, details = _inside("9", {"45201": 0.0, "43218": 0.0})
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "reported_mismatch" and rc["compound_match"] is False
    placed, details = _inside("9", {"45201": 7634.0, "43218": 0.0})
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "reported" and rc["compound_match"] is True


def test_final_check_compares_the_report_date():
    for rtype, rdate, want in (("FINAL", "2024-07-03", "reported"), ("FINAL", "2024-07-20", "not_yet_reported"),
                               ("INITIAL", "2024-06-22", "not_yet_reported")):
        placed, details = _inside("9", {"45201": 5.0}, rtype, rdate)
        rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
        assert rc["checks"][1]["status"] == want, (rtype, rdate)


def test_ineos_page_parses_report_fields():
    from pipeline.parse import steers_incident
    inc = steers_incident(ROOT / "data" / "raw" / "steers_425347.html")
    assert inc["report_type"] == "FINAL" and inc["report_date"] == "2024-07-03"
    assert inc["lbs_by_param"]["45201"] == 7634.0


def test_report_started_the_day_before_and_still_running_matches():
    placed, details = _inside("7", {"45201": 40.0})
    details["7"] |= {"start_local": "2024-06-20T20:00", "end_local": "2024-06-21T11:00",
                     "notified_local": "2024-06-20T21:00"}
    placed["start_local"] = "2024-06-20T20:00"
    rc = build.record_check([], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            ongoing=[placed], earlier_complete=True)
    assert rc["status"] == "reported" and rc["incident"] == "7"
    assert rc["reported"]["match_basis"] == "ongoing (started 2024-06-20)"
    assert [p["incident"] for p in rc["ongoing_incidents"]] == ["7"]


def test_same_day_report_running_through_the_window_matches():
    placed, details = _inside("8", {"45201": 3.0})
    details["8"] |= {"start_local": "2024-06-21T00:30", "end_local": "2024-06-21T12:00"}
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "reported" and rc["incident"] == "8"


def test_earlier_report_that_ended_before_the_window_does_not_match():
    placed, details = _inside("6", {"45201": 40.0})
    details["6"] |= {"start_local": "2024-06-20T01:00", "end_local": "2024-06-21T03:00"}
    rc = build.record_check([], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            ongoing=[placed], earlier_complete=True)
    assert rc["status"] == "no_report_after_deadline" and rc["ongoing_incidents"] == []


def test_absence_needs_the_earlier_days_searched():
    rc = build.record_check([_outside("1")], {}, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "search_incomplete"
    assert "earlier days were not searched" in rc["search_scope"]


def test_t24_counts_from_discovery_not_from_the_spike():
    placed, details = _inside("5", {"45201": 5.0})
    details["5"] |= {"start_local": "2024-06-21T00:00", "end_local": "2024-06-21T13:00",
                     "notified_local": "2024-06-22T06:00"}
    rc = build.record_check([placed], details, date(2024, 6, 21), 11, search_complete=True, param="45201")
    assert rc["checks"][0]["status"] == "not_yet_reported"
    assert "30.0 h after the reported discovery" in rc["checks"][0]["note"]


def _demo_inputs(speed_mph: float | None = None) -> tuple:
    cfg, raw = build.EVENT, build.RAW
    monitors = build.load_monitors(cfg)
    wind = build.load_wind(cfg["wind_site"], cfg["year"], cfg["day"])
    if speed_mph is not None:
        for h in (8, 9):
            wind["hourly"][h]["speed_mph"] = speed_mph
    echo = json.loads((raw / cfg["echo"]).read_text())
    search = build.steers_search(raw / "steers_search_harris_06212024.html")
    details = {r["incident"]: build.steers_incident(raw / f"steers_{r['incident']}.html") for r in search["rows"]}
    rows = echo["Results"]["Facilities"] + json.loads((raw / "echo_name_425367.json").read_text())["Results"]["Facilities"]
    return monitors, {cfg["wind_site"]: wind}, echo, rows, details


def test_calm_wind_draws_no_corridor_and_claims_nothing():
    monitors, winds, echo, rows, details = _demo_inputs(speed_mph=2.0)
    t = build.trace(monitors, winds, "48_201_0069", echo, rows, details, True, date(2024, 6, 21), "45201",
                    earlier={}, earlier_complete=True, earlier_note="Earlier days searched.")
    rc = t["record_check"]
    assert t["facilities"] == [] and t["calm_mph"] == 2.0
    assert rc["status"] == "search_incomplete" and rc["matched_facility_id"] is None
    assert "wind too light to trace (2 mph)" in rc["search_scope"]
    assert all(d["in_corridor"] is None for d in rc["day_incidents"])


def test_travel_time_on_the_golden_night(real_event):
    r = real_event["record_check"]["reported"]
    assert (r["travel_distance_km"], r["travel_speed_mph"]) == (10.6, 6.8)
    assert r["travel_h"] == pytest.approx(0.97, abs=0.01)
    assert r["start_to_spike_h"] == pytest.approx(0.37, abs=0.01)
    assert r["spike_hour_local"][0] <= r["arrival_local"] <= r["spike_hour_local"][1]


def test_banned_words_rejected_in_cannot_say():
    ev = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    ev["cannot_say"] = ["A missing report would not mean illegal."]
    assert any("illegal" in e for e in validate(ev))
    ev["cannot_say"] = ["This reading proves nothing about the plant."]
    assert any("proves" in e for e in validate(ev))
