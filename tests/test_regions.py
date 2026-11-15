"""Second region (Beaumont-Port Arthur): same rules, separate files, its own backtest; Houston unchanged."""

import hashlib
import json
import re
from dataclasses import replace
from pathlib import Path

import pytest

from pipeline import backtest, detector_eval, nights, regions, spikes
from pipeline.contract import STATUSES, validate

ROOT = Path(__file__).resolve().parent.parent
BANNED = ("illegal", "violation", "unreported", "caught", "polluter", "proves")
BMT = regions.BEAUMONT


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


# --- Houston: the defaults and every published byte stay as they were ---

def test_houston_defaults_point_at_the_old_paths():
    assert regions.HOUSTON.raw == backtest.BT == nights.BT
    assert regions.HOUSTON.spikes_out == spikes.OUT
    assert regions.HOUSTON.nights_out == nights.OUT
    assert backtest.SITE_NAMES == regions.HOUSTON_SITES and len(backtest.SITE_NAMES) == 12


def test_houston_backtest_json_is_byte_identical():
    assert json.dumps(backtest.run(), indent=1) == (ROOT / "data" / "build" / "backtest.json").read_text()


def test_houston_spikes_json_is_byte_identical():
    bt = json.loads(spikes.SRC.read_text())
    out = spikes.export(bt, {s: backtest.site_coords(s) for s in backtest.SITE_NAMES})
    assert "region" not in out
    assert spikes.dumps(out).encode() == spikes.OUT.read_bytes()


# test_nights.test_committed_files_are_current already compares every Houston night file byte for byte.


# --- Web registry: the web's region list is generated from REGIONS, never hand-edited ---

def test_committed_web_registry_matches_regions_py():
    assert regions.WEB_REGISTRY.read_text(encoding="utf-8") == regions.web_registry_text(), (
        "web/src/regions.generated.json is stale: run `uv run python -m pipeline.regions --write-web`")
    rows = json.loads(regions.WEB_REGISTRY.read_text(encoding="utf-8"))
    assert [r["key"] for r in rows] == list(regions.WEB_REGIONS)
    assert rows[-1]["key"] == "los_angeles" and rows[-1]["tz"] == "PST" and "tz" not in rows[0]
    assert rows[0] == {"key": "houston", "label": "Houston Ship Channel", "label_es": "Houston Ship Channel",
                       "place": "on the Houston Ship Channel", "place_es": "en el Canal de Navegación de Houston",
                       "dir": "", "backtested": True, "n_sites": 12, "county": "HARRIS"}
    assert rows[1]["dir"] == "regions/beaumont/" and rows[1]["backtested"] is True
    assert all(r["label"] == regions.WEB_REGIONS[r["key"]].label for r in rows), "labels are the place name only"


# --- Backtest flags: backtested and n_backtest come from a committed run of `pipeline.backtest --region` ---

def test_every_backtested_region_has_its_committed_backtest_with_that_n():
    for r in regions.REGIONS.values():
        out, doc = backtest.out_paths(r)
        if not r.backtested:
            assert r.n_backtest is None and r.note is None, r.key
            continue
        res = json.loads(out.read_text())
        assert res["summary"]["candidates"] == r.n_backtest > 0, (
            f"{r.key}: n_backtest={r.n_backtest} but {out.name} has {res['summary']['candidates']}; "
            f"rerun `{backtest.command(r)}` and update pipeline/regions.py")
        assert f"Of **{r.n_backtest}** real 2024-2025" in doc.read_text(), doc.name
        assert detector_eval.out_paths(r)[1].exists(), r.key


def test_backtested_and_n_backtest_are_set_together():
    with pytest.raises(ValueError, match="set together"):
        replace(BMT, backtested=False)
    with pytest.raises(ValueError, match="set together"):
        replace(BMT, n_backtest=None)
    assert replace(BMT, backtested=False, n_backtest=None).note is None  # no public file says "not backtested"
    assert BMT.note == f"Backtested against company-reported releases (n = {BMT.n_backtest}, 2024-2025)"
    assert regions.HOUSTON.note is None  # Houston's files never carried a region note


