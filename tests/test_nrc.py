"""NRC second source: parsing the yearly xlsx, the match rule, and "a STEERS match wins"."""

import json
import zipfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

from pipeline import build, nrc
from pipeline.contract import validate
from pipeline.parse import steers_incident, steers_search

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INEOS_REGISTRY_ID = "110000462623"


# ---- parsing ------------------------------------------------------------------------------------------------------

def _sheet(rows: list[list[str | None]]) -> str:
    def cell(ci: int, ri: int, v: str | None) -> str:
        ref = f"{chr(65 + ci)}{ri}"
        return "" if v is None else f'<c r="{ref}" t="inlineStr"><is><t>{escape(v)}</t></is></c>'
    body = "".join(f'<row r="{ri}">{"".join(cell(ci, ri, v) for ci, v in enumerate(r))}</row>'
                   for ri, r in enumerate(rows, 1))
    return ('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f"<sheetData>{body}</sheetData></worksheet>")


def _xlsx(path: Path, sheets: dict[str, list[list[str | None]]]) -> Path:
    """A minimal workbook in the NRC layout (inline strings, sheets found through workbook.xml.rels)."""
    names = list(sheets)
    wb = ('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + "".join(f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>' for i, n in enumerate(names, 1))
          + "</sheets></workbook>")
    rels = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(names) + 1))
            + "</Relationships>")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        for i, n in enumerate(names, 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet(sheets[n]))
    return path


IC_HEAD = ["SEQNOS", "INCIDENT_DATE_TIME", "INCIDENT_DTG", "TYPE_OF_INCIDENT", "LOCATION_ADDRESS", "LOCATION_STATE",
           "LOCATION_COUNTY", "LAT_DEG", "LAT_MIN", "LAT_SEC", "LAT_QUAD", "LONG_DEG", "LONG_MIN", "LONG_SEC", "LONG_QUAD"]


def test_extract_joins_the_three_sheets_and_keeps_only_the_counties(tmp_path):
    p = _xlsx(tmp_path / "CY24.xlsx", {
        "CALLS": [["SEQNOS", "DATE_TIME_RECEIVED", "RESPONSIBLE_COMPANY"],
                  ["11", "45464.665277777778", "ACME CHEMICAL"], ["12", "45464.5", "FAR AWAY CO"]],
        "INCIDENT_COMMONS": [IC_HEAD,
                             ["11", "6/21/2024 9:38", "OCCURRED", "FIXED", "1 MAIN ST", "TX", "Harris",
                              "29", "42", "0", "N", "95", "15", "0", None],
                             ["12", "6/21/2024 9:00", "OCCURRED", "FIXED", "2 MAIN ST", "TX", "LUBBOCK"] + [None] * 8,
                             ["13", "6/21/2024 9:00", "OCCURRED", "FIXED", "3 MAIN ST", "LA", "HARRIS"] + [None] * 8],
        "MATERIAL_INVOLVED": [["SEQNOS", "CAS_NUMBER", "AMOUNT_OF_MATERIAL", "UNIT_OF_MEASURE", "NAME_OF_MATERIAL"],
                              ["11", "000071-43-2", "7581", "POUND(S)", "LIQUID BENZENE"],
                              ["11", "000000-00-0", "0", "UNKNOWN AMOUNT", "BUTADIENE"],
                              ["12", "000071-43-2", "5", "POUND(S)", "BENZENE"]],
    })
    rows = nrc.extract(p)
    assert [r["report"] for r in rows] == ["11"]  # Lubbock County (no AutoGC region) and a Louisiana "Harris" are left out
    r = rows[0]
    assert (r["incident_local"], r["company"], r["county"], r["received"]) == (
        "2024-06-21T09:38", "ACME CHEMICAL", "HARRIS", "2024-06-21T15:58")
    assert (r["lat"], r["lon"]) == (29.7, -95.25)  # blank LONG_QUAD still means west
    assert r["materials"] == [
        {"name": "LIQUID BENZENE", "cas": "71-43-2", "amount": 7581.0, "unit": "POUND(S)"},
        {"name": "BUTADIENE", "cas": None, "amount": None, "unit": "UNKNOWN AMOUNT"}]


def test_coordinates_outside_texas_are_dropped():
    ic = {"LAT_DEG": "92", "LAT_MIN": "0", "LONG_DEG": "29", "LONG_MIN": "0"}  # lat/lon swapped by the caller
    assert nrc.coords(ic) is None
    assert nrc.coords({"LAT_DEG": "29.5", "LONG_DEG": "-95.1"}) == (29.5, -95.1)


def test_missing_sheet_is_a_prescriptive_error(tmp_path):
    p = _xlsx(tmp_path / "CY24.xlsx", {"CALLS": [["SEQNOS"]]})
    with pytest.raises(nrc.NrcError, match="INCIDENT_COMMONS"):
        nrc.extract(p)


