"""National Response Center (NRC) incident reports: a second, federal report source for the record check.

The NRC (US Coast Guard) takes phone reports of releases at or above a CERCLA reportable quantity (10 lb for both
benzene and 1,3-butadiene) and publishes them as one xlsx per calendar year at https://nrc.uscg.mil/. A report gives
an incident start time (no end), the responsible company, a street address, county, the materials and an amount,
often "UNKNOWN AMOUNT". Coordinates are rare. The file calls the data initial and not validated.

What this module does:
- fetch: download CY24/CY25 one request at a time, with URL, bytes, SHA-256 and fetch time in provenance.json.
  The xlsx files (15-18 MB each) stay out of git; the typed extract (Harris and Jefferson counties) is committed
  with its own SHA-256 and the hashes of the files it came from.
- extract: a stdlib xlsx reader (no new dependency) joins CALLS, INCIDENT_COMMONS and MATERIAL_INVOLVED.
- match: an NRC report counts for a spike only if it started inside build.MATCH_WINDOW_H, names the measured
  compound (CAS number, or a material name that names it), and sits in the upwind corridor: by its own coordinates
  when the record has them, else by build.locate, the reviewed ECHO name/address rule the STEERS check uses.
- second_source: applied after the STEERS check and only when STEERS found nothing in the corridor and window;
  a STEERS report in the corridor (matching or not) always stands.

Usage: uv run python -m pipeline.nrc   (fetches what is missing, re-hashes, writes the extract)
"""

import hashlib
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from pipeline import build
from pipeline.names import display_name

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "nrc"
LEDGER = RAW / "provenance.json"
EXTRACT = RAW / "nrc_tx_2024_2025.json"
EXTRACT_SCHEMA = "plume-witness.nrc-extract/v1"
HOME = "https://nrc.uscg.mil/"
FILE_URL = "https://nrc.uscg.mil/FOIAFiles/{}"
FILES = ("CY24.xlsx", "CY25.xlsx")
UA = "plume-witness-hackathon/0.1 (public-data research)"
TIMEOUT_S, DELAY_S = 300, 3.0
MAX_XLSX_BYTES = 60_000_000  # kn: CY24 is 15 MB, CY25 18 MB; refuse anything far larger rather than fill the disk
# The counties of pipeline.regions (STEERS spelling). kn: a corridor can reach a neighbouring county (Chambers
# from Baytown); the STEERS search is county-bound too, so both sources stop at the same line.
COUNTIES = ("HARRIS", "JEFFERSON", "BRAZORIA", "NUECES", "KARNES", "BEXAR", "COMAL", "WILSON", "DALLAS", "DENTON",
            "JOHNSON", "TARRANT", "WISE", "ECTOR", "MIDLAND", "EL PASO")
STATE = "TX"

CAS = {"45201": "71-43-2", "43218": "106-99-0"}
# A material name that names the compound: whole word, so ETHYLBENZENE and DICHLOROBENZENE do not count. NRC cuts
# names at 32 characters ("CYCLOPENTADIENE, STYRENE, BENZEN"), so a cut-off BENZEN at the very end counts.
NAMES = {"45201": re.compile(r"(?<![A-Z])BENZENE(?![A-Z])|(?<![A-Z])BENZEN$"),
         "43218": re.compile(r"(?<![A-Z])(?<!1,2-)(?<!1,2 )BUTADIENE(?![A-Z])")}

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


class NrcError(ValueError):
    pass


# ---- stdlib xlsx reader -------------------------------------------------------------------------------------------

def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    out = []
    for _, el in ET.iterparse(z.open("xl/sharedStrings.xml")):
        if el.tag == _NS + "si":
            out.append("".join(t.text or "" for t in el.iter(_NS + "t")))
            el.clear()
    return out


def _sheet_paths(z: zipfile.ZipFile) -> dict[str, str]:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    return {s.get("name"): "xl/" + target[s.get(_RNS + "id")].lstrip("/").removeprefix("xl/")
            for s in wb.iter(_NS + "sheet")}


