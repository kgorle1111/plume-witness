"""pipeline.la_replay: Los Angeles spikes through the unchanged build.trace, with airport wind and Cal OES / NRC."""

import json
from datetime import date, datetime

from pipeline import backtest, build, la1180, la_replay, nrc, regions

LA = regions.LOS_ANGELES


def test_caloes_row_parses_from_its_real_cells():
    # Cal OES 2022 file, control 22-0... style row: Ultramar refinery, 2022-01-21 (Excel day 44582), as published.
    row = {"Control#": "'22-0539", "Notified Date": "44582.525694444441", "Agency": "Ultramar Refinery",
           "1. Substance": "SO2", "1. Quantity": "500", "1. Measure": "Lbs.", "Location": "2402 E Anaheim st",
           "City": "Wilmington", "County": "Los Angeles County", "Incident Date": "44582", "Time": "1130"}
    r = la_replay.caloes_record(row, "2022-Spill-Reports.xls.xlsx")
    assert r["report"] == "22-0539" and r["incident_local"] == "2022-01-21T11:30"
    assert r["materials"] == [{"name": "SO2", "cas": None, "amount": 500.0, "unit": "Lbs."}]
    assert not nrc.names_compound(r["materials"][0], "45201")
    assert la_replay.caloes_time("44582", "2460") is None  # a time that is not a clock time is not guessed at


def test_no_2021_2022_los_angeles_report_names_either_compound():
    """Why every Los Angeles check is "Can't say": neither source has a compound-matching report to find."""
    for path in (la_replay.NRC_EXTRACT, la_replay.CALOES_EXTRACT):
        reps = la_replay.load_reports(path)
        assert reps, path.name
        assert not [r for r in reps for m in r["materials"] if nrc.names_compound(m, "45201")
                    or nrc.names_compound(m, "43218")], path.name


def test_asos_rows_become_hourly_wind_in_mph(tmp_path):
    (tmp_path / "asos_LGB_x.csv").write_text(
        "station,valid,lon,lat,drct,sknt\n"
        "LGB,2022-01-21 11:53,-118.1472,33.8118,190.00,6.00\n"
        "LGB,2022-01-21 12:53,-118.1472,33.8118,M,5.00\n")
    a = la_replay.read_asos(tmp_path)["LGB"]
    assert a["hours"][datetime(2022, 1, 21, 11)] == (190.0, 6.9)
    assert a["hours"][datetime(2022, 1, 21, 12)] == (None, 5.8)  # 'M' (variable) is no direction, not a guess


def test_borrowed_wind_obeys_the_texas_cap():
    airports = la_replay.read_asos()
    w = la_replay.station_wind("HDSN", date(2022, 1, 21), airports)
    assert w["site_id"] == "asos_LGB" and w["source"] == "asos"
    _, lat, lon = la1180.stations()["HDSN"]
    assert build.haversine_km((lat, lon), (w["lat"], w["lon"])) <= backtest.BORROW_MAX_KM == 10.0
    far = {"LGB": airports["LGB"] | {"lat": 34.2}}  # the same airport moved ~44 km north
    assert la_replay.station_wind("HDSN", date(2022, 1, 21), far) is None


def test_match_window_is_in_the_regions_own_local_time():
    # 2021-10-12 is PDT: 08:00 PST is 09:00 local. Texas keeps its CST/CDT rule.
    assert build._local(date(2021, 10, 12), 8, la_replay.TZ) == datetime(2021, 10, 12, 9)
    assert build._local(date(2022, 1, 21), 12, la_replay.TZ) == datetime(2022, 1, 21, 12)
    assert build._local(date(2024, 6, 21), 8) == datetime(2024, 6, 21, 9)
    assert build.tz_name(date(2021, 10, 12), la_replay.TZ) == "PDT"


def test_published_los_angeles_spike_log():
    log = json.loads(LA.spikes_out.read_text())
    got = [(r["date"], r["site_id"], r["param"], r["status"], r.get("reason_code"), r["night_id"] is not None)
           for r in log["rows"]]
    assert got == [
        ("2021-10-12", "GUEN", "45201", "search_incomplete", "no_register", True),
        ("2022-01-13", "UMCW", "45201", "search_incomplete", "no_wind", False),
        ("2022-01-21", "HDSN", "43218", "search_incomplete", "no_register", True),
        ("2022-01-21", "HDSN", "45201", "search_incomplete", "no_register", True),
        ("2022-03-29", "SLKE", "45201", "search_incomplete", "calm_wind", True),
        ("2022-11-22", "IPRT", "43218", "search_incomplete", "calm_wind", True),
    ]
    assert log["region"]["key"] == "los_angeles"


def test_night_files_are_current_and_say_pst():
    nights, _ = la_replay.generate(LA)
    for ev, row in nights:
        on_disk = json.loads((LA.nights_out / f"{row['id']}.json").read_text())
        assert on_disk == json.loads(json.dumps(ev)), f"{row['id']} is stale: run `uv run python -m pipeline.la_replay`"
        assert ev["time_note"].startswith("Monitor hours are PST as South Coast AQMD publishes them")
        assert "CST" not in ev["packet"]["draft_en"] and "Texas" not in ev["packet"]["draft_en"]
        assert ev["record_check"]["status"] == "search_incomplete"
        assert ev["record_check"]["source_url"] == la_replay.CALOES_HOME
        assert ev["wind"]["source"] == "borrowed_asos"


def test_station_names_match_the_portal():
    assert {c: n for c, (n, _, _) in la1180.stations().items()} == LA.sites

