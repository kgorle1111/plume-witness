"""Backtest tests: the real 425347 night as a golden row, the parsing and locating rules the denominators rest on,
and the rule that the published table never names a facility the pipeline did not match."""

from datetime import date
from pathlib import Path

import pytest

from pipeline import backtest, build

ROOT = Path(__file__).resolve().parent.parent
INEOS_REGISTRY_ID = "110000462623"


@pytest.fixture(scope="module")
def result() -> dict:
    return backtest.run()


def _row(result: dict, incident: str) -> dict:
    return next(r for r in result["events"] if r["incident"] == incident)


def test_golden_row_425347(result):
    r = _row(result, "425347")
    assert r["fac_registry_id"] == INEOS_REGISTRY_ID and r["param"] == "45201"
    assert r["benzene_lbs"] == 7634.0
    assert r["detected"] and (r["detection"]["site_id"], r["detection"]["hour_cst"]) == ("48_201_0069", 9)
    assert r["detection"]["value"] == 51.75
    assert r["facility_in_corridor"] is True
    assert r["matched"] is True and r["record_status"] == "reported"


def test_summary_counts_are_nested_and_consistent(result):
    s, ev = result["summary"], result["events"]
    assert s["candidates"] == len(ev) == result["funnel"]["candidates"]
    assert s["detected_and_matched"] <= s["detected_and_in_corridor"] <= s["detected"] <= s["candidates"]
    assert all(r["detected"] and r["facility_in_corridor"] is True for r in ev if r["matched"])
    assert sum(s["not_matched_reasons"].values()) == s["candidates"] - s["detected_and_matched"]


def test_every_candidate_is_a_benzene_or_butadiene_emissions_event_near_a_site(result):
    for r in result["events"]:
        assert r["benzene_lbs"] > 0 or r["butadiene_lbs"] > 0
        assert r["nearest_site_km"] <= backtest.CANDIDATE_RADIUS_KM
        assert r["day"][-4:] in backtest.YEARS


def test_compound_pounds_ignores_lookalikes(tmp_path):
    p = tmp_path / "steers_1.html"
    p.write_text("<p>Benzene 12.5 POUNDS</p><p>Ethylbenzene 3 POUNDS</p><p>C5+ (not including benzene) 77.86 POUNDS"
                 "</p><p>BENZENE 1,000 POUNDS</p><p>1,3-BUTADIENE 2 POUNDS</p><p>Butadiene, 1-3 0.5 POUNDS</p>")
    assert backtest.compound_pounds(p) == {"45201": 1012.5, "43218": 2.5}


def test_ambiguous_names_are_never_guessed():
    rows = [{"AIRName": "HOUSTON PLANT", "RegistryID": "A", "FacLat": "29.7", "FacLong": "-95.2", "AIRStreet": "1 A ST"},
            {"AIRName": "HOUSTON PLANT", "RegistryID": "B", "FacLat": "29.8", "FacLong": "-95.0", "AIRStreet": "9 B ST"}]
    assert backtest.locate("Houston Plant", "5 C ST; HOUSTON", rows)[0] is None
    assert backtest.locate("Houston Plant", "9 B ST; HOUSTON", rows)[0]["RegistryID"] == "B"


def _two_sites_one_name() -> list[dict]:
    return [{"AIRName": "HOUSTON PLANT", "RegistryID": "A", "FacLat": "29.70", "FacLong": "-95.20", "AIRStreet": "1 A ST"},
            {"AIRName": "HOUSTON PLANT", "RegistryID": "B", "FacLat": "29.90", "FacLong": "-95.00", "AIRStreet": "9 B ST"}]


def _inc(address: str) -> dict:
    return {"incident": "1", "entity": "HOUSTON PLANT", "rn": "RN1", "start_local": "2024-06-21T09:00",
            "compound": "Benzene", "pounds": 5.0, "address": address}


def test_duplicate_name_is_placed_by_the_reports_own_street_number():
    rows, origin = _two_sites_one_name(), (29.70, -95.30)
    # Site B is the one in the corridor list; the report's address says it is site A, which is not.
    corridor_b = [{"id": "B", "name": "Houston Plant", "distance_km": 30.0, "bearing_deg": 40.0}]
    for addr, rid, in_corr in (("1 A ST; HOUSTON", "A", False), ("9 B ST; HOUSTON", "B", True)):
        (p,) = build.place_incidents([_inc(addr)], corridor_b, rows, origin, [90.0])
        assert (p["facility_id"], p["in_corridor"]) == (rid, in_corr)


def test_duplicate_name_the_address_cannot_settle_is_unresolved_not_guessed():
    for addr in ("5 C ST; HOUSTON", ""):
        (p,) = build.place_incidents([_inc(addr)], [], _two_sites_one_name(), (29.70, -95.30), [90.0])
        assert p["in_corridor"] is None and p["facility_id"] is None and p["resolution"].startswith("unresolved")
    rc = build.record_check([p], {}, date(2024, 6, 21), 9, search_complete=True, param="45201", earlier_complete=True)
    assert rc["status"] == "search_incomplete"