def sheet_rows(z: zipfile.ZipFile, sheet: str, strings: list[str]):
    """Yield each row of one sheet as a dict keyed by the header row. Empty cells are None."""
    paths = _sheet_paths(z)
    if sheet not in paths:
        raise NrcError(f"sheet {sheet!r} not in the workbook (has {sorted(paths)}); the NRC file layout changed")
    header: list[str] | None = None
    for _, el in ET.iterparse(z.open(paths[sheet])):
        if el.tag != _NS + "row":
            continue
        cells: dict[int, str] = {}
        for c in el.iter(_NS + "c"):
            t, v = c.get("t"), c.find(_NS + "v")
            if t == "inlineStr":
                cells[_col(c.get("r"))] = "".join(x.text or "" for x in c.iter(_NS + "t"))
            elif v is not None and v.text is not None:
                cells[_col(c.get("r"))] = strings[int(v.text)] if t == "s" else v.text
        el.clear()
        if header is None:
            header = [cells.get(i) for i in range(max(cells) + 1)] if cells else []
            continue
        yield {h: (cells.get(i) or None) for i, h in enumerate(header) if h}


# ---- typed records ------------------------------------------------------------------------------------------------

def norm_cas(cas: str | None) -> str | None:
    """'000071-43-2' -> '71-43-2'; NRC's placeholder '000000-00-0' -> None."""
    if not cas:
        return None
    parts = cas.strip().split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    head = parts[0].lstrip("0")
    return None if not head else f"{head}-{parts[1]}-{parts[2]}"


def parse_local(s: str | None) -> str | None:
    """NRC INCIDENT_DATE_TIME '6/21/2024 9:38' -> '2024-06-21T09:38'. It is local clock time: the INEOS report of
    2024-06-21 reads 9:38 in both NRC and STEERS (tests/test_nrc.py pins it)."""
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y %H:%M").isoformat(timespec="minutes")
    except ValueError:
        return None


