"""Who lives near each Ship Channel AutoGC monitor: Census ACS 5-year tract data summed within 3 km and 5 km.

Sources (all public, no login, no key):
  ACS 5-year table-based summary file, vintage ACS_VINTAGE (www2.census.gov). The Census Data API (api.census.gov)
  now answers 302 -> missing_key.html for every query, so the same tables are read from the summary-file .dat files.
  Those are nationwide, sorted by GEO_ID, and served with HTTP Range, so a bisect finds the Harris County tract
  rows and only those bytes are fetched (about 1 MB per table instead of 17-190 MB).
  Tract centroids (INTPTLAT / INTPTLON) come from the Census TIGERweb REST service.

Method limit: a tract counts toward a monitor if its internal point is inside the radius. Tracts are not split,
so a tract straddling the circle is wholly in or wholly out. At 3 km that is a handful of tracts; read the
numbers as "the neighbourhoods around the monitor", not "people inside a circle".

Usage: uv run python -m pipeline.people            (reads data/raw/census, no network)
       uv run python -m pipeline.people --fetch    (downloads what is missing first, then builds)
"""

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from pipeline.backtest import SITE_NAMES, site_coords
from pipeline.build import haversine_km

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "census"
LEDGER = RAW / "provenance.json"
OUT = ROOT / "web" / "public" / "people.json"
DOCS = ROOT / "docs" / "people.md"
# Spikes with no matching report come from the spike log, so run pipeline.spikes before this.
SPIKES = ROOT / "web" / "public" / "spikes.json"
OPEN_RADIUS_KM = 3

ACS_VINTAGE = "2024"
ACS_LABEL = "ACS 2024 5-year (2020-2024)"
STATE_COUNTY = "48201"  # Harris County, TX
TRACT_PREFIX = f"1400000US{STATE_COUNTY}"
TRACT_PREFIX_END = "1400000US48202"  # first GEO_ID after Harris tracts
SF_BASE = f"https://www2.census.gov/programs-surveys/acs/summary_file/{ACS_VINTAGE}/table-based-SF/data/5YRData"
TABLES = ("b01003", "b03003", "b01001", "c16001", "b19013", "c16002")
TIGER_URL = (f"https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS{ACS_VINTAGE}"
             "/MapServer/8/query")
TIGER_FILE = "tigerweb_tracts_harris.json"
RADII_KM = (3, 5)

UA = "plume-witness-hackathon-build"
DELAY_S = 0.5
TIMEOUT_S = 60
MAX_FILE_BYTES = 8_000_000  # a Harris-only slice is ~1-2 MB; anything bigger means the bisect went wrong
MIN_UNSET = -222222222  # ACS sentinel codes (-666666666 "no sample", -555555555 ...) are all below this

# Table lines (B01001: sex by age; C16001: language 5+; C16002: household limited-English status).
UNDER_18 = ("B01001_E003", "B01001_E004", "B01001_E005", "B01001_E006",
            "B01001_E027", "B01001_E028", "B01001_E029", "B01001_E030")
OVER_65 = tuple(f"B01001_E{n:03d}" for n in (*range(20, 26), *range(44, 50)))
LEP_HOUSEHOLDS = ("C16002_E004", "C16002_E007", "C16002_E010", "C16002_E013")


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------- fetching

