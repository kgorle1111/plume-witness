"""People-near-monitors tests: the radius rule at its edges, the weighting on a tiny hand-checkable input, and the
published people.json / docs/people.md against the cached Census files (re-derived by a separate, naive path)."""

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from pipeline import people
from pipeline.backtest import SITE_NAMES, site_coords
from pipeline.build import haversine_km

ROOT = Path(__file__).resolve().parent.parent
CENTER = (29.7, -95.2)


def _tract(geoid: str, lat: float, lon: float, **v: float | None) -> dict:
    return {"geoid": geoid, "lat": lat, "lon": lon, "v": v}


def test_radius_edges_are_inclusive_and_exact():
    pt = (29.7, -95.2 + 0.03)
    d = haversine_km(CENTER, pt)
    t = [_tract("a", *pt)]
    assert people.tracts_within(t, CENTER, d) == t  # exactly on the circle counts
    assert people.tracts_within(t, CENTER, d - 1e-6) == []  # a hair outside does not


def test_radius_3km_is_subset_of_5km_and_splits_by_distance():
    near = _tract("near", 29.7 + 0.02, -95.2)  # ~2.2 km
    mid = _tract("mid", 29.7 + 0.04, -95.2)  # ~4.4 km
    far = _tract("far", 29.7 + 0.06, -95.2)  # ~6.7 km
    ts = [near, mid, far]
    assert [t["geoid"] for t in people.tracts_within(ts, CENTER, 3)] == ["near"]
    assert [t["geoid"] for t in people.tracts_within(ts, CENTER, 5)] == ["near", "mid"]


def test_weighting_ratio_of_sums_not_mean_of_percentages():
    big = _tract("big", 0, 0, B01003_E001=900, B03003_E001=900, B03003_E003=90, C16002_E001=300,
                 C16002_E004=30, B19013_E001=40000)
    small = _tract("small", 0, 0, B01003_E001=100, B03003_E001=100, B03003_E003=100, C16002_E001=100,
                   C16002_E004=100, B19013_E001=100000)
    s = people.summarize([big, small])
    assert s["population"] == 1000 and s["tracts"] == 2
    assert s["pct_hispanic"] == 19.0  # 190/1000; the mean of 10% and 100% would be 55%
    assert s["pct_limited_english_households"] == 32.5  # 130/400
    assert s["median_hh_income_usd"] == 55000  # (40000*300 + 100000*100) / 400


def test_missing_income_is_excluded_and_zero_denominator_is_none():
    a = _tract("a", 0, 0, B01003_E001=50, C16002_E001=20, B19013_E001=None)
    b = _tract("b", 0, 0, B01003_E001=0, C16002_E001=0, B19013_E001=60000)
    s = people.summarize([a])
    assert s["median_hh_income_usd"] is None and s["tracts_with_income"] == 0
    assert s["pct_hispanic"] is None  # no B03003 denominator: None, never 0% or a ZeroDivisionError
    assert people.summarize([b])["median_hh_income_usd"] is None  # zero-household weight cannot weight an income
    assert people.summarize([])["population"] == 0


def test_age_buckets_use_the_right_lines():
    v = {f"B01001_E{n:03d}": 0 for n in range(1, 50)}
    v.update(B01001_E001=100, B01001_E003=1, B01001_E006=2, B01001_E027=4, B01001_E030=8,  # under 18: 15
             B01001_E007=500, B01001_E031=500,  # 18-19 must not count
             B01001_E020=3, B01001_E025=5, B01001_E044=7, B01001_E049=9)  # 65+: 24
    s = people.summarize([_tract("x", 0, 0, **v)])
    assert (s["under_18"], s["age_65_plus"]) == (15, 24)


def test_acs_sentinels_become_none():
    assert people._num("-666666666") is None and people._num("-") is None and people._num("") is None
    assert people._num("1234") == 1234.0 and people._num("0") == 0.0


def test_published_json_matches_cached_raw():
    published = json.loads((ROOT / "web" / "public" / "people.json").read_text())
    assert published == people.build(), "web/public/people.json is stale; rerun: uv run python -m pipeline.people"
    assert (ROOT / "docs" / "people.md").read_text() == people.render_docs(published)


def _naive_population(site: str, radius: float) -> int:
    """Independent re-derivation: read the .dat and TIGERweb file directly, no pipeline.people helpers."""
    raw = ROOT / "data" / "raw" / "census"
    feats = json.loads((raw / "tigerweb_tracts_harris.json").read_text())["features"]
    pts = {f["attributes"]["GEOID"]: (float(f["attributes"]["INTPTLAT"]), float(f["attributes"]["INTPTLON"]))
           for f in feats}
    lines = (raw / "acs2024_5yr_b01003_harris_tracts.dat").read_text().splitlines()
    pop = {ln.split("|")[0][-11:]: int(ln.split("|")[1]) for ln in lines[1:]}
    c = site_coords(site)
    return sum(pop[g] for g, p in pts.items() if haversine_km(c, p) <= radius)


@pytest.mark.parametrize("site", list(SITE_NAMES))
@pytest.mark.parametrize("radius", people.RADII_KM)
def test_population_matches_naive_recount(site, radius):
    published = json.loads((ROOT / "web" / "public" / "people.json").read_text())
    m = next(m for m in published["monitors"] if m["site_id"] == site)
    assert m["radii_km"][str(radius)]["population"] == _naive_population(site, radius)


def test_5km_contains_3km():
    for m in json.loads((ROOT / "web" / "public" / "people.json").read_text())["monitors"]:
        a, b = m["radii_km"]["3"], m["radii_km"]["5"]
        assert set(a["tract_geoids"]) <= set(b["tract_geoids"]) and a["population"] <= b["population"]


def test_tampered_raw_file_is_refused(tmp_path, monkeypatch):
    shutil.copytree(ROOT / "data" / "raw" / "census", tmp_path / "census")
    monkeypatch.setattr(people, "RAW", tmp_path / "census")
    monkeypatch.setattr(people, "LEDGER", tmp_path / "census" / "provenance.json")
    f = tmp_path / "census" / "acs2024_5yr_b01003_harris_tracts.dat"
    f.write_bytes(f.read_bytes().replace(b"|", b"|9", 1))
    with pytest.raises(ValueError, match="SHA-256"):
        people.load_tracts()


def test_non_harris_row_is_refused(tmp_path, monkeypatch):
    shutil.copytree(ROOT / "data" / "raw" / "census", tmp_path / "census")
    monkeypatch.setattr(people, "RAW", tmp_path / "census")
    monkeypatch.setattr(people, "LEDGER", tmp_path / "census" / "provenance.json")
    name = "acs2024_5yr_b01003_harris_tracts.dat"
    f = tmp_path / "census" / name
    f.write_bytes(f.read_bytes() + b"1400000US48339692400|1|1\n")
    ledger = json.loads(people.LEDGER.read_text())
    for e in ledger:
        if e["file"] == f"census/{name}":
            e["sha256"] = hashlib.sha256(f.read_bytes()).hexdigest()
    people.LEDGER.write_text(json.dumps(ledger))
    with pytest.raises(ValueError, match="not a Harris tract"):
        people.load_table("b01003")
