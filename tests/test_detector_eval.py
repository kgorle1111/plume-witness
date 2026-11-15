"""Detector-eval tests: each metric on a tiny synthetic raw dir, plus pins to the backtest on the real data."""

from pathlib import Path

import pytest

from pipeline import backtest, build
from pipeline import detector_eval as de

SITE = (29.70, -95.26)
EAST_5KM = (29.70, -95.26 + 5 / 96.7)  # ~5 km due east at this latitude
DAY = "06/15/2024"
S1 = "48_201_0069"  # a real id only so backtest.SITE_NAMES resolves; every value below is synthetic


def _page(path: Path, rows: dict[str, list[float | str]]) -> None:
    path.write_text("<pre>\n" + "\n".join(f"{d}," + ",".join(str(v) for v in vals) for d, vals in rows.items())
                    + "\n</pre>")


def _raw(tmp_path: Path, spike_hour: int = 9, spike: float = 12.0, wind_from: float = 90.0, mph: float = 5.0,
         site: str = S1) -> Path:
    days = [f"06/{d:02d}/2024" for d in range(8, 16)]
    agc = {d: [0.5] * 24 for d in days}
    agc[DAY] = [0.5] * 24
    agc[DAY][spike_hour] = spike
    _page(tmp_path / f"agc_2024_{site}_45201.html", agc)
    _page(tmp_path / f"met_2024_{site}_61102.html", {d: [wind_from] * 24 for d in days})
    _page(tmp_path / f"met_2024_{site}_61101.html", {d: [mph] * 24 for d in days})
    return tmp_path


def test_downwind_uses_wind_from_direction():
    east = [{"from_deg": 90.0}] * 24
    west = [{"from_deg": 270.0}] * 24
    assert de.downwind_hours(EAST_5KM, SITE, east) == list(range(24))
    assert de.downwind_hours(EAST_5KM, SITE, west) == []
    edge = [{"from_deg": 90.0 + build.CORRIDOR_HALF_ANGLE + 1}] + [{"from_deg": None}] * 23
    assert de.downwind_hours(EAST_5KM, SITE, edge) == []


def test_downwind_respects_the_radius():
    far = (29.70, -95.26 + 20 / 96.7)
    assert de.downwind_hours(far, SITE, [{"from_deg": 90.0}] * 24) == []


def test_hit_hours_is_max_of_ratio_and_floor_inclusive():
    m = {"baseline": 0.5, "hourly": [{"value": v} for v in [0.5] * 20 + [1.5, 5.0, 10.0, None]]}
    assert de.hit_hours(m, 10, 10) == [22]          # 10.0 >= max(5, 10): inclusive
    assert de.hit_hours(m, 10, 1) == [21, 22]       # threshold max(5, 1) = 5
    assert de.hit_hours(m, 3, 1) == [20, 21, 22]    # threshold max(1.5, 1) = 1.5


def test_near_window_is_clipped_to_the_start_day():
    assert de.near_window(0) == list(range(7))
    assert de.near_window(20) == [19, 20, 21, 22, 23]


def test_control_days_skip_the_real_day_other_candidates_and_other_years():
    days = de.control_days("01/05/2024", exclude={"01/12/2024"})
    assert "01/05/2024" not in days and "01/12/2024" not in days
    assert days == ["01/19/2024", "01/26/2024"]     # the -7/-14/-21 days fall in 2023 and are dropped
    assert len(de.control_days("06/15/2024", exclude=set())) == len(de.CONTROL_OFFSETS_D)


def test_pound_bins_are_half_open():
    assert de.pound_bin(9.99) == "under 10 lb" and de.pound_bin(10.0) == "10-100 lb"
    assert de.pound_bin(1000.0) == "1,000 lb or more" and de.pound_bin(0.0) == "under 10 lb"


def test_unit_downwind_and_hits_on_synthetic_day(tmp_path):
    raw = _raw(tmp_path)
    u = de.evaluate_unit(EAST_5KM, DAY, "45201", start_hour_cst=8, sites={S1: SITE}, raw=raw)
    assert u["downwind"] and u["downwind_with_data"]
    assert u["near_hit"]["10x/10ppb"] and u["downwind_hit"]["10x/10ppb"]


