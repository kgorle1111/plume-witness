"""Los Angeles replay: every Rule 1180 spike through the same build.trace the Texas nights use.

What is Los Angeles-specific, and only that:
- monitors: pipeline.la1180 (hourly benzene and 1,3-butadiene, check-gas hours removed), hours in PST all year;
- wind: the 1180 files carry none, so each station borrows the nearest airport weather station (ASOS, Iowa
  Environmental Mesonet) that has wind that day, only within backtest.BORROW_MAX_KM, exactly the Texas borrow rule;
- reports: there is no STEERS. The federal NRC reports for Los Angeles County go through the same nrc.candidates /
  nrc.second_source as Texas, and California's Cal OES spill reports are searched for the compound in the same match
  window. Neither is a complete list of emissions events and neither gives an end time, so the search is never
  complete: a spike with no matching report is "Can't say" (search_incomplete, reason no_register), never "no report".

    uv run python -m pipeline.la_replay extract   (NRC and Cal OES Los Angeles County extracts, from the yearly files)
    uv run python -m pipeline.la_replay           (web/public/regions/los_angeles/nights/ and spikes.json)
"""

import csv
import hashlib
import json
import re
import sys
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline import backtest, build, la1180, nights, nrc, regions, spikes, triangulate
from pipeline.contract import validate

RAW = la1180.RAW
TZ = ZoneInfo("America/Los_Angeles")
CA_BOX = (32.5, 42.1, -124.5, -114.1)
COUNTY = "LOS ANGELES"
NRC_FILES = ("CY21.xlsx", "CY22.xlsx")  # every LA spike is in 2021-10..2022-11
NRC_EXTRACT = RAW / "nrc_la_2021_2022.json"
CALOES_FILES = {
    "2021-HazMat-Spill-Reports.xlsx": "https://www.caloes.ca.gov/wp-content/uploads/Fire-Rescue/Documents/"
                                      "2021-HazMat-Spill-Reports.xlsx",
    "2022-Spill-Reports.xls.xlsx": "https://www.caloes.ca.gov/wp-content/uploads/2023/04/2022-Spill-Reports.xls.xlsx",
}
CALOES_EXTRACT = RAW / "caloes_la_2021_2022.json"
CALOES_HOME = ("https://www.caloes.ca.gov/office-of-the-director/operations/response-operations/fire-rescue/"
               "hazardous-materials/spill-release-reporting")
KNOTS_TO_MPH = 1.15078
AIRPORT_WIND_CAVEAT = ("The wind used here was measured at an airport weather station, not at the monitor that flagged "
                       "the spike, so the upwind direction there may differ.")
AIRPORTS = {"LGB": "Long Beach Airport", "TOA": "Torrance Airport", "HHR": "Hawthorne Airport",
            "LAX": "Los Angeles International Airport"}

# Fixed sentences: the web translates search_scope sentence by sentence (web/src/reportWindow.ts).
SCOPE_SEARCHED = ("Searched Cal OES spill reports and National Response Center (NRC) reports for Los Angeles County "
                  "that started in the match window.")
SCOPE_INCOMPLETE = ("Neither source lists every emissions event or gives an end time, so the search is incomplete.")


# ---- reports ------------------------------------------------------------------------------------------------------

def _excel_day(v: str | None) -> date | None:
    try:
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()
    except (TypeError, ValueError):
        return None


