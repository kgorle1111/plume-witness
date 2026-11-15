"""Facility history files: fields, neutral wording, ids that exist in the cached TCEQ pages, no upwind-only listing."""

import json
import re
from pathlib import Path

import pytest

from pipeline import facilities

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "facilities"
BT = ROOT / "data" / "raw" / "backtest"
BANNED = re.compile(r"\b(illegal|violations?|unreported|caught|polluters?|proves?)\b", re.IGNORECASE)
FILES = sorted(p for p in OUT.glob("*.json") if p.name != "index.json")


@pytest.fixture(scope="module")
def index() -> dict:
    return json.loads((OUT / "index.json").read_text())


def load(p: Path) -> dict:
    return json.loads(p.read_text())


def test_one_file_per_facility_in_tri_universe(index):
    tri = json.loads((ROOT / "web" / "public" / "tri.json").read_text())["facilities"]
    assert {p.stem for p in FILES} == set(tri) == {r["id"] for r in index["facilities"]}


def test_fields_and_bounds():
    for p in FILES:
        f = load(p)
        assert f["schema"] == facilities.SCHEMA and f["registry_id"] == p.stem, p.name
        assert f["name"] and f["echo_url"].startswith("https://echo.epa.gov/"), p.name
        assert f["reports_to_state"]["count"] == len(f["reports_to_state"]["reports"]), p.name
        for r in f["reports_to_state"]["reports"]:
            assert len(r["cause_excerpt"]) <= facilities.CAUSE_MAX, (p.name, r["incident"])
            assert r["start_local"][:4] in facilities.YEARS and r["end_local"] >= r["start_local"]
            assert r["url"].endswith(f"target={r['incident']}")
            assert r["benzene_lbs"] >= 0 and r["butadiene_lbs"] >= 0
            assert re.fullmatch(r"[a-z0-9_]+", r["event_type_code"]) and r["filed_by"], (p.name, r["incident"])
        assert f["caveats"][0].startswith("Being upwind of a spike is not evidence of anything")


def test_no_banned_words_anywhere():
    for p in [*FILES, OUT / "index.json"]:
        hits = BANNED.findall(p.read_text())
        assert not hits, f"{p.name}: {hits}"


def test_every_incident_exists_in_cached_pages():
    for p in FILES:
        for r in load(p)["reports_to_state"]["reports"]:
            page = BT / f"steers_{r['incident']}.html"
            assert page.exists(), f"{p.name}: incident {r['incident']} has no cached detail page"


def test_each_incident_is_on_exactly_one_facility():
    seen: dict[str, str] = {}
    for p in FILES:
        for r in load(p)["reports_to_state"]["reports"]:
            assert r["incident"] not in seen, (r["incident"], p.name, seen.get(r["incident"]))
            seen[r["incident"]] = p.name


def test_matched_nights_are_only_reported_with_the_facilitys_own_report():
    nights = json.loads((ROOT / "web" / "public" / "nights" / "index.json").read_text())
    status = {n["id"]: n["status"] for n in nights}
    total = 0
    for p in FILES:
        f = load(p)
        own = {r["incident"] for r in f["reports_to_state"]["reports"]}
        for n in f["matched_nights"]:
            total += 1
            assert status[n["night_id"]] == "reported", n
            assert n["incident"] in own, n
    assert total == sum(1 for s in status.values() if s == "reported")


def test_no_upwind_without_report_listing():
    """The files hold no key or phrase that lists nights a facility was upwind with no matched report."""
    nights = json.loads((ROOT / "web" / "public" / "nights" / "index.json").read_text())
    unmatched = {n["id"] for n in nights if n["status"] != "reported"}
    phrases = re.compile(r"no[_ ]report|not[_ ]yet[_ ]reported|upwind[_ ]nights|no matching report", re.IGNORECASE)
    for p in FILES:
        text = p.read_text()
        assert not phrases.search(text), p.name
        assert not any(nid in text for nid in unmatched), p.name
        assert set(load(p)) == {"schema", "registry_id", "name", "address", "lat", "lon", "distance_km",
                                "nearest_monitor", "echo_url", "reports_to_state", "reports_to_epa",
                                "matched_nights", "caveats"}


def test_cause_excerpt_helpers():
    assert len(facilities.excerpt("word " * 100)) <= facilities.CAUSE_MAX
    assert facilities.excerpt("short  text\n here") == "short text here"
    assert facilities.cause_excerpt("A worker caught the leak early") == (facilities.CAUSE_WITHHELD, True)
    assert facilities.cause_excerpt(None)[1] is False


def test_generator_output_matches_committed_files(index):
    files, cov = facilities.build_files()
    assert cov == index["coverage"]
    for rid, f in files.items():
        assert json.loads(facilities.dumps(f)) == load(OUT / f"{rid}.json")