def excel_time(v: str | None) -> str | None:
    """An Excel serial day number (CALLS.DATE_TIME_RECEIVED) as ISO minutes, in whatever zone NRC stored it.

    kn: the zone of the received time is not documented; it is kept as published and never used for a deadline."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return (datetime(1899, 12, 30) + timedelta(days=x)).isoformat(timespec="minutes")


def _amount(v: str | None, unit: str | None) -> float | None:
    if not unit or "UNKNOWN" in unit.upper():
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dms(deg: str | None, mins: str | None, sec: str | None, quad: str | None) -> float | None:
    try:
        d = float(deg)
    except (TypeError, ValueError):
        return None
    try:
        x = d + float(mins or 0) / 60 + float(sec or 0) / 3600
    except ValueError:
        return None
    return -x if (quad or "").strip().upper() in ("S", "W") else x


def coords(ic: dict) -> tuple[float, float] | None:
    """The record's own latitude/longitude, or None. A point outside Texas's box is a typo, not a location."""
    lat = _dms(ic.get("LAT_DEG"), ic.get("LAT_MIN"), ic.get("LAT_SEC"), ic.get("LAT_QUAD"))
    lon = _dms(ic.get("LONG_DEG"), ic.get("LONG_MIN"), ic.get("LONG_SEC"), ic.get("LONG_QUAD") or "W")
    if lat is None or lon is None:
        return None
    if lon > 0:  # NRC often leaves LONG_QUAD blank; every longitude in the United States is west
        lon = -lon
    if not (25.5 <= lat <= 36.6 and -106.7 <= lon <= -93.5):
        return None
    return (round(lat, 6), round(lon, 6))


def record(ic: dict, call: dict | None, mats: list[dict], source_file: str) -> dict:
    """One NRC report as a typed row (the extract's shape)."""
    ll = coords(ic)
    return {
        "report": ic["SEQNOS"], "source_file": source_file,
        "incident_local": parse_local(ic.get("INCIDENT_DATE_TIME")),
        "time_basis": (ic.get("INCIDENT_DTG") or "").upper() or None,  # OCCURRED / DISCOVERED / ...
        "received": excel_time((call or {}).get("DATE_TIME_RECEIVED")),
        "type": ic.get("TYPE_OF_INCIDENT"), "cause": ic.get("INCIDENT_CAUSE"),
        "company": (call or {}).get("RESPONSIBLE_COMPANY"),
        "address": ic.get("LOCATION_ADDRESS") or ic.get("LOCATION_STREET1"),
        "city": ic.get("LOCATION_NEAREST_CITY"), "county": (ic.get("LOCATION_COUNTY") or "").upper() or None,
        "lat": ll[0] if ll else None, "lon": ll[1] if ll else None,
        "materials": [{"name": m.get("NAME_OF_MATERIAL"), "cas": norm_cas(m.get("CAS_NUMBER")),
                       "amount": _amount(m.get("AMOUNT_OF_MATERIAL"), m.get("UNIT_OF_MEASURE")),
                       "unit": m.get("UNIT_OF_MEASURE")} for m in mats],
    }


def extract(path: Path, counties: tuple[str, ...] = COUNTIES, state: str = STATE) -> list[dict]:
    """Every NRC report in one yearly xlsx whose location is in `state` and one of `counties`."""
    with zipfile.ZipFile(path) as z:
        strings = _shared_strings(z)
        ic = {r["SEQNOS"]: r for r in sheet_rows(z, "INCIDENT_COMMONS", strings)
              if r.get("SEQNOS") and (r.get("LOCATION_STATE") or "").upper() == state
              and (r.get("LOCATION_COUNTY") or "").upper() in counties}
        calls = {r["SEQNOS"]: r for r in sheet_rows(z, "CALLS", strings) if r.get("SEQNOS") in ic}
        mats: dict[str, list[dict]] = {}
        for r in sheet_rows(z, "MATERIAL_INVOLVED", strings):
            if r.get("SEQNOS") in ic:
                mats.setdefault(r["SEQNOS"], []).append(r)
    return [record(ic[s], calls.get(s), mats.get(s, []), path.name) for s in sorted(ic, key=int)]


# ---- matching -----------------------------------------------------------------------------------------------------

def names_compound(m: dict, param: str) -> bool:
    """True when one material line is the measured compound: its CAS number, or a name that names it (a mixture
    such as 'BENZENE HYDROCARBON MIX' counts; ETHYLBENZENE does not)."""
    if m.get("cas") == CAS[param]:
        return True
    return bool(NAMES[param].search((m.get("name") or "").upper().strip()))


def place(rep: dict, facilities: list[dict], echo_rows: list[dict], origin: tuple[float, float],
          winds: list[float]) -> dict:
    """Where an NRC report sits relative to the corridor: by its own coordinates, else by build.locate."""
    in_corr = {f["id"]: f for f in facilities}
    if rep.get("lat") is not None and rep.get("lon") is not None:
        p = (rep["lat"], rep["lon"])
        d, b = build.haversine_km(origin, p), build.bearing_deg(origin, p)
        off = min(abs((w - b + 180) % 360 - 180) for w in winds) if winds else 180.0
        inside = d <= build.CORRIDOR_RADIUS_KM and off <= build.CORRIDOR_HALF_ANGLE
        return {"facility_id": None, "distance_km": round(d, 1), "bearing_deg": round(b, 1), "in_corridor": inside,
                "located_by": "coordinates in the NRC record"}
    fac, how = build.locate(rep.get("company") or "", rep.get("address") or "", echo_rows)
    if fac is None:
        return {"facility_id": None, "distance_km": None, "bearing_deg": None, "in_corridor": None,
                "located_by": f"unresolved: {how}"}
    rid = fac.get("RegistryID")
    if rid in in_corr:
        f = in_corr[rid]
        return {"facility_id": rid, "distance_km": f["distance_km"], "bearing_deg": f["bearing_deg"],
                "in_corridor": True, "located_by": how}
    p = (float(fac["FacLat"]), float(fac["FacLong"]))
    return {"facility_id": rid, "distance_km": round(build.haversine_km(origin, p), 1),
            "bearing_deg": round(build.bearing_deg(origin, p), 1), "in_corridor": False, "located_by": how}


def window(det_day: date, det_hour_cst: int) -> tuple[datetime, datetime]:
    """The STEERS match window, [spike - 6 h, spike + 2 h] in local time (build.MATCH_WINDOW_H)."""
    t = build._local(det_day, det_hour_cst)
    return t + timedelta(hours=build.MATCH_WINDOW_H[0]), t + timedelta(hours=build.MATCH_WINDOW_H[1])


def candidates(reports: list[dict], det_day: date, det_hour_cst: int, param: str, facilities: list[dict],
               echo_rows: list[dict], origin: tuple[float, float], winds: list[float]) -> list[dict]:
    """NRC reports that started inside the match window and name the compound, each placed against the corridor
    (in_corridor True, False, or None when it could not be located). Nearest start to the spike first.

    NRC gives a start and no end, so the report's start must itself fall in the window (a STEERS report only has to
    overlap it)."""
    lo, hi = window(det_day, det_hour_cst)
    spike = build._local(det_day, det_hour_cst)
    out = []
    for rep in reports:
        if not rep.get("incident_local"):
            continue
        start = datetime.fromisoformat(rep["incident_local"])
        if not lo <= start <= hi:
            continue
        named = [m for m in rep["materials"] if names_compound(m, param)]
        if named:
            out.append(rep | place(rep, facilities, echo_rows, origin, winds)
                       | {"named": named, "start_to_spike_h": round((spike - start).total_seconds() / 3600, 2)})
    out.sort(key=lambda r: (abs(r["start_to_spike_h"]), int(r["report"])))
    return out


# One fixed sentence (web/src/reportWindow.ts translates search_scope sentence by sentence); the details are in rc.nrc.
SCOPE_SENTENCE = ("Also searched National Response Center (NRC) reports for the county: one in the upwind corridor, "
                  "in the match window, lists the compound.")
# Statuses the STEERS check returns when it found no report in the corridor and window. reported_mismatch is not
# here: a STEERS report was running in the corridor, and NRC never overrides what STEERS says.
OPEN = ("no_report_after_deadline", "search_incomplete")


def second_source(rc: dict, cands: list[dict], param: str) -> dict:
    """The record check after NRC (`cands` from `candidates`). Unchanged unless STEERS found nothing in the corridor
    and window and an NRC report in the corridor matches; then the status is reported_nrc, the STEERS checks stay
    as they were, and the NRC report is named in rc.nrc. The STEERS search scope is kept and one fixed NRC sentence
    added. (An NRC candidate that could not be located has already blocked absence in build.record_check.)"""
    hits = [c for c in cands if c["in_corridor"]]
    if rc["status"] not in OPEN or rc.get("incident") or not hits:
        return rc
    h = hits[0]
    m = h["named"][0]
    name = build.COMPOUNDS[param][0]
    return rc | {
        "status": "reported_nrc", "search_scope": f"{rc['search_scope']} {SCOPE_SENTENCE}",
        "nrc": {"report": h["report"], "source_url": FILE_URL.format(h["source_file"]), "source_file": h["source_file"],
                "company": display_name(h["company"]) if h["company"] else None, "address": h["address"],
                "incident_local": h["incident_local"], "time_basis": h["time_basis"], "received": h["received"],
                "compound": name, "material": m["name"], "amount": m["amount"], "unit": m["unit"],
                "located_by": h["located_by"], "facility_id": h["facility_id"], "distance_km": h["distance_km"],
                "bearing_deg": h["bearing_deg"], "start_to_spike_h": h["start_to_spike_h"],
                "other_reports": [x["report"] for x in hits[1:]],
                "note": "NRC data are initial phone reports, not validated; the report gives a start time, no end."},
    }


# ---- loading ------------------------------------------------------------------------------------------------------

_CACHE: dict[Path, dict] = {}


def load(county: str, path: Path = EXTRACT) -> list[dict]:
    """The committed extract's reports for one county (STEERS spelling, any case), or for several joined by ", " (a
    region searched by more than one county). Missing file is an error: a record check that silently skipped NRC
    would read as 'searched NRC, found nothing'."""
    if path not in _CACHE:
        if not path.exists():
            raise NrcError(f"{path} is missing; run `uv run python -m pipeline.nrc` to fetch and extract NRC reports")
        doc = json.loads(path.read_text())
        if doc.get("schema") != EXTRACT_SCHEMA:
            raise NrcError(f"{path}: schema {doc.get('schema')!r}, expected {EXTRACT_SCHEMA}")
        _CACHE[path] = doc
    want = {c.strip().upper() for c in county.split(",")}
    if not want <= set(_CACHE[path]["counties"]):
        raise NrcError(f"county {county!r} is not in the NRC extract ({_CACHE[path]['counties']}); add it to "
                       "nrc.COUNTIES and re-run `uv run python -m pipeline.nrc`")
    return [r for r in _CACHE[path]["reports"] if r["county"] in want]


# ---- fetch --------------------------------------------------------------------------------------------------------

def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str, ledger: list[dict]) -> Path:
    """Download one yearly file unless it is on disk; one request, then a pause."""
    path = RAW / name
    if path.exists():
        return path
    url = FILE_URL.format(name)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        if r.status != 200:
            raise NrcError(f"{url} returned HTTP {r.status}; wait and retry once")
        body = r.read(MAX_XLSX_BYTES + 1)
        modified = r.headers.get("Last-Modified")
    if len(body) > MAX_XLSX_BYTES:
        raise NrcError(f"{url} is over {MAX_XLSX_BYTES} B; check the file before raising the cap")
    RAW.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    ledger[:] = [e for e in ledger if e["file"] != f"nrc/{name}"] + [{
        "file": f"nrc/{name}", "url": url, "params": None, "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(), "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "last_modified": modified, "listed_on": HOME, "in_git": False}]
    time.sleep(DELAY_S)
    return path