def test_nrc_time_is_local_clock_time_like_steers():
    """The demo night's INEOS release reads 09:38 in both sources, so NRC's incident time is local time."""
    rep = next(r for r in nrc.load("Harris") if r["report"] == "1402549")
    inc = steers_incident(RAW / "steers_425347.html")
    assert rep["incident_local"] == inc["start_local"] == "2024-06-21T09:38"
    assert [m["cas"] for m in rep["materials"]] == ["71-43-2"]


def test_extract_matches_its_provenance_hash():
    import hashlib
    ledger = {e["file"]: e for e in json.loads(nrc.LEDGER.read_text())}
    entry = ledger[f"nrc/{nrc.EXTRACT.name}"]
    assert hashlib.sha256(nrc.EXTRACT.read_bytes()).hexdigest() == entry["sha256"]
    assert set(entry["derived_from"]) <= set(ledger) and all(ledger[f]["url"] and ledger[f]["sha256"]
                                                            for f in entry["derived_from"])


@pytest.mark.parametrize(("name", "cas", "param", "want"), [
    ("BENZENE", None, "45201", True),
    ("BENZENE HYDROCARBON MIX", None, "45201", True),
    ("CYCLOPENTADIENE, STYRENE, BENZEN", None, "45201", True),  # NRC cuts names at 32 characters
    ("ETHYLBENZENE", "100-41-4", "45201", False),
    ("DICHLOROBENZENE", None, "45201", False),
    ("UNKNOWN MATERIAL", "71-43-2", "45201", True),
    ("1, 3 BUTADIENE", None, "43218", True),
    ("VOC'S (TO INCLUDE BUTADIENE AND BUTENES)", None, "43218", True),
    ("1,2-BUTADIENE", None, "43218", False),
    ("BENZENE", None, "43218", False),
])
def test_compound_is_named_by_cas_or_whole_word(name, cas, param, want):
    assert nrc.names_compound({"name": name, "cas": cas}, param) is want


# ---- the match rule -----------------------------------------------------------------------------------------------

ORIGIN = (29.7062725, -95.2611331)  # Milby Park
INEOS = (29.7176, -95.2203)  # ~4 km east-northeast of Milby Park


def _rep(report: str, when: str, *, lat=INEOS[0], lon=INEOS[1], name="BENZENE", cas="71-43-2") -> dict:
    return {"report": report, "source_file": "CY24.xlsx", "incident_local": when, "time_basis": "OCCURRED",
            "received": None, "type": "FIXED", "cause": None, "company": "ACME CHEMICAL", "address": "1 MAIN ST",
            "city": "HOUSTON", "county": "HARRIS", "lat": lat, "lon": lon,
            "materials": [{"name": name, "cas": cas, "amount": None, "unit": "UNKNOWN AMOUNT"}]}


def _cands(reps: list[dict], winds=(70.0, 70.0), param="45201") -> list[dict]:
    # the 09:00 CST hour on 2024-06-21 is 10:00 CDT; the window is 04:00-12:00 local
    return nrc.candidates(reps, date(2024, 6, 21), 9, param, [], [], ORIGIN, list(winds))


def test_candidates_need_the_window_the_compound_and_report_where_they_sit():
    got = _cands([_rep("1", "2024-06-21T09:38"), _rep("2", "2024-06-21T03:59"), _rep("3", "2024-06-21T12:01"),
                  _rep("4", "2024-06-21T11:00", name="TOLUENE", cas="108-88-3"),
                  _rep("5", "2024-06-21T04:00", lat=29.60, lon=-95.26)])  # 12 km south: outside the corridor
    assert [(c["report"], c["in_corridor"]) for c in got] == [("1", True), ("5", False)]
    assert got[0]["located_by"] == "coordinates in the NRC record"


def test_a_report_without_coordinates_is_located_only_by_the_steers_echo_rule():
    rep = _rep("1", "2024-06-21T09:38", lat=None, lon=None) | {"company": "INEOS PHENOL"}
    [c] = _cands([rep])
    assert c["in_corridor"] is None and c["located_by"].startswith("unresolved")


def _no_report_rc() -> dict:
    out = {"incident": "1", "entity": "Elsewhere", "rn": "RN0", "start_local": "2024-06-21T09:00", "compound": "x",
           "pounds": 1.0, "facility_id": "X", "distance_km": 30.0, "bearing_deg": 200.0, "in_corridor": False,
           "resolution": "outside the corridor"}
    return build.record_check([out], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                              earlier_complete=True)


def test_an_nrc_report_in_the_corridor_counts_as_a_second_source():
    rc = _no_report_rc()
    assert rc["status"] == "no_report_after_deadline"
    out = nrc.second_source(rc, _cands([_rep("1402549", "2024-06-21T09:38")]), "45201")
    assert out["status"] == "reported_nrc" and out["nrc"]["report"] == "1402549"
    assert out["incident"] is None  # the NRC report is never shown as a state report
    assert [c["status"] for c in out["checks"]] == ["no_report_after_deadline"] * 2  # the STEERS checks stand
    assert out["search_scope"].endswith(nrc.SCOPE_SENTENCE)
    assert out["nrc"]["source_url"] == "https://nrc.uscg.mil/FOIAFiles/CY24.xlsx"