# --- Beaumont's backtest: reproducible from the cached raw files ---

@pytest.fixture(scope="module")
def bmt_backtest():
    return backtest.run(region=BMT)


def test_beaumont_backtest_json_and_doc_are_current(bmt_backtest):
    out, doc = backtest.out_paths(BMT)
    assert json.dumps(bmt_backtest, indent=1) == out.read_text(), f"stale: rerun `{backtest.command(BMT)}`"
    assert backtest.render_md(bmt_backtest, BMT) == doc.read_text()
    assert bmt_backtest["region"] == "beaumont" and bmt_backtest["generated_by"] == backtest.command(BMT)


def test_beaumont_detector_doc_is_current():
    res = detector_eval.run(region=BMT)
    assert detector_eval.render_md(res, BMT) == detector_eval.out_paths(BMT)[1].read_text()
    assert res["candidates"] == BMT.n_backtest


def test_beaumont_backtest_uses_only_jefferson_reports_and_its_own_monitors(bmt_backtest):
    assert bmt_backtest["events"], "no candidates"
    for e in bmt_backtest["events"]:
        assert set(e["monitors"]) <= set(BMT.sites), e["incident"]
        assert e["nearest_site_km"] <= backtest.CANDIDATE_RADIUS_KM
    assert {r["site_id"] for r in bmt_backtest["spikes"]} <= set(BMT.sites)
    doc = backtest.out_paths(BMT)[1].read_text()
    assert "Jefferson" in doc and "Harris" not in doc and "Ship Channel" not in doc
    assert "## Other regions" not in doc  # the how-to lives in Houston's docs/backtest.md only


def test_registry_rejects_a_region_the_web_could_not_load():
    fake = replace(BMT, key="corpus_christi", spikes_out=BMT.spikes_out.parent.parent / "corpus_christi" / "spikes.json",
                   nights_out=BMT.spikes_out.parent.parent / "corpus_christi" / "nights")
    assert regions.web_registry({"houston": regions.HOUSTON, "corpus_christi": fake})[1]["dir"] == "regions/corpus_christi/"
    bad = {
        "key": replace(fake, key="Corpus Christi"),
        "nights elsewhere": replace(fake, nights_out=fake.spikes_out.parent / "n"),
        "outputs in another region's folder": replace(BMT, key="corpus_christi"),
    }
    for why, r in bad.items():
        with pytest.raises(ValueError):
            regions.web_registry({"houston": regions.HOUSTON, r.key: r})
            pytest.fail(why)
    with pytest.raises(ValueError, match="Houston must be the first"):
        regions.web_registry({"beaumont": BMT, "houston": regions.HOUSTON})


# --- Beaumont ---

@pytest.fixture(scope="module")
def bmt_nights():
    return nights.generate(region=BMT)


@pytest.fixture(scope="module")
def bmt_scan():
    return spikes.region_scan(BMT)


@pytest.fixture(scope="module")
def bmt_spikes():
    return spikes.export(*spikes.source(BMT), BMT)


def test_backtest_spike_scan_equals_the_plain_spike_scan(bmt_scan, bmt_spikes):
    """The backtest adds ground truth (candidates) but the spike rows are the same scan."""
    plain = spikes.export(*bmt_scan, replace(BMT, backtested=False, n_backtest=None))
    assert plain["rows"] == bmt_spikes["rows"]


@pytest.fixture(scope="module")
def bmt_names() -> set[str]:
    """Every facility name the region's data holds: ECHO facilities near each monitor and every STEERS entity."""
    names = set()
    for p in BMT.raw.glob("echo_*_10mi.json"):
        names |= {f["AIRName"] for f in json.loads(p.read_text())["Results"]["Facilities"] if f.get("AIRName")}
    universe, _ = backtest.load_universe(BMT.raw)
    names |= {r["entity"] for r in universe if r.get("entity")}
    return {_norm(n) for n in names} - {_norm(n) for n in BMT.sites.values()} - {""}


