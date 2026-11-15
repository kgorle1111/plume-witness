"""Los Angeles: South Coast AQMD Rule 1180 community air monitoring stations near the LA-area refineries.

The stations run automated gas chromatographs (AutoGC) that report hourly benzene and 1,3-butadiene, like the TCEQ
AutoGC sites. The public history is South Coast AQMD's quarterly bulk download ("Previous one hour data", all
stations in one CSV per quarter, files generated 2023-07-27; the latest quarter is Q4 2022). The zips, the
download page and the data portal page that lists each station's coordinates are in data/raw/region_los_angeles/
with provenance.json (URL, bytes, SHA-256, fetch time).

What this module does, and only this: turn those files into the same per-day hourly tables the Texas code reads, then
run the unchanged build.baseline and build.detect over them, so Los Angeles counts spikes by exactly the Texas rule.
The coverage page (pipeline.coverage) lists the stations and their counts. The files carry no wind, so nothing here
is traced upwind or checked against reports.

    uv run python -m pipeline.la1180   (prints the stations, hours and spikes)
"""

import csv
import html
import io
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from pipeline import build

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "region_los_angeles"
PORTAL = RAW / "r1180_portal.html"
COUNTY = "Los Angeles"
YEARS = (2020, 2021, 2022)
PARAMS = {"Benzene_gc": "45201", "13-Butadiene_gc": "43218"}
UNIT = "ppb"  # the files' only unit (every compound, every quarter 2020-2022); anything else stops the parse

# File code -> the station's name on the data portal (r1180_portal.html). The files use 4-letter codes and the portal
# names; the pairs are matched by place name (HDSN Hudson, JUDS Judson, GUEN Guenser Park, ...).
# kn: UMCW is First Methodist (Wilmington First United Methodist Church) and ANTH St Anthony (it starts 2020-08-12,
# six days after the nearby El Segundo station, ELSG, stops); both pairings are by name and dates, not a published key.
# WILH (2020-03 to 2022-12) matches no portal station by name, so it has no coordinates and is left out; its only
# hour at the trigger level is a check-gas hour (is_check_gas), so no spike count depends on it.
STATIONS = {
    "HDSN": "HUDSON AIR MONITORING STATION",
    "IPRT": "INNER PORT AIR MONITORING STATION",
    "SLKE": "ST LUKE AIR MONITORING STATION",
    "JUDS": "JUDSON AIR MONITORING STATION",
    "UMCW": "FIRST METHODIST AIR MONITORING STATION",
    "MHAN": "MANHATTAN BEACH AIR MONITORING STATION",
    "ELSG": "EL SEGUNDO AIR MONITORING STATION",
    "ANTH": "ST ANTHONY AIR MONITORING STATION",
    "GUEN": "GUENSER PARK AIR MONITORING STATION",
    "ELMA": "ELM AVENUE AIR MONITORING STATION",
}

# The analyzer's check gas holds every compound it measures at about the same level, so a check hour reads all of them
# at once (Manhattan Beach every third day at 12:00: benzene 13.1, 1,3-butadiene 13.7, toluene 10.0, styrene 9.2 ppb).
# A refinery or traffic plume does not carry 1,3-butadiene and styrene at benzene's level together. An hour where all
# seven of these read at least CHECK_GAS_MIN_PPB is a check, not air, and is dropped before any count.
CHECK_GAS_COMPOUNDS = ("Benzene_gc", "13-Butadiene_gc", "Toluene_gc", "Ethylbenzene_gc", "Styrene_gc", "o-Xylene_gc",
                       "mp-Xylenes_gc")
CHECK_GAS_MIN_PPB = 5.0


def portal_stations(path: Path = PORTAL) -> dict[str, tuple[str, float, float]]:
    """Portal name -> (display name, lat, lon), from the portal's hidden monitoring-site inputs."""
    out = {}
    for m in re.finditer(r'<input type="hidden" class="monitoring-site"(.*?)/>', path.read_text(encoding="utf-8"),
                         re.DOTALL):
        a = dict(re.findall(r'data-monitoring-site-([a-z-]+)="([^"]*)"', m.group(1)))
        name = html.unescape(a["community-name"]).strip()
        out[name] = (html.unescape(a["banner"]).strip(), float(a["latitude"]), float(a["longitude"]))
    if not out:
        raise ValueError(f"{path.name}: no monitoring sites found; the portal layout may have changed")
    return out


def stations(path: Path = PORTAL) -> dict[str, tuple[str, float, float]]:
    """File code -> (name, lat, lon) for every station in STATIONS; a name the portal lacks stops the build."""
    listed = portal_stations(path)
    missing = sorted(set(STATIONS.values()) - set(listed))
    if missing:
        raise ValueError(f"{path.name}: the portal no longer lists {missing}")
    return {code: listed[name] for code, name in STATIONS.items()}


def read_rows(f: io.TextIOBase) -> list[dict]:
    """One quarter's CSV rows, checked: the header, the unit and the timestamp format the code relies on."""
    r = csv.DictReader(f)
    if r.fieldnames != ["SiteName", "ParameterName", "LST", "Value", "Unit", "QCCode"]:
        raise ValueError(f"unexpected Rule 1180 CSV header {r.fieldnames}")
    return list(r)