def caloes_time(day: str | None, hhmm: str | None) -> str | None:
    """Cal OES 'Incident Date' (Excel day number) and 'Time' ('1150', '520') -> '2022-12-31T11:50', local clock."""
    d = _excel_day(day)
    t = (hhmm or "").strip()
    if d is None or not re.fullmatch(r"\d{1,4}", t) or int(t) // 100 > 23 or int(t) % 100 > 59:
        return None
    return datetime(d.year, d.month, d.day, int(t) // 100, int(t) % 100).isoformat(timespec="minutes")


def caloes_record(r: dict, source_file: str) -> dict:
    """One Cal OES row in the NRC extract's shape (no coordinates: place it by name and address like NRC)."""
    mats = [{"name": (r.get(f"{i}. Substance") or "").strip() or None, "cas": None,
             "amount": nrc._amount(r.get(f"{i}. Quantity"), r.get(f"{i}. Measure")), "unit": r.get(f"{i}. Measure")}
            for i in (1, 2, 3) if (r.get(f"{i}. Substance") or "").strip()]
    return {"report": (r.get("Control#") or "").lstrip("'"), "source_file": source_file,
            "incident_local": caloes_time(r.get("Incident Date"), r.get("Time")),
            "notified_local": nrc.excel_time(r.get("Notified Date")), "company": (r.get("Agency") or "").strip() or None,
            "address": (r.get("Location") or "").strip() or None, "city": (r.get("City") or "").strip() or None,
            "county": COUNTY, "lat": None, "lon": None, "materials": mats}


def read_caloes(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        rows = list(nrc.sheet_rows(z, next(iter(nrc._sheet_paths(z))), nrc._shared_strings(z)))
    if not rows or "Incident Date" not in rows[0] or "County" not in rows[0]:
        raise ValueError(f"{path.name}: no Incident Date / County columns; the Cal OES layout may have changed")
    return [caloes_record(r, path.name) for r in rows if (r.get("County") or "").strip().upper().startswith(COUNTY)]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def extract(caloes_dir: Path, nrc_ledger: list[dict]) -> None:
    """Write the two committed extracts, each with the SHA-256 of the yearly files it came from."""
    reports = [r for n in NRC_FILES for r in nrc.extract(nrc.RAW / n, (COUNTY,), "CA", CA_BOX)]
    NRC_EXTRACT.write_text(json.dumps({
        "schema": nrc.EXTRACT_SCHEMA, "generated_by": "uv run python -m pipeline.la_replay extract", "state": "CA",
        "counties": [COUNTY], "from": [e for e in nrc_ledger if e["file"].split("/")[-1] in NRC_FILES],
        "note": "NRC marks these data initial and not validated. incident_local is the reported local clock time.",
        "reports": reports}, indent=1, ensure_ascii=False) + "\n")
    rows, src = [], []
    for name, url in CALOES_FILES.items():
        p = caloes_dir / name
        rows += read_caloes(p)
        src.append({"file": name, "url": url, "listed_on": CALOES_HOME, "bytes": p.stat().st_size, "sha256": _sha(p),
                    "fetched_at": datetime.fromtimestamp(p.stat().st_mtime, UTC).isoformat(timespec="seconds"),
                    "in_git": False})
    CALOES_EXTRACT.write_text(json.dumps({
        "schema": "plume-witness.caloes-extract/v1", "generated_by": "uv run python -m pipeline.la_replay extract",
        "county": "Los Angeles County", "from": src,
        "note": "Cal OES spill reports: incident date and time as reported (local clock), no end time.",
        "reports": rows}, indent=1, ensure_ascii=False) + "\n")
    ledger_path = RAW / "provenance.json"
    ledger = [e for e in json.loads(ledger_path.read_text())
              if e["file"] not in (f"{RAW.name}/{NRC_EXTRACT.name}", f"{RAW.name}/{CALOES_EXTRACT.name}")]
    for path, srcs in ((NRC_EXTRACT, [f"nrc/{n}" for n in NRC_FILES]), (CALOES_EXTRACT, list(CALOES_FILES))):
        ledger.append({"file": f"{RAW.name}/{path.name}", "url": None, "params": None, "bytes": path.stat().st_size,
                       "sha256": _sha(path), "fetched_at": None, "derived_from": srcs,
                       "generated_by": "uv run python -m pipeline.la_replay extract", "in_git": True})
    ledger_path.write_text(json.dumps(ledger, indent=1) + "\n")
    print(f"NRC {len(reports)}, Cal OES {len(rows)} Los Angeles County reports")


def load_reports(path: Path) -> list[dict]:
    doc = json.loads(path.read_text())
    if not doc.get("reports") and doc.get("reports") != []:
        raise ValueError(f"{path}: no reports list")
    return doc["reports"]


def in_window(reports: list[dict], det_day: date, hour: int) -> list[dict]:
    lo, hi = nrc.window(det_day, hour, TZ)
    return [r for r in reports if r.get("incident_local") and lo <= datetime.fromisoformat(r["incident_local"]) <= hi]


# ---- wind ---------------------------------------------------------------------------------------------------------

def read_asos(raw: Path = RAW) -> dict[str, dict]:
    """Airport -> {name, lat, lon, hours: {hour start (PST): (from_deg, speed_mph)}}. The last routine report in an
    hour (HH:53) stands for that hour; 'M' (missing, or variable direction) is None. Calm reads 0 deg at 0 mph, as
    published, and the calm rule then stops the corridor."""
    out = {}
    for p in sorted(raw.glob("asos_*_*.csv")):
        rows = list(csv.DictReader(p.open(encoding="utf-8")))
        if not rows or list(rows[0]) != ["station", "valid", "lon", "lat", "drct", "sknt"]:
            raise ValueError(f"{p.name}: unexpected ASOS columns")
        st = rows[0]["station"]
        hours: dict[datetime, tuple] = {}
        for r in rows:
            t = datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(minute=0)
            d = None if r["drct"] == "M" else float(r["drct"])
            s = None if r["sknt"] == "M" else round(float(r["sknt"]) * KNOTS_TO_MPH, 1)
            hours[t] = (d, s)
        out[st] = {"name": AIRPORTS[st], "lat": float(rows[0]["lat"]), "lon": float(rows[0]["lon"]), "hours": hours,
                   "file": p.name}
    return out


def _airport_day(a: dict, day: date) -> list[tuple]:
    return [a["hours"].get(datetime(day.year, day.month, day.day, h), (None, None)) for h in range(24)]


def station_wind(code: str, day: date, airports: dict[str, dict]) -> dict | None:
    """The nearest airport with a wind direction that day, within backtest.BORROW_MAX_KM of the station, else None."""
    _, lat, lon = la1180.stations()[code]
    have = [k for k, a in airports.items() if any(d is not None for d, _ in _airport_day(a, day))]
    if not have:
        return None
    k = min(have, key=lambda x: build.haversine_km((lat, lon), (airports[x]["lat"], airports[x]["lon"])))
    a = airports[k]
    if build.haversine_km((lat, lon), (a["lat"], a["lon"])) > backtest.BORROW_MAX_KM:
        return None
    vals = _airport_day(a, day)
    prev_day = day - timedelta(days=1)
    pd, ps = _airport_day(a, prev_day)[23]
    prev = ({"date": prev_day.isoformat(), "hour_cst": 23, "from_deg": pd, "speed_mph": ps}
            if (pd, ps) != (None, None) else None)
    note = (f"the hour before is {prev_day.isoformat()} 23:00 PST" if prev else
            f"no {a['name']} report for {prev_day.isoformat()} 23:00 PST, so hour 0's wind is used alone")
    return {"site_id": f"asos_{k}", "hourly": [{"hour_cst": h, "from_deg": d, "speed_mph": s}
                                               for h, (d, s) in enumerate(vals)],
            "source": "asos", "name": a["name"], "lat": a["lat"], "lon": a["lon"], "file": a["file"],
            "prev_hour": prev, "prev_hour_note": note}


# ---- monitors and nights ------------------------------------------------------------------------------------------

def monitors_for(data: dict, day: str, param: str) -> list[dict]:
    st = la1180.stations()
    out = []
    for code in la1180.STATIONS:
        table = la1180.day_tables(data, code, param)
        if not table.get(day):
            continue
        try:
            base = build.baseline(table, day)
        except ValueError:
            continue
        vals = table[day]
        seen = [h for h in range(24) if vals[h] is not None]
        if not seen:
            continue
        peak = max(seen, key=lambda h: vals[h])
        name, lat, lon = st[code]
        out.append({"site_id": code, "name": name, "lat": lat, "lon": lon, "baseline": base,
                    "hourly": [{"hour_cst": h, "value": vals[h], "flag": None} for h in range(24)],
                    "peak": {"hour_cst": peak, "value": vals[peak]}, "triggered": False})
    return out


def _quarter_zips(day: date) -> list[str]:
    """The 1-hour zips holding the day and its 7-day baseline (a quarter's first week reads the one before)."""
    names = []
    for d in (day - timedelta(days=7), day, day + timedelta(days=1)):  # day + 1: the hour-ending 00:00 stamp
        n = f"1hr_q{(d.month - 1) // 3 + 1}_{d.year}.zip"
        if n not in names and (RAW / n).exists():
            names.append(n)
    return names


def generate(region: regions.Region) -> tuple[list[tuple[dict, dict]], list[dict]]:
    """(event, index row) per spike with wind, and every spike as a backtest.json-shaped row for spikes.export."""
    data = la1180.read_zips()
    airports = read_asos()
    echo_site = {c: json.loads((RAW / f"echo_r1180_{c}_10mi.json").read_text()) for c in la1180.STATIONS}
    for e in echo_site.values():  # "TESORO REF & MKTG CO LLC,CALCINER": the comma glues LLC to the next word
        for r in e["Results"]["Facilities"]:
            if r.get("AIRName"):
                r["AIRName"] = re.sub(r"\s*,\s*", " ", r["AIRName"])
    echo_rows = [r for e in echo_site.values() for r in e["Results"]["Facilities"]]
    nrc_reports, caloes = load_reports(NRC_EXTRACT), load_reports(CALOES_EXTRACT)
    prov = {e["file"].split("/")[-1]: e for e in json.loads((RAW / "provenance.json").read_text())}
    out, rows = [], []
    for sp in la1180.spikes(data):
        day, param = sp["day"], sp["param"]
        det_day = datetime.strptime(day, "%m/%d/%Y").date()
        mons = monitors_for(data, day, param)
        winds = {c: w for c in la1180.STATIONS if (w := station_wind(c, det_day, airports))}
        t = build.trace(mons, winds, None, echo_site[sp["site_id"]], echo_rows, {}, False, det_day, param, {},
                        False, "", county="Los Angeles", nrc_reports=nrc_reports, tz=TZ,
                        scope=f"{SCOPE_SEARCHED} {SCOPE_INCOMPLETE}")
        det = t["detection"]
        if det is None or det["site_id"] != sp["site_id"]:
            raise ValueError(f"{day} {param}: trace detected {det}, la1180.spikes said {sp['site_id']}")
        named = [r for r in in_window(caloes, det_day, det["hour_cst"])
                 if any(nrc.names_compound(m, param) for m in r["materials"])]
        if named:  # kn: no 2021-22 LA County Cal OES row names either compound; placing one needs its own check
            raise NotImplementedError(f"{day}: Cal OES report {named[0]['report']} names the compound; place it")
        nid = nights.night_id(day, param, det["site_id"])
        row = {"day": day, "param": param, "site_id": det["site_id"], "hour_cst": det["hour_cst"],
               "value": det["value"], "baseline": det["baseline"], "search_complete": False,
               "earlier_search_complete": False, "day_reports": 0}
        if "record_check" not in t:
            rows.append(row | {"status": "no_wind", "matched_incident": None})
            continue
        rc = t["record_check"]
        if rc["status"] != "search_incomplete":  # kn: no 2021-22 LA NRC row names either compound; review a match
            raise NotImplementedError(f"{day} {param}: status {rc['status']}; check the scope wording before publishing")
        row |= {"status": rc["status"], "matched_incident": None, "calm_mph": t["calm_mph"],
                "reason_code_override": "calm_wind" if t["calm_mph"] is not None else "no_register"}
        rows.append(row)
        files = _quarter_zips(det_day) + ["r1180_portal.html", t["wind"]["file"], f"echo_r1180_{det['site_id']}_10mi.json",
                                          NRC_EXTRACT.name, CALOES_EXTRACT.name]
        files += sorted({f"echo_r1180_{c}_10mi.json" for c in la1180.STATIONS} - {files[-3]})
        t["wind"] = {k: v for k, v in t["wind"].items() if k != "file"}
        rc["source_url"] = CALOES_HOME  # where a reader can search the reports themselves (no STEERS here)
        ev = build.assemble_event(t, mons, det_day, param, nid, [prov[f] for f in files], region)
        ev["cannot_say"] = [AIRPORT_WIND_CAVEAT if c == build.BORROWED_WIND_CAVEAT else c for c in ev["cannot_say"]]
        ev["triangulation"] = triangulate.triangulate(t, mons)
        errs = validate(ev)
        if errs:
            raise ValueError(f"{nid} failed the contract:\n- " + "\n- ".join(errs))
        out.append((ev, {"id": nid, "date": ev["date_local"], "site": det["site_id"], "site_name": t["trig"]["name"],
                         "compound": ev["compound"]["name"], "value": det["value"], "hour_cst": det["hour_cst"],
                         "status": rc["status"], "search_complete": False}))
    out.sort(key=lambda p: (p[1]["date"], p[1]["compound"], p[1]["site"]))
    return out, rows


def main(region: regions.Region) -> None:
    evs, rows = generate(region)
    stats = nights.write(evs, region.nights_out)
    coords = {c: (lat, lon) for c, (_, lat, lon) in la1180.stations().items()}
    bt = {"schema": spikes.SOURCE_SCHEMA, "source": f"{RAW.relative_to(build.ROOT)} (spike scan)",
          "rules": {"years": [str(y) for y in la1180.YEARS],
                    "trigger": f"value >= max({build.TRIGGER_RATIO:g} x {build.BASELINE_DAYS}-day median, "
                               f"{build.TRIGGER_FLOOR_PPB:g} ppb), earliest hour of the day",
                    "corridor": f"+/-{build.CORRIDOR_HALF_ANGLE} deg of upwind, <= {build.CORRIDOR_RADIUS_KM} km"},
          "spikes": rows, "spike_summary": {"spikes": len(rows), "false_no_report": None}}
    doc = spikes.export(bt, coords, region)
    doc["units"] = "ppb (parts per billion), hourly AutoGC values as South Coast AQMD publishes them"
    doc["tceq_search_page"] = None
    region.spikes_out.write_text(spikes.dumps(doc))
    print(json.dumps({"nights": stats, "by_status": doc["summary"]["by_status"],
                      "rows": [(r["date"], r["site_id"], r["status"], r.get("reason_code")) for r in doc["rows"]]},
                     indent=1))


if __name__ == "__main__":
    if sys.argv[1:2] == ["extract"]:
        extract(Path(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text()))
    else:
        main(regions.LOS_ANGELES)
