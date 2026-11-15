"""Triangulation: synthetic geometry for the rules, and proof that it changes no existing number."""

import copy
import hashlib
import json
import math
from pathlib import Path

import pytest

from pipeline import backtest, build, nights, triangulate
from pipeline.contract import validate

ROOT = Path(__file__).resolve().parent.parent
H = 10
O = (29.70, -95.30)


def at(origin: tuple[float, float], east_km: float, north_km: float) -> tuple[float, float]:
    return (origin[0] + north_km / 111.2, origin[1] + east_km / (111.2 * math.cos(math.radians(origin[0]))))


def monitor(site: str, p: tuple[float, float], fires: bool = True) -> dict:
    hourly = [{"hour_cst": h, "value": 50.0 if (fires and h == H) else 0.1} for h in range(24)]
    return {"site_id": site, "name": site, "lat": p[0], "lon": p[1], "baseline": 0.1, "hourly": hourly}


def wind(site: str, from_deg: float, mph: float = 8.0) -> dict:
    return {"site_id": site, "hourly": [{"hour_cst": h, "from_deg": from_deg, "speed_mph": mph} for h in range(24)]}


def echo(points: list[tuple[float, float]]) -> dict:
    return {"Results": {"Facilities": [{"AIRUniverse": "Major Emissions", "FacLat": str(p[0]), "FacLong": str(p[1]),
                                        "RegistryID": f"F{i}", "AIRName": f"FACILITY {i}"} for i, p in enumerate(points)]}}


def trace_like(mons: list[dict], winds: dict, points: list[tuple[float, float]]) -> dict:
    """What build.trace hands assemble_event, with the flagged monitor (mons[0])'s own wind."""
    a, w = mons[0], winds[mons[0]["site_id"]]
    window = [w["hourly"][H - 1]["from_deg"], w["hourly"][H]["from_deg"]]
    return {"detection": {"site_id": a["site_id"], "hour_cst": H}, "trig": a, "wind": w, "winds": winds,
            "window": window, "calm_mph": None, "facilities": build.corridor(echo(points), (a["lat"], a["lon"]), window)}


def test_perpendicular_wedges_narrow_to_their_crossing():
    # A sits 5 km west of S with wind from the east; B sits 5 km south of S with wind from the north.
    s = at(O, 5, 0)
    a, b = monitor("A", O), monitor("B", at(s, 0, -5))
    p_east, p_far = at(O, 10, 0), at(O, 13, 1)  # in A's wedge only (seen from B they are 45 deg or more off north)
    t = trace_like([a, b], {"A": wind("A", 90), "B": wind("B", 0)}, [s, p_east, p_far])
    tr = triangulate.triangulate(t, [a, b])
    assert tr["single_wedge_count"] == 3
    assert tr["intersection_ids"] == ["F0"] and tr["intersection_count"] == 1
    assert tr["separation_deg"] == pytest.approx(90, abs=1)
    assert tr["verdict"] == "narrows" and tr["caveat"] is None


def test_a_facility_must_sit_in_every_wedge_not_just_one():
    # A third monitor north of S with wind from the west looks away from S: nothing is in all three wedges.
    s = at(O, 5, 0)
    a, b, c = monitor("A", O), monitor("B", at(s, 0, -5)), monitor("C", at(s, 0, 5))
    t = trace_like([a, b, c], {"A": wind("A", 90), "B": wind("B", 0), "C": wind("C", 270)}, [s, at(O, 10, 0)])
    tr = triangulate.triangulate(t, [a, b, c])
    assert len(tr["monitors"]) == 3
    assert tr["intersection_ids"] == [] and tr["verdict"] == "no_overlap"


def test_parallel_wedges_along_the_wind_do_not_narrow():
    # B is 2 km upwind of A on the same line; every facility further upwind is in both wedges.
    a, b = monitor("A", O), monitor("B", at(O, 2, 0))
    pts = [at(O, 5, 0), at(O, 8, 0.5), at(O, 11, -0.5)]
    t = trace_like([a, b], {"A": wind("A", 90), "B": wind("B", 90)}, pts)
    tr = triangulate.triangulate(t, [a, b])
    assert tr["intersection_count"] == tr["single_wedge_count"] == 3
    assert tr["separation_deg"] < triangulate.ALIGNED_DEG
    assert tr["verdict"] == "aligned"


