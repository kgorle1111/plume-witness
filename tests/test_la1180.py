"""pipeline.la1180: the South Coast AQMD Rule 1180 hourly files, read and counted by the unchanged Texas rule.

The excerpt (data/fixtures/r1180_1hr_excerpt.csv) is real rows cut from data/raw/region_los_angeles/1hr_q1_2022.zip
(Hudson, 2022-01-21, the hour of a spike and the hour after) and 1hr_q3_2021.zip (Manhattan Beach, a check-gas hour).
"""

import hashlib
import io
import json
from datetime import datetime

import pytest

from pipeline import backtest, build, la1180

EXCERPT = la1180.ROOT / "data" / "fixtures" / "r1180_1hr_excerpt.csv"


def excerpt() -> dict:
    return la1180.hourly(la1180.read_rows(io.StringIO(EXCERPT.read_text(encoding="utf-8-sig"))))


def test_parser_files_each_value_under_the_hour_it_started():
    data = excerpt()
    hdsn = data[("HDSN", "Benzene_gc")]
    # stamped 13:00 = the average of 12:00-13:00, the hour TCEQ would label 12
    assert hdsn == {datetime(2022, 1, 21, 12): 22.91, datetime(2022, 1, 21, 13): 0.81}
    assert data[("HDSN", "13-Butadiene_gc")][datetime(2022, 1, 21, 12)] == 28.61
    assert ("HDSN", "Acrolein_gc") not in data  # only the compounds the check-gas screen and the counts read


def test_parser_refuses_another_unit_or_header():
    rows = EXCERPT.read_text(encoding="utf-8-sig").replace(",ppb,", ",ug/m3,", 1)
    with pytest.raises(ValueError, match="unit"):
        la1180.hourly(la1180.read_rows(io.StringIO(rows)))
    with pytest.raises(ValueError, match="header"):
        la1180.read_rows(io.StringIO("Site,Param,Time,Value\n"))


def test_check_gas_hour_is_dropped_and_a_real_plume_hour_is_kept():
    data = excerpt()
    assert la1180.is_check_gas(data, "MHAN", datetime(2021, 9, 18, 12))
    assert not la1180.is_check_gas(data, "HDSN", datetime(2022, 1, 21, 12))  # styrene 1.08: not every compound
    assert la1180.day_tables(data, "MHAN", "45201") == {}
    assert la1180.day_tables(data, "HDSN", "45201")["01/21/2022"][12] == 22.91


def test_station_list_is_the_portal_record():
    st = la1180.stations()
    assert len(st) == 10
    assert st["HDSN"] == ("Hudson Air Monitoring Station", 33.802417, -118.219933)
    assert all(33.7 < lat < 34.0 and -118.45 < lon < -118.2 for _, lat, lon in st.values())


def test_rule_is_the_texas_rule_unchanged():
    """Los Angeles counts with build.detect itself; this fails if the trigger or the wind cap is changed."""
    assert (build.TRIGGER_RATIO, build.TRIGGER_FLOOR_PPB, build.BASELINE_DAYS) == (10.0, 10.0, 7)
    assert backtest.BORROW_MAX_KM == 10.0
    assert la1180.spikes.__code__.co_names.count("detect") == 1


def test_real_files_give_the_published_six_spikes():
    rows = la1180.spikes()
    got = [(r["day"], r["param"], r["site_id"], r["hour"], r["value"]) for r in rows]
    assert got == [
        ("10/12/2021", "45201", "GUEN", 8, 13.88),
        ("01/13/2022", "45201", "UMCW", 4, 10.26),
        ("01/21/2022", "45201", "HDSN", 12, 22.91),
        ("01/21/2022", "43218", "HDSN", 12, 28.61),
        ("03/29/2022", "45201", "SLKE", 5, 18.55),
        ("11/22/2022", "43218", "IPRT", 22, 16.23),
    ]
    for r in rows:
        assert r["value"] >= max(10 * r["baseline"], 10)


def test_raw_files_match_their_provenance():
    ledger = json.loads((la1180.RAW / "provenance.json").read_text())
    assert {e["file"].split("/")[-1] for e in ledger} == {p.name for p in la1180.RAW.iterdir()} - {"provenance.json"}
    for e in ledger:
        b = (la1180.RAW.parent / e["file"]).read_bytes()
        assert (len(b), hashlib.sha256(b).hexdigest()) == (e["bytes"], e["sha256"]), e["file"]
        assert e["url"].startswith(("https://www.aqmd.gov/", "https://xappprod.aqmd.gov/"))