def test_real_duplicate_name_report_is_placed_at_its_street_address_site():
    """Audit finding B: incident 438290 shares its name with two ECHO sites. The old last-row lookup put it at
    110070190741 (9.5 km); its own street number is the site at 110000504892 (5.9 km)."""
    sites = {s: backtest.site_coords(s) for s in backtest.SITE_NAMES}
    _, echo_rows = backtest.load_echo()
    inc = backtest.steers_incident(backtest.BT / "steers_438290.html")
    (p,) = build.place_incidents([inc], [], echo_rows, sites["48_201_0069"], [200.0])
    assert (p["facility_id"], p["distance_km"], p["bearing_deg"]) == ("110000504892", 5.9, 71.7)


def test_demo_night_still_matches_the_ineos_report():
    ev = build.build()
    assert ev["record_check"]["status"] == "reported" and ev["record_check"]["incident"] == "425347"
    assert ev["record_check"]["matched_facility_id"] == INEOS_REGISTRY_ID
    assert ev == __import__("json").loads((ROOT / "web" / "public" / "event.json").read_text())


def test_steers_offset_follows_daylight_saving():
    assert build.steers_tz_offset_h(date(2024, 6, 21)) == 1
    assert build.steers_tz_offset_h(date(2024, 1, 15)) == 0


def test_docs_never_name_an_unmatched_facility(result):
    doc = (ROOT / "docs" / "backtest.md").read_text().lower()
    for r in result["events"]:
        if not r["matched"]:
            assert r["entity"].lower() not in doc, r["incident"]


def test_golden_spike_row_matches_the_ineos_report(result):
    rows = [r for r in result["spikes"] if r["day"] == "06/21/2024" and r["param"] == "45201"]
    assert len(rows) == 1
    r = rows[0]
    assert (r["site_id"], r["hour_cst"], r["value"]) == ("48_201_0069", 9, 51.75)
    assert r["status"] == "reported" and r["matched_incident"] == "425347"


def test_spike_counts_partition(result):
    sp, spikes = result["spike_summary"], result["spikes"]
    assert sp["spikes"] == len(spikes) == sum(sp["by_status"].values())
    said_none = sp["by_status"].get("no_report_after_deadline", 0)
    assert sp["false_no_report"] + sp["no_report_found_after_complete_search"] == said_none
    assert all(r["search_complete"] for r in spikes if r["status"] == "no_report_after_deadline")


def test_spike_rows_carry_no_facility_names(result):
    names = {r["entity"].lower() for r in result["events"]}
    for r in result["spikes"]:
        assert not any(isinstance(v, str) and v.lower() in names for v in r.values())


def test_unsearched_day_is_never_complete(tmp_path):
    details, complete, _ = backtest.day_reports("06/21/2024", {}, [], tmp_path)
    assert details == {} and complete is False


def test_start_hour_is_cst():
    assert backtest.start_hour_cst("06/21/2024 09:38 AM") == 8
    assert backtest.start_hour_cst("01/12/2025 05:36 PM") == 17


def test_trigger_hours_uses_the_unchanged_rule():
    flat = [{"value": 0.2} for _ in range(24)]
    spike = [dict(v) for v in flat]
    spike[9] = {"value": 51.75}
    assert backtest.trigger_hours([{"baseline": 0.21, "hourly": spike}, {"baseline": 0.21, "hourly": flat}]) == [9]


def test_near_start_is_a_subset_of_detected_and_holds_the_golden_row(result):
    s, ev = result["summary"], result["events"]
    assert all(r["detected"] for r in ev if r["spike_near_start"])
    assert s["spike_near_start_and_matched"] <= s["spike_near_start"] <= s["detected"]
    assert _row(result, "425347")["spike_near_start"] is True


def test_butadiene_spelled_with_a_space_counts_but_lookalikes_do_not(tmp_path):
    p = tmp_path / "steers_2.html"
    p.write_text("<p>1,3 Butadiene 5 POUNDS</p><p>2-Methyl-1,3 butadiene 4 POUNDS</p>")
    assert backtest.compound_pounds(p) == {"45201": 0.0, "43218": 5.0}


def _week(raw: Path, beg: str, end: str) -> None:
    (raw / f"steers_search_harris_{beg}_{end}.html").write_text("<p>No records</p>")


def test_earlier_days_unsearched_means_incomplete(tmp_path):
    part, full = tmp_path / "part", tmp_path / "full"  # separate dirs: week listings are cached per directory
    for raw in (part, full):
        raw.mkdir()
        _week(raw, "20240617", "20240623")
    _week(full, "20240520", "20240616")
    _, complete, note = backtest.earlier_reports("06/21/2024", {}, [], part)
    assert complete is False and "incomplete" in note
    _, complete, _ = backtest.earlier_reports("06/21/2024", {}, [], full)
    assert complete is True
    _, complete, _ = backtest.earlier_reports("06/21/2024", {}, ["steers_search_harris_20240520_20240616.html"], full)
    assert complete is False


def test_spike_matched_by_a_report_started_the_day_before(result):
    r = next(r for r in result["spikes"] if r["day"] == "06/13/2024" and r["param"] == "45201")
    assert r["status"] != "no_report_after_deadline" and r["matched_incident"] == "424533"
    assert r["matched_ongoing"] is True