def hourly(rows: list[dict]) -> dict[tuple[str, str], dict[datetime, float]]:
    """(code, compound column) -> {hour start, local standard time: ppb} for QC code 0 rows with a number.

    A "previous one hour" value stamped T averages the hour before T, so it is filed under T - 1 h: the hour it
    started, as TCEQ labels its hours. Quarter files overlap by one stamp; the same hour read twice keeps one value."""
    out: dict[tuple[str, str], dict[datetime, float]] = {}
    for row in rows:
        if row["Unit"] != UNIT:
            raise ValueError(f"{row['SiteName']} {row['ParameterName']}: unit {row['Unit']!r}, expected {UNIT}")
        if row["ParameterName"] not in CHECK_GAS_COMPOUNDS or row["QCCode"] != "0":
            continue
        try:
            v = float(row["Value"])
        except ValueError:
            continue
        t = datetime.strptime(row["LST"], "%Y-%m-%d %H:%M:%S") - timedelta(hours=1)
        out.setdefault((row["SiteName"], row["ParameterName"]), {})[t] = v
    return out


def read_zips(raw: Path = RAW) -> dict[tuple[str, str], dict[datetime, float]]:
    zips = sorted(raw.glob("1hr_q[1-4]_20[0-9][0-9].zip"))
    if not zips:
        raise FileNotFoundError(f"no Rule 1180 hourly zips in {raw}")
    rows = []
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for name in zf.namelist():
                rows += read_rows(io.TextIOWrapper(zf.open(name), encoding="utf-8-sig"))
    return hourly(rows)


def is_check_gas(data: dict[tuple[str, str], dict[datetime, float]], code: str, t: datetime) -> bool:
    vals = [data.get((code, c), {}).get(t) for c in CHECK_GAS_COMPOUNDS]
    return all(v is not None and v >= CHECK_GAS_MIN_PPB for v in vals)


def day_tables(data: dict[tuple[str, str], dict[datetime, float]], code: str, param: str) -> dict[str, list]:
    """{"MM/DD/YYYY": 24 hourly values or None} for one station and compound, check-gas hours removed: the shape
    build.baseline and build.detect read for Texas."""
    column = next(c for c, p in PARAMS.items() if p == param)
    out: dict[str, list] = {}
    for t, v in data.get((code, column), {}).items():
        if t.year not in YEARS or is_check_gas(data, code, t):
            continue
        out.setdefault(t.strftime("%m/%d/%Y"), [None] * 24)[t.hour] = v
    return out


def spikes(data: dict | None = None, raw: Path = RAW) -> list[dict]:
    """Every (day, compound) where the unchanged build.detect fires on any placed station, earliest hour first.

    One row per day and compound, credited to the station detect picks: the same row the Texas spike log has."""
    data = read_zips(raw) if data is None else data
    tables = {(code, p): day_tables(data, code, p) for code in STATIONS for p in PARAMS.values()}
    days = sorted({d for t in tables.values() for d in t}, key=lambda d: datetime.strptime(d, "%m/%d/%Y"))
    out = []
    for day in days:
        for param in PARAMS.values():
            mons = []
            for code in STATIONS:
                table = tables[(code, param)]
                if not table.get(day):
                    continue
                try:
                    base = build.baseline(table, day)
                except ValueError:
                    continue
                mons.append({"site_id": code, "baseline": base,
                             "hourly": [{"hour_cst": h, "value": table[day][h]} for h in range(24)]})
            det = build.detect(mons)
            if det:
                out.append({"day": day, "param": param, "site_id": det["site_id"], "hour": det["hour_cst"],
                            "value": det["value"], "baseline": det["baseline"]})
    return out


def summary(raw: Path = RAW) -> dict[str, dict]:
    """Per station: years with readings, highest benzene and 1,3-butadiene (check-gas hours removed), hours of
    benzene, and the spike rows credited to it."""
    data = read_zips(raw)
    rows = spikes(data)
    out = {}
    for code in STATIONS:
        maxima, years, hours = {}, set(), 0
        for p in PARAMS.values():
            vals = [(d, v) for d, vs in day_tables(data, code, p).items() for v in vs if v is not None]
            years |= {int(d[-4:]) for d, _ in vals}
            maxima[p] = max((v for _, v in vals), default=None)
            hours += len(vals) if p == "45201" else 0
        out[code] = {"years": sorted(years), "max": maxima, "benzene_hours": hours,
                     "spikes": [r for r in rows if r["site_id"] == code]}
    return out


if __name__ == "__main__":
    st = stations()
    s = summary()
    for code, v in s.items():
        print(code, st[code][0], v["years"], v["benzene_hours"], "h", v["max"], len(v["spikes"]), "spikes")
    for code, v in s.items():
        for r in v["spikes"]:
            print(" ", r)
    print("spikes:", sum(len(v["spikes"]) for v in s.values()))