def main() -> None:
    ledger: list[dict] = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
    reports: list[dict] = []
    for name in FILES:
        path = fetch(name, ledger)
        entry = next((e for e in ledger if e["file"] == f"nrc/{name}"), None)
        if entry is None:
            raise NrcError(f"{path} is on disk with no provenance entry; delete it and re-run to fetch it again")
        if _sha(path) != entry["sha256"]:
            raise NrcError(f"{path}: SHA-256 differs from provenance.json; NRC may have republished it. Delete the "
                           "file and its ledger entry, re-fetch, and review the change")
        reports += extract(path)
    doc = {"schema": EXTRACT_SCHEMA, "generated_by": "uv run python -m pipeline.nrc", "state": STATE,
           "counties": list(COUNTIES), "from": [e for e in ledger if e["file"].endswith(".xlsx")],
           "note": "NRC marks these data initial and not validated. incident_local is the reported local clock time; "
                   "amount is null where NRC gives UNKNOWN AMOUNT.",
           "reports": reports}
    EXTRACT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    ledger = [e for e in ledger if e["file"] != f"nrc/{EXTRACT.name}"] + [{
        "file": f"nrc/{EXTRACT.name}", "url": None, "params": None, "bytes": EXTRACT.stat().st_size,
        "sha256": _sha(EXTRACT), "fetched_at": None, "derived_from": [f"nrc/{n}" for n in FILES],
        "generated_by": "uv run python -m pipeline.nrc", "in_git": True}]
    LEDGER.write_text(json.dumps(ledger, indent=1) + "\n")
    by_county = {c: sum(1 for r in reports if r["county"] == c) for c in COUNTIES}
    print(json.dumps({"reports": len(reports), "by_county": by_county}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
