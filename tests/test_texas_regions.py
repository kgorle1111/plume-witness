"""The other Texas AutoGC regions: same trigger, corridor and record check as Houston, separate files, no backtest."""

import hashlib
import json
import re
from datetime import date, datetime, timedelta

import pytest

from pipeline import backtest, build, fetch_backtest, nights, regions, spikes
from pipeline.contract import STATUSES, validate

NEW = [r for k, r in regions.REGIONS.items() if k not in ("houston", "beaumont")]
BANNED = ("illegal", "violation", "unreported", "caught", "polluter", "proves")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


@pytest.fixture(scope="module", params=NEW, ids=lambda r: r.key)
def region(request):
    return request.param


@pytest.fixture(scope="module")
def made(region):
    return spikes.export(*spikes.source(region), region), nights.generate(region=region)


def test_every_site_is_in_one_region_and_its_county():
    seen: dict[str, str] = {}
    for r in regions.REGIONS.values():
        for s in r.sites:
            assert s not in seen, f"{s} is in {seen[s]} and {r.key}"
            seen[s] = r.key
            assert regions.site_county(s) in r.counties, (r.key, s)
    assert not set(seen) & set(regions.NO_DATA_SITES)


def test_every_raw_file_has_provenance(region):
    ledger = {e["file"]: e for e in json.loads((region.raw / "provenance.json").read_text())}
    for p in region.raw.iterdir():
        if p.name == "provenance.json":
            continue
        e = ledger[f"{region.raw.name}/{p.name}"]
        assert e["sha256"] == hashlib.sha256(p.read_bytes()).hexdigest(), p.name
        assert e["url"].startswith("https://")


def test_published_spike_log_and_nights_are_current(region, made):
    out, (evs, _) = made
    assert spikes.dumps(out).encode() == region.spikes_out.read_bytes()
    index = json.loads((region.nights_out / "index.json").read_text())
    assert [r["id"] for r in index] == [r["id"] for _, r in evs]
    for ev, row in evs:
        assert (region.nights_out / f"{row['id']}.json").read_text() == nights.dumps(ev), f"stale: {row['id']}"
    assert {p.name for p in region.nights_out.iterdir()} == {"index.json"} | {f"{r['id']}.json" for _, r in evs}


def test_spike_log_is_labeled(region, made):
    out, _ = made
    assert out["region"] == {"key": region.key, "label": region.label, "county": region.county_title,
                             "backtested": region.backtested, "note": region.note}
    assert region.backtested is False and region.note is None
    assert out["summary"]["known_missed_reports"] is None
    assert "backtest" not in json.dumps(out).replace('"backtested"', ""), "no public text about backtests"
    assert {r["status"] for r in out["rows"]} <= set(STATUSES)
    assert sum(out["summary"]["by_status"].values()) == len(out["rows"]) == out["summary"]["spikes"]
    assert {r["site_id"] for r in out["rows"]} <= set(region.sites)


def test_nights_pass_the_contract_and_name_the_searched_counties(region, made):
    _, (evs, skipped) = made
    out, _ = made
    assert {r["night_id"] for r in out["rows"] if r["night_id"]} == {r["id"] for _, r in evs}
    assert {spikes.spike_id(r) for r in out["rows"] if r["night_id"] is None} <= {s["id"] for s in skipped}
    for ev, row in evs:
        assert validate(ev) == [], row["id"]
        assert ev["region"] == {"key": region.key, "label": region.label, "backtested": region.backtested,
                                "note": region.note}
        assert "backtest" not in json.dumps(ev).replace('"backtested"', ""), row["id"]
        assert region.place in ev["title"]
        assert f"in {build.county_en(region.search_county_title)} (" in ev["record_check"]["search_scope"]
        shown = " ".join((ev["title"], ev["packet"]["draft_en"], ev["packet"]["draft_es"],
                          ev["record_check"]["search_scope"], *ev["cannot_say"]))
        assert "Houston" not in shown, row["id"]
        assert "HARRIS" in region.counties or "Harris" not in shown, row["id"]
        assert not [w for w in BANNED if w in shown.lower()], row["id"]
        assert all(e["file"].startswith(f"{region.raw.name}/") for e in ev["provenance"])
        assert {m["site_id"] for m in ev["monitors"]} <= set(region.sites)


def test_no_report_rows_never_name_a_facility(region, made):
    out, _ = made
    names = set()
    for p in region.raw.glob("echo_*_10mi.json"):
        names |= {f["AIRName"] for f in json.loads(p.read_text())["Results"]["Facilities"] if f.get("AIRName")}
    universe, _ = backtest.load_universe(region.raw)
    names |= {r["entity"] for r in universe if r.get("entity")}
    names = {_norm(n) for n in names} - {_norm(n) for n in region.sites.values()} - {""}
    for r in out["rows"]:
        text = " " + _norm(" ".join(str(v) for v in r.values())) + " "
        assert not [n for n in names if f" {n} " in text], spikes.spike_id(r)
        assert ("matched_incident" in r) == (r["status"] == "reported")


def test_county_phrases():
    assert build.county_en("Harris") == "Harris County"
    assert build.county_es("Harris") == "el condado de Harris"
    assert build.county_en("Ector, Midland") == "Ector and Midland counties"
    assert build.county_es("Bexar, Comal, Wilson") == "los condados de Bexar, Comal y Wilson"


def test_steers_searched_every_day_in_every_county_with_a_spike(region, made):
    """backtest.searched() asks whether ANY saved week covers a day, so each searched county's weeks must cover all of
    2024-2025 with complete pages; and every county whose monitor had a spike must be searched. A region with no spike
    needs no record check, so it has no STEERS files at all."""
    out, _ = made
    spiked = {regions.site_county(r["site_id"]) for r in out["rows"]}
    assert spiked <= set(region.search_counties), (region.key, spiked)
    saved = list(region.raw.glob("steers_search_*.html"))
    if not out["rows"]:
        assert not saved and not list(region.raw.glob("steers_*.html"))
        return
    _, incomplete = backtest.load_universe(region.raw)
    assert not incomplete, incomplete[:3]
    days = {date(2024, 1, 1) + timedelta(days=k) for k in range(731)}
    for county in region.search_counties:
        covered = set()
        for p in region.raw.glob(f"steers_search_{fetch_backtest.county_slug(county)}_*.html"):
            b, e = (datetime.strptime(x, "%Y%m%d").date() for x in p.stem.split("_")[-2:])
            covered |= {b + timedelta(days=k) for k in range((e - b).days + 1)}
        assert not days - covered, (county, sorted(days - covered)[:3])
    assert {p.name.split("_")[2] for p in saved} <= {fetch_backtest.county_slug(c).split("_")[0]
                                                      for c in region.search_counties}
