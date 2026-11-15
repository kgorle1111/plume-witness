"""web/public/coverage.json: every Texas AutoGC monitor, checked against the regions and their published spike logs,
then the Los Angeles Rule 1180 stations, checked against pipeline.la1180."""

import json

import pytest

from pipeline import coverage, la1180, regions

KEYS = ["site_id", "name", "county", "region_key", "lat", "lon", "has_data", "wind_source", "years",
        "max_benzene_ppb", "max_butadiene_ppb", "spikes", "by_status", "area"]


@pytest.fixture(scope="module")
def full() -> dict:
    return json.loads(coverage.OUT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cov(full) -> dict:
    """The Texas rows: the checks below are about the TCEQ form and the Texas regions."""
    return full | {"sites": [s for s in full["sites"] if s["area"] == "texas"]}


def test_committed_file_is_current(full):
    fresh = coverage.build_coverage(today=full["generated"])
    assert coverage.dumps(fresh) == coverage.OUT.read_text(encoding="utf-8"), (
        "web/public/coverage.json is stale: run `uv run python -m pipeline.coverage`")


def test_schema(full):
    assert list(full) == ["generated", "trigger", "sites"]
    assert full["trigger"] == "value >= max(10 x 7-day median, 10 ppb)"
    assert {s["area"] for s in full["sites"]} == {"texas", "los_angeles"}
    for s in full["sites"]:
        assert list(s) == KEYS, s["site_id"]
        assert s["wind_source"] in ("met", "autogc", "borrowed", None)
        if s["area"] == "texas":
            assert set(s["years"]) <= {2024, 2025}
            assert sum(s["by_status"].values()) == s["spikes"]


def test_los_angeles_rows_are_the_rule_1180_stations_counted_not_checked(full):
    la = [s for s in full["sites"] if s["area"] == "los_angeles"]
    assert [s["site_id"] for s in la] == [f"r1180_{c}" for c in la1180.STATIONS]
    summary = la1180.summary()
    for s in la:
        code = s["site_id"].removeprefix("r1180_")
        assert s["county"] == "Los Angeles" and s["region_key"] is None and s["wind_source"] is None
        assert s["by_status"] == {}, "Los Angeles spikes are not checked against reports"
        assert set(s["years"]) <= set(la1180.YEARS) and s["has_data"]
        assert s["spikes"] == len(summary[code]["spikes"])
        assert 33.7 < s["lat"] < 34.0 and -118.45 < s["lon"] < -118.2
    assert sum(s["spikes"] for s in la) == 6


def test_lists_all_45_texas_autogc_sites_once(cov):
    ids = [s["site_id"] for s in cov["sites"]]
    assert len(ids) == len(set(ids)) == 45
    assert set(ids) == set(coverage.form_sites())
    assert set(ids) == set(regions.ALL_SITE_NAMES) | set(regions.NO_DATA_SITES)


def test_sites_match_their_regions(cov):
    for s in cov["sites"]:
        r = regions.REGIONS.get(s["region_key"]) if s["region_key"] else None
        assert s["county"] == regions.site_county(s["site_id"]).title()
        if r is None:
            assert s["site_id"] in regions.NO_DATA_SITES
            assert (s["has_data"], s["years"], s["spikes"], s["wind_source"]) == (False, [], 0, None)
            assert s["max_benzene_ppb"] is None and s["max_butadiene_ppb"] is None
        else:
            assert s["site_id"] in r.sites and s["name"] == r.sites[s["site_id"]]
            assert s["has_data"] and s["years"] and s["wind_source"] is not None
            assert s["max_benzene_ppb"] is not None


def test_spike_counts_match_each_region_spike_log(cov):
    for key, r in regions.REGIONS.items():
        log = json.loads(r.spikes_out.read_text())
        mine = [s for s in cov["sites"] if s["region_key"] == key]
        assert {s["site_id"] for s in mine} == set(r.sites), key
        assert sum(s["spikes"] for s in mine) == len(log["rows"]) == log["summary"]["spikes"], key
        by_status: dict[str, int] = {}
        for s in mine:
            for k, n in s["by_status"].items():
                by_status[k] = by_status.get(k, 0) + n
        assert by_status == log["summary"]["by_status"], key
        for s in mine:
            assert s["spikes"] == sum(1 for row in log["rows"] if row["site_id"] == s["site_id"])


def test_a_spike_means_a_reading_at_or_over_the_floor(cov):
    for s in cov["sites"]:
        if s["spikes"]:
            assert max(s["max_benzene_ppb"] or 0, s["max_butadiene_ppb"] or 0) >= 10, s["site_id"]