_ledger: list[dict] = json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def _request(url: str, headers: dict | None = None) -> tuple[bytes, dict]:
    """One polite GET. Retries once after a long pause: a second failure should stop the run."""
    time.sleep(DELAY_S)
    for attempt in (1, 2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return r.read(), {k.lower(): v for k, v in r.headers.items()}
        except Exception as e:
            if attempt == 2:
                raise RuntimeError(f"{url} failed twice ({e}); Census may be rate-limiting, wait and rerun") from e
            log(f"retry after error on {url}: {e}")
            time.sleep(30)
    raise AssertionError("unreachable")


def _range(url: str, start: int, end: int) -> tuple[bytes, dict]:
    body, hdr = _request(url, {"Range": f"bytes={start}-{end - 1}"})
    if len(body) > end - start:
        raise RuntimeError(f"{url}: server ignored the Range header ({len(body)} B returned); refusing a full download")
    return body, hdr


def _save(name: str, url: str, params: dict, content: bytes) -> None:
    if len(content) > MAX_FILE_BYTES:
        raise RuntimeError(f"{name}: {len(content)} B is over the {MAX_FILE_BYTES} B cap")
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / name).write_bytes(content)
    _ledger[:] = [e for e in _ledger if e["file"] != f"census/{name}"]
    _ledger.append({"file": f"census/{name}", "url": url, "params": params, "bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "fetched_at": datetime.now(UTC).isoformat(timespec="seconds")})
    LEDGER.write_text(json.dumps(_ledger, indent=1))
    log(f"saved {name} ({len(content)} B)")


def _geo_at(url: str, pos: int, size: int) -> tuple[int, str]:
    """(line_start, GEO_ID) of the first whole line starting at or after byte `pos`."""
    body, _ = _range(url, pos, min(pos + 8192, size))
    nl = body.find(b"\n")
    if nl < 0 or pos + nl + 1 >= size:
        return size, ""
    rest = body[nl + 1:]
    return pos + nl + 1, rest.split(b"|", 1)[0].decode()


def _lower_bound(url: str, size: int, header_end: int, target: str) -> tuple[int, int]:
    """Byte offset of the first line whose GEO_ID >= target, in a file sorted by GEO_ID. Also the probe count."""
    lo, hi, probes = header_end, size, 0  # invariant: line at lo has GEO_ID < target (national row sorts first)
    while hi - lo > 16384:
        start, geo = _geo_at(url, (lo + hi) // 2, size)
        probes += 1
        if start >= hi:
            break
        if geo < target:
            lo = start
        else:
            hi = start
    body, _ = _range(url, lo, min(hi + 8192, size))
    probes += 1
    off = lo
    for line in body.split(b"\n"):
        if line.split(b"|", 1)[0].decode() >= target and off >= lo:
            return off, probes
        off += len(line) + 1
    raise RuntimeError(f"{url}: no GEO_ID >= {target} found; the file layout may have changed")


def fetch_table(table: str) -> None:
    name = f"acs{ACS_VINTAGE}_5yr_{table}_harris_tracts.dat"
    if (RAW / name).exists():
        return
    url = f"{SF_BASE}/acsdt5y{ACS_VINTAGE}-{table}.dat"
    head, hdr = _range(url, 0, 65536)
    size = int(hdr["content-range"].split("/")[1])
    header_end = head.index(b"\n") + 1
    start, p1 = _lower_bound(url, size, header_end, TRACT_PREFIX)
    end, p2 = _lower_bound(url, size, header_end, TRACT_PREFIX_END)
    body, _ = _range(url, start, end)
    _save(name, url, {"byte_range": [start, end], "source_bytes": size, "source_last_modified": hdr.get("last-modified"),
                      "geo_id_prefix": TRACT_PREFIX, "probe_requests": p1 + p2 + 3,
                      "note": "header line + the contiguous Harris County tract rows of the nationwide file"},
          head[:header_end] + body)


def fetch_tigerweb() -> None:
    if (RAW / TIGER_FILE).exists():
        return
    params = {"where": "STATE='48' AND COUNTY='201'", "outFields": "GEOID,NAME,INTPTLAT,INTPTLON",
              "returnGeometry": "false", "orderByFields": "GEOID", "resultRecordCount": "5000", "f": "json"}
    url = f"{TIGER_URL}?{urllib.parse.urlencode(params)}"
    body, _ = _request(url)
    if "features" not in json.loads(body):
        raise RuntimeError(f"TIGERweb returned no 'features': {body[:200]!r}")
    _save(TIGER_FILE, TIGER_URL, params, body)


def fetch_all() -> None:
    fetch_tigerweb()
    for t in TABLES:
        fetch_table(t)


# ---------------------------------------------------------------- reading

def _num(s: str) -> float | None:
    try:
        v = float(s)
    except ValueError:
        return None
    return None if v <= MIN_UNSET else v


def verified_bytes(name: str) -> bytes:
    """Raw file contents, checked against the SHA-256 in the provenance ledger."""
    ledger = {e["file"]: e for e in json.loads(LEDGER.read_text())}
    entry = ledger.get(f"census/{name}")
    if entry is None:
        raise FileNotFoundError(f"census/{name} is not in {LEDGER}; run with --fetch")
    data = (RAW / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError(f"census/{name} does not match its provenance SHA-256; re-fetch or restore the file")
    return data


def load_table(table: str) -> dict[str, dict[str, float | None]]:
    """{tract GEOID: {variable: value}} for the E (estimate) columns only; margins of error are not used."""
    lines = verified_bytes(f"acs{ACS_VINTAGE}_5yr_{table}_harris_tracts.dat").decode().splitlines()
    cols = lines[0].split("|")
    keep = [i for i, c in enumerate(cols) if "_E" in c]
    out = {}
    for ln in lines[1:]:
        f = ln.split("|")
        geo = f[0]
        if not geo.startswith(TRACT_PREFIX):
            raise ValueError(f"{table}: row {geo!r} is not a Harris tract; the byte-range slice is wrong")
        out[geo.removeprefix("1400000US")] = {cols[i]: _num(f[i]) for i in keep}
    return out


def load_tracts() -> list[dict]:
    """One dict per Harris tract: GEOID, point, and every variable the summary needs."""
    feats = json.loads(verified_bytes(TIGER_FILE))["features"]
    pts = {a["GEOID"]: (float(a["INTPTLAT"]), float(a["INTPTLON"])) for f in feats for a in [f["attributes"]]}
    tables = {t: load_table(t) for t in TABLES}
    for t, rows in tables.items():
        if set(rows) != set(pts):
            raise ValueError(f"{t}: {len(rows)} tracts vs {len(pts)} from TIGERweb; the two sources disagree")
    tracts = []
    for geoid, pt in sorted(pts.items()):
        v = {k: x for t in TABLES for k, x in tables[t][geoid].items()}
        tracts.append({"geoid": geoid, "lat": pt[0], "lon": pt[1], "v": v})
    return tracts


# ---------------------------------------------------------------- summing

def _sum(tracts: list[dict], keys: tuple[str, ...] | str) -> float:
    keys = (keys,) if isinstance(keys, str) else keys
    return sum(t["v"].get(k) or 0 for t in tracts for k in keys)


def _pct(num: float, den: float) -> float | None:
    return round(100 * num / den, 1) if den > 0 else None


def tracts_within(tracts: list[dict], center: tuple[float, float], radius_km: float) -> list[dict]:
    """Tracts whose internal point is within radius_km (inclusive) of center."""
    return [t for t in tracts if haversine_km(center, (t["lat"], t["lon"])) <= radius_km]


def summarize(near: list[dict]) -> dict:
    """Shares are ratios of sums (never an average of tract percentages); income is the one weighted mean."""
    pop, hh = _sum(near, "B01003_E001"), _sum(near, "C16002_E001")
    inc = [(t["v"]["B19013_E001"], t["v"].get("C16002_E001") or 0) for t in near if t["v"].get("B19013_E001")]
    inc_w = sum(w for _, w in inc)
    return {
        "tracts": len(near),
        "population": int(pop),
        "households": int(hh),
        "hispanic": int(_sum(near, "B03003_E003")),
        "pct_hispanic": _pct(_sum(near, "B03003_E003"), _sum(near, "B03003_E001")),
        "spanish_at_home": int(_sum(near, "C16001_E003")),
        "pct_spanish_at_home": _pct(_sum(near, "C16001_E003"), _sum(near, "C16001_E001")),
        "limited_english_households": int(_sum(near, LEP_HOUSEHOLDS)),
        "pct_limited_english_households": _pct(_sum(near, LEP_HOUSEHOLDS), hh),
        "under_18": int(_sum(near, UNDER_18)),
        "pct_under_18": _pct(_sum(near, UNDER_18), _sum(near, "B01001_E001")),
        "age_65_plus": int(_sum(near, OVER_65)),
        "pct_65_plus": _pct(_sum(near, OVER_65), _sum(near, "B01001_E001")),
        "median_hh_income_usd": round(sum(m * w for m, w in inc) / inc_w) if inc_w > 0 else None,
        "tracts_with_income": len(inc),
        "tract_geoids": [t["geoid"] for t in near],
    }


METHOD = ("Tracts whose internal point (TIGERweb INTPTLAT/INTPTLON) lies within the radius of the monitor are summed "
          "whole; tracts are not split, so a tract straddling the circle is wholly in or wholly out. Percentages are "
          "ratios of summed counts. Income is the mean of tract median household incomes weighted by households "
          "(a true median of the pooled households is not recoverable from tract medians). Margins of error are not "
          "propagated: tract-level ACS estimates, especially for small areas, can be off by several points. "
          "ACS counts residents, not people present during a release (workers, ship crews).")


def build() -> dict:
    tracts = load_tracts()
    ledger = [e for e in json.loads(LEDGER.read_text())]
    monitors = []
    for site, name in SITE_NAMES.items():
        center = site_coords(site)
        monitors.append({
            "site_id": site, "name": name, "lat": center[0], "lon": center[1],
            "nearest_tract_km": round(min(haversine_km(center, (t["lat"], t["lon"])) for t in tracts), 2),
            "radii_km": {str(r): summarize(tracts_within(tracts, center, r)) for r in RADII_KM},
        })
    return {
        "acs_vintage": ACS_LABEL, "geography": "census tract, Harris County TX (48201)", "method": METHOD,
        "radii_km": list(RADII_KM), "monitors": monitors,
        "near_open_questions": near_open_questions(tracts),
        "sources": [{k: e[k] for k in ("file", "url", "sha256", "fetched_at")} for e in ledger],
    }


def near_open_questions(tracts: list[dict]) -> dict:
    """Residents within OPEN_RADIUS_KM of any monitor with at least one "no matching report" spike. Tracts near two
    such monitors are counted once (a union by GEOID), unlike the per-monitor rows, which overlap."""
    rows = json.loads(SPIKES.read_text(encoding="utf-8"))["rows"]
    sites = sorted({r["site_id"] for r in rows if r["status"] == "no_report_after_deadline"} & set(SITE_NAMES))
    union = {t["geoid"]: t for s in sites for t in tracts_within(tracts, site_coords(s), OPEN_RADIUS_KM)}
    return {"radius_km": OPEN_RADIUS_KM, "site_ids": sites, **summarize([union[g] for g in sorted(union)])}


# ---------------------------------------------------------------- docs

def _n(x: int) -> str:
    return f"{x:,}"


def _about(x: int) -> str:
    return _n(round(x, -2)) if x >= 1000 else _n(x)


def _income(x: int | None) -> str:
    return f"${x:,}" if x else "n/a"


def render_docs(result: dict) -> str:
    rows = {r: [(m, m["radii_km"][str(r)]) for m in result["monitors"]] for r in RADII_KM}
    out = [
        "# Who lives near each monitor\n",
        (f"Source: U.S. Census Bureau, {result['acs_vintage']}, census-tract estimates for Harris County, TX. "
        "Generated by `uv run python -m pipeline.people` from the files in `data/raw/census/` "
        "(URLs, fetch times and SHA-256 in `data/raw/census/provenance.json`); the same numbers are in "
        "`web/public/people.json`.\n"),
        "**Method limit.** " + result["method"] + "\n",
    ]
    q = result["near_open_questions"]
    out += ["## Near a spike with no matching report\n",
            (f"{_n(q['population'])} residents live in the {q['tracts']} tracts within {q['radius_km']} km of the "
             f"{len(q['site_ids'])} monitors that have at least one spike with no matching report "
             f"({q['pct_spanish_at_home']}% speak Spanish at home; {q['pct_under_18']}% are under 18). A tract near two "
             "such monitors is counted once. These are residents, not people exposed: a spike at a monitor does not "
             "say who breathed it.\n")]
    for r in RADII_KM:
        out += [f"## Within {r} km\n",
                ("| Monitor | Tracts | Residents | Hispanic | Spanish at home | Limited-English households | Under 18 | 65+ "
                "| Median household income (approx.) |"),
                "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for m, s in rows[r]:
            if not s["tracts"]:
                out.append(f"| {m['name']} | 0 | no tract point within {r} km (nearest {m['nearest_tract_km']} km) "
                           "| - | - | - | - | - | - |")
                continue
            out.append(f"| {m['name']} | {s['tracts']} | {_n(s['population'])} | {s['pct_hispanic']}% | "
                       f"{s['pct_spanish_at_home']}% | {s['pct_limited_english_households']}% | {s['pct_under_18']}% | "
                       f"{s['pct_65_plus']}% | {_income(s['median_hh_income_usd'])} |")
        out.append("")
    out += ["## Headline sentences (3 km)\n",
            "Each sentence is generated from the 3 km row above. Source for all: " + result["acs_vintage"] +
            ", tract level. Limit for all: whole tracts counted by internal point, estimates carry margins of error, "
            "residents not workers.\n"]
    for m, s in rows[3]:
        if not s["tracts"]:
            s5 = m["radii_km"]["5"]
            out.append(f"- No census tract has its internal point within 3 km of the {m['name']} monitor (nearest is "
                       f"{m['nearest_tract_km']} km), so the 3 km method returns nothing here. Within 5 km: "
                       f"{s5['tracts']} tracts, about {_about(s5['population'])} people, {s5['pct_hispanic']}% Hispanic or "
                       f"Latino. Do not read this as an empty area; the tracts around it are large.")
            continue
        out.append(f"- Around the {m['name']} monitor, about {_about(s['population'])} people live in the {s['tracts']} census "
                   f"tracts within 3 km; {s['pct_hispanic']}% are Hispanic or Latino, {s['pct_spanish_at_home']}% of "
                   f"residents age 5+ speak Spanish at home, and {s['pct_limited_english_households']}% of households "
                   f"have limited English. About {_about(s['under_18'])} are children under 18 and {_about(s['age_65_plus'])} "
                   f"are 65 or older.")
    tot = {k: sum(s[k] for _, s in rows[3]) for k in ("population", "under_18", "age_65_plus")}
    out += ["",
            ("Do not add the per-monitor counts for a combined figure: the 3 km areas overlap (Milby Park, Manchester, "
            "Galena Park and Clinton are within a few km of each other), so the sum "
            f"({_n(tot['population'])}) double-counts residents."), ""]
    return "\n".join(out)


def main(argv: list[str]) -> None:
    if "--fetch" in argv:
        fetch_all()
    result = build()
    OUT.write_text(json.dumps(result, indent=1) + "\n")
    DOCS.write_text(render_docs(result))
    for m in result["monitors"]:
        s = m["radii_km"]["3"]
        log(f"{m['name']:24s} 3km: {s['tracts']:3d} tracts {s['population']:7,d} people "
            f"{s['pct_hispanic']}% Hispanic {s['pct_spanish_at_home']}% Spanish")
    log(f"wrote {OUT.relative_to(ROOT)} and {DOCS.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:])