def test_one_trigger_or_a_borrowed_wind_is_not_triangulation():
    a, b = monitor("A", O), monitor("B", at(O, 0, -5), fires=False)
    t = trace_like([a, b], {"A": wind("A", 90), "B": wind("B", 0)}, [at(O, 5, 0)])
    assert triangulate.triangulate(t, [a, b])["verdict"] == "single"
    b = monitor("B", at(O, 0, -5))
    t = trace_like([a, b], {"A": wind("A", 90), "B": wind("A", 90)}, [at(O, 5, 0)])  # B borrows A's wind
    tr = triangulate.triangulate(t, [a, b])
    assert tr["verdict"] == "single_wind" and tr["intersection_count"] is None and tr["intersection_ids"] == []
    assert tr["excluded"][0]["site_id"] == "B"


def test_a_monitor_one_hour_late_still_counts_but_two_hours_does_not():
    a, b = monitor("A", O), monitor("B", at(at(O, 5, 0), 0, -5), fires=False)
    w = {"A": wind("A", 90), "B": wind("B", 0)}
    pts = [at(O, 5, 0), at(O, 10, 0)]
    b["hourly"][H + 1]["value"] = 50.0
    assert triangulate.triangulate(trace_like([a, b], w, pts), [a, b])["monitors_triggered"] == 2
    b["hourly"][H + 1]["value"], b["hourly"][H + 2]["value"] = 0.1, 50.0
    assert triangulate.triangulate(trace_like([a, b], w, pts), [a, b])["monitors_triggered"] == 1


def test_triangulation_reads_the_trace_and_writes_nothing_back():
    a, b = monitor("A", O), monitor("B", at(O, 0, -5))
    t = trace_like([a, b], {"A": wind("A", 90), "B": wind("B", 0)}, [at(O, 5, 0)])
    before = copy.deepcopy((t, [a, b]))
    triangulate.triangulate(t, [a, b])
    assert (t, [a, b]) == before


def test_demo_night_is_two_aligned_monitors_and_keeps_the_matched_facility():
    ev = json.loads((ROOT / "web" / "public" / "event.json").read_text())
    tr = ev["triangulation"]
    assert [m["site_id"] for m in tr["monitors"]] == ["48_201_0069", "48_201_0307"]
    assert (tr["single_wedge_count"], tr["intersection_count"], tr["verdict"]) == (47, 37, "aligned")
    assert ev["record_check"]["matched_facility_id"] in tr["intersection_ids"]
    assert validate(ev) == []


def test_contract_rejects_an_intersection_facility_the_event_does_not_list():
    ev = json.loads((ROOT / "web" / "public" / "event.json").read_text())
    ev["triangulation"]["intersection_ids"][0] = "not-a-facility"
    assert any("intersection_ids" in e for e in validate(ev))


# SHA-256 of the backtest summary, spike summary and funnel (json.dumps(..., indent=1, sort_keys=True)). Triangulation
# is informational: these must not move. Re-pinned 2026-11-15 for 12 monitors and the own-met -> own-AutoGC -> borrowed
# wind order (was a5e5f90a... on origin/main 860c42b with 8 monitors and met-or-borrowed wind).
BACKTEST_SUMMARY_SHA = "f8333ada60d37e2f17a75ab6b67d3f77b41ce46b919536dde586a29553eb64fd"


def test_existing_backtest_numbers_are_byte_identical():
    res = backtest.run()
    blob = json.dumps({k: res[k] for k in ("summary", "spike_summary", "funnel")}, indent=1, sort_keys=True)
    assert hashlib.sha256(blob.encode()).hexdigest() == BACKTEST_SUMMARY_SHA
    assert backtest.render_md(res) == (ROOT / "docs" / "backtest.md").read_text()


@pytest.fixture(scope="module")
def generated():
    return nights.generate()


def test_every_night_carries_a_valid_block_and_the_statuses_did_not_move(generated):
    evs, _ = generated
    statuses: dict[str, int] = {}
    for ev, row in evs:
        assert "triangulation" in ev and validate(ev) == [], row["id"]
        statuses[row["status"]] = statuses.get(row["status"], 0) + 1
    # 12 monitors, own AutoGC wind before borrowing (2026-11-15); 8 monitors on origin/main 860c42b gave
    # 227 / 11 / 170 / 6
    assert statuses == {"search_incomplete": 281, "reported_mismatch": 13, "no_report_after_deadline": 168,
                        "reported": 4}


def test_triangulation_doc_is_current(generated):
    evs, skipped = generated
    s = triangulate.stats([ev for ev, _ in evs], len(skipped))
    assert triangulate.render_md(s) == (ROOT / "docs" / "triangulation.md").read_text()
