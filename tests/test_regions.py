"""Second region (Beaumont-Port Arthur): same rules, separate files, labeled as not backtested; Houston unchanged."""

import hashlib
import json
import re
from pathlib import Path

import pytest

from pipeline import backtest, nights, regions, spikes
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
    assert backtest.SITE_NAMES == regions.HOUSTON_SITES and len(backtest.SITE_NAMES) == 8


def test_houston_backtest_json_is_byte_identical():
    assert json.dumps(backtest.run(), indent=1) == (ROOT / "data" / "build" / "backtest.json").read_text()


def test_houston_spikes_json_is_byte_identical():
    bt = json.loads(spikes.SRC.read_text())
    out = spikes.export(bt, {s: backtest.site_coords(s) for s in backtest.SITE_NAMES})
    assert "region" not in out
    assert spikes.dumps(out).encode() == spikes.OUT.read_bytes()


# test_nights.test_committed_files_are_current already compares every Houston night file byte for byte.


# --- Beaumont ---

@pytest.fixture(scope="module")
def bmt_nights():
    return nights.generate(region=BMT)


@pytest.fixture(scope="module")
def bmt_scan():
    return spikes.region_scan(BMT)


@pytest.fixture(scope="module")
def bmt_spikes(bmt_scan):
    bt, coords = bmt_scan
    return spikes.export(bt, coords, BMT)


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
        assert ev["region"] == {"key": "beaumont", "label": "Beaumont-Port Arthur", "backtested": False,
                                "note": regions.NOT_BACKTESTED_NOTE}
        assert ev["cannot_say"][0] == regions.NOT_BACKTESTED_NOTE
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


def test_spike_log_is_labeled_and_has_no_ground_truth_claim(bmt_spikes):
    assert bmt_spikes["region"]["backtested"] is False
    assert bmt_spikes["region"]["note"] == regions.NOT_BACKTESTED_NOTE
    assert bmt_spikes["summary"]["known_missed_reports"] is None
    assert "no backtest" in bmt_spikes["source"]
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
    ids = {r["id"] for _, r in evs} | {s["id"] for s in skipped}
    assert {r["night_id"] for r in bmt_spikes["rows"]} == ids


def test_published_spike_log_is_current(bmt_spikes):
    assert spikes.dumps(bmt_spikes).encode() == BMT.spikes_out.read_bytes()
    assert len(BMT.spikes_out.read_bytes()) < spikes.MAX_BYTES