def test_every_raw_file_has_provenance():
    ledger = {e["file"]: e for e in json.loads((BMT.raw / "provenance.json").read_text())}
    files = [p for p in BMT.raw.iterdir() if p.name != "provenance.json"]
    assert len(files) > 50
    for p in files:
        e = ledger[f"{BMT.raw.name}/{p.name}"]
        assert e["sha256"] == hashlib.sha256(p.read_bytes()).hexdigest(), p.name
        assert e["url"].startswith("https://")


def test_sites_are_jefferson_county_autogc_sites():
    assert set(BMT.sites) == {"48_245_0009", "48_245_1035"}
    for s in BMT.sites:
        lat, lon = backtest.site_coords(s, BMT.raw)
        assert 29.8 < lat < 30.2 and -94.3 < lon < -93.8, s  # Beaumont / Nederland, not Houston


def test_nights_pass_the_contract_and_are_labeled(bmt_nights):
    evs, _ = bmt_nights
    assert evs, "no Beaumont nights generated"
    for ev, row in evs:
        assert validate(ev) == [], row["id"]
        assert ev["region"] == {"key": "beaumont", "label": "Beaumont-Port Arthur", "backtested": True,
                                "note": BMT.note}
        assert ev["cannot_say"][0] == BMT.note
        assert "Beaumont-Port Arthur" in ev["title"]
        shown = " ".join((ev["title"], ev["packet"]["draft_en"], ev["packet"]["draft_es"],
                          ev["record_check"]["search_scope"], *ev["cannot_say"]))
        assert "Harris" not in shown and "Houston" not in shown, row["id"]
        assert "Jefferson County" in ev["record_check"]["search_scope"]
        assert not [w for w in BANNED if w in shown.lower()], row["id"]
        assert all(e["file"].startswith("region_beaumont/") for e in ev["provenance"])
        assert {m["site_id"] for m in ev["monitors"]} <= set(BMT.sites)


def test_published_nights_are_current(bmt_nights):
    evs, _ = bmt_nights
    index = json.loads((BMT.nights_out / "index.json").read_text())
    assert [r["id"] for r in index] == [r["id"] for _, r in evs]
    for ev, row in evs:
        assert (BMT.nights_out / f"{row['id']}.json").read_text() == nights.dumps(ev), f"stale: {row['id']}"


def test_spike_log_reads_the_regions_own_backtest(bmt_spikes):
    assert bmt_spikes["region"]["backtested"] is True
    assert bmt_spikes["region"]["note"] == BMT.note
    bt = json.loads(backtest.out_paths(BMT)[0].read_text())
    assert bmt_spikes["summary"]["known_missed_reports"] == bt["spike_summary"]["false_no_report"]
    assert bmt_spikes["source"] == "data/build/backtest-beaumont.json"
    assert {r["status"] for r in bmt_spikes["rows"]} <= set(STATUSES)
    assert sum(bmt_spikes["summary"]["by_status"].values()) == len(bmt_spikes["rows"]) > 0


def test_no_report_rows_never_name_a_facility(bmt_spikes, bmt_names):
    assert len(bmt_names) > 20, "facility list did not load; the name check would be vacuous"
    for r in bmt_spikes["rows"]:
        text = " " + _norm(" ".join(str(v) for v in r.values())) + " "
        assert not [n for n in bmt_names if f" {n} " in text], r["night_id"]
        assert ("matched_incident" in r) == (r["status"] == "reported")


def test_every_spike_row_has_a_replay_file_or_says_why(bmt_spikes, bmt_nights):
    evs, skipped = bmt_nights
    ids = {r["id"] for _, r in evs}
    assert {r["night_id"] for r in bmt_spikes["rows"] if r["night_id"]} == ids
    unlinked = {spikes.spike_id(r) for r in bmt_spikes["rows"] if r["night_id"] is None}
    assert unlinked <= {s["id"] for s in skipped}, "a row lost its replay link without a skipped night to explain it"


def test_published_spike_log_is_current(bmt_spikes):
    assert spikes.dumps(bmt_spikes).encode() == BMT.spikes_out.read_bytes()
    assert len(BMT.spikes_out.read_bytes()) < spikes.MAX_BYTES