def test_unit_upwind_monitor_is_not_downwind_but_still_near_hit(tmp_path):
    raw = _raw(tmp_path, wind_from=270.0)
    u = de.evaluate_unit(EAST_5KM, DAY, "45201", start_hour_cst=8, sites={S1: SITE}, raw=raw)
    assert not u["downwind"] and u["near_hit"]["10x/10ppb"] and not u["downwind_hit"]["10x/10ppb"]


def test_unit_spike_outside_window_is_not_near_start(tmp_path):
    raw = _raw(tmp_path, spike_hour=20)
    u = de.evaluate_unit(EAST_5KM, DAY, "45201", start_hour_cst=8, sites={S1: SITE}, raw=raw)
    assert not u["near_hit"]["10x/10ppb"] and not u["near_hit"]["3x/1ppb"]


def test_alert_scan_counts_day_compound_pairs(tmp_path):
    raw = _raw(tmp_path, spike=4.0)
    a = de.alert_scan({S1: SITE}, raw)
    assert a["alerts"]["10x/10ppb"] == 0 and a["alerts"]["3x/3ppb"] == 1
    assert a["days"] == 731 and a["days_with_data"] == 7  # 06/09..06/15: 06/08 has no baseline


def test_calm_share_uses_the_detecting_monitor_speed(tmp_path):
    raw = _raw(tmp_path, mph=2.0)
    dets = [{"day": DAY, "site_id": S1, "hour_cst": 9}, {"day": "01/01/2025", "site_id": S1, "hour_cst": 0}]
    c = de.calm_share(dets, {S1: SITE}, raw)
    assert (c["detections"], c["with_speed"], c["calm"]) == (2, 1, 1)
    (tmp_path / "at3").mkdir()
    assert de.calm_share(dets[:1], {S1: SITE}, _raw(tmp_path / "at3", mph=3.0))["calm"] == 0  # 3 mph is not calm


def test_separable_needs_non_overlapping_intervals():
    assert de.separable(30, 60, 5, 300)
    assert not de.separable(2, 66, 17, 356)
    assert not de.separable(3, 66, 10, 356)  # higher point rate (5% vs 3%), but the intervals overlap
    assert not de.separable(0, 0, 1, 10)


# --- real data: pin the eval to the backtest so the two can never silently disagree ---

@pytest.fixture(scope="module")
def real() -> dict:
    return de.run()


def test_current_setting_matches_the_backtest(real):
    bt = backtest.run()
    cur = next(s for s in real["sweep"] if s["current"])
    assert real["candidates"] == bt["summary"]["candidates"] == cur["release_n"]
    assert cur["release_hits"] == bt["summary"]["spike_near_start"]
    assert cur["alerts"] == bt["spike_summary"]["spikes"]


def test_cached_winds_match_backtest_load_winds():
    sites = {s: backtest.site_coords(s) for s in backtest.SITE_NAMES}
    for day in ("06/21/2024", "03/02/2025"):
        assert de.winds_for(day, sites) == backtest.load_winds(day[-4:], day, sites)


def test_real_counts_are_nested(real):
    n = real["candidates"]
    assert real["downwind"]["with_data"] <= real["downwind"]["geometry_any_monitor"] <= n
    assert sum(b["n"] for b in real["by_pounds"]) == n
    for s in real["sweep"]:
        assert s["release_downwind_hits"] <= s["release_hits"] <= n
        assert s["control_n"] == real["downwind"]["control_n"]
    lo = {s["setting"]: s for s in real["sweep"]}
    assert lo["3x/1ppb"]["alerts"] >= lo["10x/3ppb"]["alerts"] >= lo["10x/10ppb"]["alerts"]


def test_doc_names_no_facility(real):
    md = de.render_md(real)
    _, echo_rows = backtest.load_echo()
    names = {r["AIRName"].lower() for r in echo_rows if len(r.get("AIRName") or "") > 6}
    assert not [x for x in names if x in md.lower()]