def test_an_nrc_report_outside_the_corridor_changes_nothing():
    rc = _no_report_rc()
    assert nrc.second_source(rc, _cands([_rep("5", "2024-06-21T04:00", lat=29.60, lon=-95.26)]), "45201") is rc


def test_an_unlocated_nrc_report_blocks_absence():
    out = {"incident": "1", "entity": "Elsewhere", "rn": "RN0", "start_local": "2024-06-21T09:00", "compound": "x",
           "pounds": 1.0, "facility_id": "X", "distance_km": 30.0, "bearing_deg": 200.0, "in_corridor": False,
           "resolution": "outside the corridor"}
    rc = build.record_check([out], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True, unplaced_other=["777"])
    assert rc["status"] == "search_incomplete" and rc["unplaced_other_reports"] == ["777"]


def test_steers_mismatch_is_never_overridden_by_nrc():
    rc = {"status": "reported_mismatch", "incident": "9", "search_scope": "x", "checks": []}
    assert nrc.second_source(rc, _cands([_rep("1", "2024-06-21T09:38")]), "45201") is rc


# ---- STEERS wins, on the real demo night -------------------------------------------------------------------------

@pytest.fixture(scope="module")
def demo_inputs() -> dict:
    cfg = build.EVENT
    day = cfg["day"]
    echo = json.loads((RAW / cfg["echo"]).read_text())
    search = steers_search(RAW / f"steers_search_harris_{day.replace('/', '')}.html")
    details = {r["incident"]: steers_incident(RAW / f"steers_{r['incident']}.html") for r in search["rows"]}
    echo_rows = echo["Results"]["Facilities"] + [
        r for p in sorted(RAW.glob("echo_name_*.json")) for r in json.loads(p.read_text())["Results"]["Facilities"]]
    ineos = next(r for r in echo_rows if r.get("RegistryID") == INEOS_REGISTRY_ID and r.get("FacLat"))
    return {"cfg": cfg, "echo": echo, "echo_rows": echo_rows, "details": details,
            "ineos": (float(ineos["FacLat"]), float(ineos["FacLong"]))}


def _demo_trace(d: dict, details: dict, nrc_reports: list[dict]) -> dict:
    cfg = d["cfg"]
    monitors = build.load_monitors(cfg)
    winds = {cfg["wind_site"]: build.load_wind(cfg["wind_site"], cfg["year"], cfg["day"])}
    return build.trace(monitors, winds, cfg["wind_site"], d["echo"], d["echo_rows"], details, True,
                       date(2024, 6, 21), cfg["param"], earlier_complete=True, earlier_note="x",
                       nrc_reports=nrc_reports)


def test_steers_match_wins_over_an_nrc_report_in_the_corridor(demo_inputs):
    lat, lon = demo_inputs["ineos"]
    rep = _rep("1402549", "2024-06-21T09:38", lat=lat, lon=lon)
    rc = _demo_trace(demo_inputs, demo_inputs["details"], [rep])["record_check"]
    assert rc["status"] == "reported" and rc["incident"] == "425347" and "nrc" not in rc


def test_same_night_without_the_steers_report_falls_to_the_nrc_report(demo_inputs):
    lat, lon = demo_inputs["ineos"]
    rep = _rep("1402549", "2024-06-21T09:38", lat=lat, lon=lon)
    others = {k: v for k, v in demo_inputs["details"].items() if k != "425347"}
    t = _demo_trace(demo_inputs, others, [rep])
    assert t["record_check"]["status"] == "reported_nrc"
    assert _demo_trace(demo_inputs, others, [])["record_check"]["status"] == "no_report_after_deadline"


def test_an_nrc_night_passes_the_contract_with_a_hedged_packet(demo_inputs):
    lat, lon = demo_inputs["ineos"]
    others = {k: v for k, v in demo_inputs["details"].items() if k != "425347"}
    t = _demo_trace(demo_inputs, others, [_rep("1402549", "2024-06-21T09:38", lat=lat, lon=lon)])
    ev = build.assemble_event(t, build.load_monitors(demo_inputs["cfg"]), date(2024, 6, 21), "45201", "x",
                              [{"file": "f"}])
    assert validate(ev) == []
    assert "NRC report 1402549" in ev["packet"]["draft_en"] and "reporte NRC 1402549" in ev["packet"]["draft_es"]
    broken = ev | {"record_check": {k: v for k, v in ev["record_check"].items() if k != "nrc"}}
    assert any("reported_nrc" in e for e in validate(broken))


def test_scope_sentence_is_the_one_the_web_translates():
    assert nrc.SCOPE_SENTENCE in (ROOT / "web" / "src" / "reportWindow.ts").read_text()
