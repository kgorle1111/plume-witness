"""Fetch the public data the backtest needs, strictly one request at a time, with provenance.

Everything lands in data/raw/backtest/ with its own ledger (provenance.json there), so the single-event
build's provenance block is unchanged. Files already on disk are skipped: rerunning resumes, never refetches.

Phases (all public, no login):
1. TCEQ site coordinates (TAMIS site pages) for the Ship Channel AutoGC sites
2. AutoGC hourly benzene and 1,3-butadiene, 2024-2025, every site
3. Site wind direction and speed, 2024-2025 (the CAMS id that carries wind is found by trying each listed one),
   plus the AutoGC form's resultant wind (61104/61103), the fallback for sites or days without met-form wind
4. STEERS searches, Harris County (a region: each of its counties), all event types, week by week 2024-2025
   (split when a page hits the 50 cap)
5. STEERS detail page for every emissions event found, plus every other row on a candidate day; `spikedetails` alone
   is what the record check reads on spike days (a region with no backtest fetches only `weeks spikedetails`, and only
   for its `search_counties`; Baytown reuses Houston's Harris searches with `reuse`)
6. EPA ECHO air facilities within 10 mi of each site

Usage: uv run python -m pipeline.fetch_backtest [phase ...]
       uv run python -m pipeline.fetch_backtest --region <key> [phase ...]   (that region's raw folder; the default
       phases fetch everything `pipeline.backtest --region <key>` reads)
       uv run python -m pipeline.fetch_backtest --coverage   (the AutoGC form and the sites with no 2024-2025 data)
"""

import hashlib
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from pipeline import regions
from pipeline.fetch_tceq import (
    AGC_URL,
    DELAY_S,
    ECHO_PAGE,
    ECHO_QUERY,
    MET_URL,
    STEERS_DETAIL,
    STEERS_HOME,
    STEERS_SEARCH,
    TIMEOUT_S,
    UA,
    WIND_DIR,
    WIND_SPEED,
    _get,
)

BT = Path(__file__).resolve().parent.parent / "data" / "raw" / "backtest"
LEDGER = BT / "provenance.json"
MAX_FILE_BYTES = 2_000_000  # kn: per-file guard; the whole set is budgeted at ~30 MB
BENZENE, BUTADIENE = "45201", "43218"
AGC_WIND_DIR, AGC_WIND_SPEED = "61104", "61103"  # resultant wind on the AutoGC form
YEARS = ("2024", "2025")
TAMIS_SITE = "https://www17.tceq.texas.gov/tamis/index.cfm?fuseaction=report.view_site&siteAQS={}"

# Ship Channel AutoGC sites and, per site, the CAMS ids the met form lists for it (kept in pipeline.regions).
SITES = regions.HOUSTON_MET_SELECTS

COUNTIES: tuple[str, ...] = ("HARRIS",)
_ledger: list[dict] = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
_skipped: list[str] = []
_requests = 0  # every HTTP request this run made, saved or not (the budget counts them all)


def use_region(r: regions.Region) -> None:
    """Point every phase at another region's sites, county and raw dir (with its own ledger)."""
    use_dir(r.raw, r.met_selects, r.search_counties)


def use_dir(raw: Path, sites: dict[str, list[str]], counties: tuple[str, ...] = ()) -> None:
    global BT, LEDGER, SITES, COUNTIES, _ledger
    BT, LEDGER, SITES, COUNTIES = raw, raw / "provenance.json", sites, counties
    _ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def county_slug(county: str) -> str:
    """The county as it appears in a saved search's file name ("EL PASO" -> "el_paso")."""
    return county.lower().replace(" ", "_")


def log(msg: str) -> None:
    print(msg, flush=True)


def _save(name: str, url: str, params: dict | None, content: bytes) -> Path | None:
    if len(content) > MAX_FILE_BYTES:
        _skipped.append(f"{name}: {len(content)} B over the {MAX_FILE_BYTES} B per-file cap")
        log(f"SKIP {name} ({len(content)} B)")
        return None
    BT.mkdir(parents=True, exist_ok=True)
    path = BT / name
    path.write_bytes(content)
    _ledger.append({"file": f"{BT.name}/{name}", "url": url, "params": params, "bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "fetched_at": datetime.now(UTC).isoformat(timespec="seconds")})
    LEDGER.write_text(json.dumps(_ledger, indent=1))
    return path


def _polite_get(url: str, data: dict | None = None) -> bytes:
    """One retry after a long pause: a 429 means we went too fast, and a second 429 should stop the run."""
    global _requests
    time.sleep(DELAY_S)
    _requests += 1
    try:
        return _get(url, data)
    except Exception as e:  # noqa: BLE001 - logged and retried once, then re-raised
        log(f"retry after error on {url}: {e}")
        time.sleep(30)
        _requests += 1
        return _get(url, data)


def fetch_sites() -> None:
    for site in SITES:
        name = f"tamis_{site}.html"
        if (BT / name).exists():
            continue
        url = TAMIS_SITE.format(site.replace("_", ""))
        _save(name, url, None, _polite_get(url))
        log(f"site {site}")


def fetch_agc() -> None:
    for site in SITES:
        for year in YEARS:
            for param in (BENZENE, BUTADIENE):
                name = f"agc_{year}_{site}_{param}.html"
                if (BT / name).exists():
                    continue
                params = {"user_year": year, "user_site": site, "user_param": param, "user_units": "ppb-v",
                          "report_format": "comma", "user_decimals": "2"}
                _save(name, AGC_URL, params, _polite_get(AGC_URL, params))
                log(f"agc {name}")


def _has_hourly_rows(content: bytes) -> bool:
    return re.search(rb"\d{2}/\d{2}/\d{4},", content) is not None


def fetch_met() -> None:
    for site, selects in SITES.items():
        for year in YEARS:
            if all((BT / f"met_{year}_{site}_{p}.html").exists() for p in (WIND_DIR, WIND_SPEED)):
                continue
            for sel in selects:
                got = {}
                for param in (WIND_DIR, WIND_SPEED):
                    params = {"submitted": "1", "first_look": "no", "select_site": sel, "user_year": year,
                              "user_param": param, "time_format": "24hr", "report_format": "comma",
                              "print_daily_avg": "1"}
                    got[param] = (params, _polite_get(MET_URL, params))
                if all(_has_hourly_rows(c) for _, c in got.values()):
                    for param, (params, content) in got.items():
                        _save(f"met_{year}_{site}_{param}.html", MET_URL, params, content)
                    log(f"met {site} {year} via {sel.split('|')[-1]}")
                    break
            else:
                _skipped.append(f"met {site} {year}: no listed CAMS id returned hourly wind")
                log(f"NO WIND {site} {year}")


def fetch_agc_wind() -> None:
    """The AutoGC form's resultant wind (61104 direction, 61103 speed): the fallback when a site has no met-form wind
    that day (build.own_wind tries met first). A page with no hourly rows is not saved, and the gap is reported."""
    for site in SITES:
        for year in YEARS:
            for param in (AGC_WIND_DIR, AGC_WIND_SPEED):
                name = f"agc_{year}_{site}_{param}.html"
                if (BT / name).exists():
                    continue
                params = {"user_year": year, "user_site": site, "user_param": param, "user_units": "ppb-v",
                          "report_format": "comma", "user_decimals": "2"}
                content = _polite_get(AGC_URL, params)
                if not _has_hourly_rows(content):
                    _skipped.append(f"agc wind {name}: no hourly rows on the AutoGC form")
                    log(f"NO AGC WIND {name}")
                    continue
                _save(name, AGC_URL, params, content)
                log(f"agc wind {name}")


def _steers_opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", UA)]
    global _requests
    time.sleep(DELAY_S)
    _requests += 1
    opener.open(STEERS_HOME, timeout=TIMEOUT_S).read()
    return opener


def _search(opener, beg: date, end: date, county: str) -> bytes:
    params = {"newsearch": "yes", "event_start_beg_dt": beg.strftime("%m/%d/%Y"),
              "event_start_end_dt": end.strftime("%m/%d/%Y"), "ls_cnty_name": county}
    global _requests
    time.sleep(DELAY_S)
    _requests += 1
    with opener.open(STEERS_SEARCH, data=urllib.parse.urlencode(params).encode(), timeout=TIMEOUT_S) as r:
        page = r.read()
    return params, page


def _count(page: bytes) -> tuple[int, int] | None:
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page.decode("latin-1"))))
    m = re.search(r"(\d+)-(\d+) of (\d+) Records", t)
    if m:
        return int(m.group(2)) - int(m.group(1)) + 1, int(m.group(3))
    if "returned 0 records" in t or "No records" in t or "No results were found" in t:
        return 0, 0
    return None


def fetch_steers_weeks() -> None:
    for county in COUNTIES:
        _fetch_county_weeks(county)


def _fetch_county_weeks(county: str) -> None:
    todo = []
    d = date(2024, 1, 1)
    while d <= date(2025, 12, 31):
        todo.append((d, min(d + timedelta(days=6), date(2025, 12, 31))))
        d += timedelta(days=7)
    opener = None
    while todo:
        beg, end = todo.pop(0)
        name = f"steers_search_{county_slug(county)}_{beg:%Y%m%d}_{end:%Y%m%d}.html"
        if (BT / name).exists():
            continue
        opener = opener or _steers_opener()
        params, page = _search(opener, beg, end, county)
        c = _count(page)
        if c is None:  # session likely expired: one fresh session, then give up on this window loudly
            opener = _steers_opener()
            params, page = _search(opener, beg, end, county)
            c = _count(page)
            if c is None:
                _skipped.append(f"STEERS search {beg}..{end}: no record count on the page")
                log(f"SKIP search {beg}..{end}: no record count on the page")
                continue
        shown, total = c
        if total > shown and end > beg:
            mid = beg + (end - beg) // 2
            todo[:0] = [(beg, mid), (mid + timedelta(days=1), end)]
            log(f"split {beg}..{end} ({total} > {shown})")
            continue
        _save(name, STEERS_SEARCH, params, page)
        log(f"search {beg}..{end}: {total}")


def _search_files() -> list[Path]:
    return sorted(p for c in COUNTIES for p in BT.glob(f"steers_search_{county_slug(c)}_*.html"))


def _search_rows() -> list[dict]:
    from pipeline.parse import steers_search
    rows = []
    for p in _search_files():
        rows += steers_search(p)["rows"]
    return rows


def fetch_steers_details(only_emissions: bool = True, days: set[str] | None = None,
                         incidents: set[str] = frozenset()) -> None:
    """Detail pages for the saved searches' rows: emissions events only, or (`days`) every row that started on one of
    those days plus the listed `incidents`."""
    t_all = b" ".join(re.sub(rb"\s+", b" ", p.read_bytes()) for p in _search_files())
    for r in _search_rows():
        inc = r["incident"]
        if (BT / f"steers_{inc}.html").exists():
            continue
        if days is not None and r["began"][:10] not in days and inc not in incidents:
            continue
        if only_emissions and days is None:
            # the row's event type follows its end time on the results page
            m = re.search(rb">\s*" + inc.encode() + rb"\s*<.{0,1500}?(EMISSIONS EVENT|MAINTENANCE|AIR STARTUP|"
                          rb"AIR SHUTDOWN|EXCESS OPACITY)", t_all, re.DOTALL)
            if m and m.group(1) != b"EMISSIONS EVENT":
                continue
        if _copy_from_houston(f"steers_{inc}.html"):
            log(f"detail {inc} (reused)")
            continue
        url = STEERS_DETAIL.format(incident=inc)
        _save(f"steers_{inc}.html", url, None, _polite_get(url))
        log(f"detail {inc}")


def fetch_echo() -> None:
    for site in SITES:
        name = f"echo_{site}_10mi.json"
        if (BT / name).exists():
            continue
        lat, lon = site_coords(site)
        q = {"output": "JSON", "p_lat": f"{lat:.4f}", "p_long": f"{lon:.4f}", "p_radius": "10", "p_act": "Y"}
        qid = json.loads(_polite_get(ECHO_QUERY + "?" + urllib.parse.urlencode(q)))["Results"]["QueryID"]
        page = {"output": "JSON", "qid": qid, "pageno": "1"}
        content = _polite_get(ECHO_PAGE + "?" + urllib.parse.urlencode(page))
        _save(name, ECHO_PAGE, {**q, **page}, content)
        res = json.loads(content)["Results"]
        log(f"echo {site}: {len(res.get('Facilities', []))} of {res.get('QueryRows')}")


def site_coords(site: str) -> tuple[float, float]:
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", (BT / f"tamis_{site}.html").read_text(encoding="latin-1")))
    lat = re.search(r"Latitude:[^(]*\((-?\d+\.\d+)", t)
    lon = re.search(r"Longitude:[^(]*\((-?\d+\.\d+)", t)
    if not (lat and lon):
        raise ValueError(f"tamis_{site}.html: no Latitude/Longitude found; the TAMIS page format may have changed")
    return float(lat.group(1)), float(lon.group(1))


def fetch_candidate_day_details() -> None:
    """Every report (any event type) that started on a candidate day: the record check reads them all."""
    from pipeline import backtest
    sites = {s: backtest.site_coords(s, BT) for s in SITES}
    universe, _ = backtest.load_universe(BT)
    cands, _, _ = backtest.select_candidates(universe, backtest.load_echo(BT)[1], sites, BT)
    fetch_steers_details(days={c["day"] for c in cands})


def record_check_incidents() -> set[str]:
    """Every report the record check reads on a day the trigger fires: reports that started that day or the next (a
    match window past midnight), and reports that started earlier and were still open 6 h before the day
    (backtest.earlier_reports)."""
    from pipeline import backtest, build
    sites = {s: backtest.site_coords(s, BT) for s in SITES}
    days = sorted({datetime.strptime(d, "%m/%d/%Y") for d, _, _, _ in backtest.spike_days(sites, BT)})
    want = {(d + timedelta(days=k)).strftime("%m/%d/%Y") for d in days for k in (0, 1)}
    out = set()
    for r in _search_rows():
        began, ended = backtest._stamp(r["began"]), r.get("ended") and backtest._stamp(r["ended"])
        if r["began"][:10] in want or any(
                began < d and (not ended or ended >= d + timedelta(hours=build.MATCH_WINDOW_H[0])) for d in days):
            out.add(r["incident"])
    log(f"spike days {len(days)}: {len(out)} reports the record check reads")
    return out


def fetch_spike_day_details() -> None:
    """Detail pages the record check needs before it may call a search complete (record_check_incidents)."""
    fetch_steers_details(days=set(), incidents=record_check_incidents())


def _copy_from_houston(name: str) -> bool:
    """A region searched by Harris County reuses a file Houston already saved (same request, same bytes): the ledger
    entry keeps the original url, sha256 and fetch time (the sha256 is checked first). False if Houston has none."""
    src = regions.HOUSTON.raw
    if "HARRIS" not in COUNTIES or BT == src or not (src / name).exists():
        return False
    global _houston_prov
    _houston_prov = _houston_prov or {e["file"]: e for e in json.loads((src / "provenance.json").read_text())}
    content, e = (src / name).read_bytes(), _houston_prov.get(f"{src.name}/{name}")
    if not e or hashlib.sha256(content).hexdigest() != e["sha256"]:
        return False  # no or stale ledger entry: fetch it fresh instead
    BT.mkdir(parents=True, exist_ok=True)
    (BT / name).write_bytes(content)
    _ledger.append(e | {"file": f"{BT.name}/{name}"})
    LEDGER.write_text(json.dumps(_ledger, indent=1))
    return True


_houston_prov: dict[str, dict] = {}


def reuse_houston_weeks() -> None:
    """Houston's saved Harris week searches, for a region searched by Harris County (no STEERS requests)."""
    if "HARRIS" not in COUNTIES or BT == regions.HOUSTON.raw:
        raise SystemExit("reuse: only for a non-Houston region whose STEERS county is HARRIS")
    n = sum(_copy_from_houston(p.name) for p in sorted(regions.HOUSTON.raw.glob("steers_search_harris_*.html"))
            if not (BT / p.name).exists())
    log(f"reused {n} Harris week searches from {regions.HOUSTON.raw.name}/")


def fetch_forms() -> None:
    """The AutoGC and met form pages: the site lists the region's monitors were taken from."""
    for name, url in (("agc_form.html", AGC_URL), ("met_form.html", MET_URL)):
        if not (BT / name).exists():
            _save(name, url, None, _polite_get(url))
            log(f"form {name}")


if __name__ == "__main__":
    args = sys.argv[1:]
    region = regions.HOUSTON
    if args[:1] == ["--region"]:
        region, args = regions.get(args[1]), args[2:]
        use_region(region)
    # daydetails: every report on a candidate day, so any region can be backtested (Houston's order is unchanged)
    default = (["sites", "echo", "agc", "met", "agcwind", "weeks", "details", "daydetails"]
               + ([] if region is regions.HOUSTON else ["forms"]) + ["spikedetails"])
    if args[:1] == ["--coverage"]:
        use_dir(regions.COVERAGE_RAW, {s: [] for s in regions.NO_DATA_SITES})
        args = default = ["forms", "sites", "agc"]
    try:
        for ph in args or default:
            {"sites": fetch_sites, "agc": fetch_agc, "met": fetch_met, "weeks": fetch_steers_weeks,
             "details": fetch_steers_details, "echo": fetch_echo, "daydetails": fetch_candidate_day_details,
             "spikedetails": fetch_spike_day_details, "forms": fetch_forms, "agcwind": fetch_agc_wind,
             "reuse": reuse_houston_weeks}[ph]()
    finally:  # a run stopped by an error still reports what it spent
        log(f"requests: {_requests} this run")
    total = sum(p.stat().st_size for p in BT.iterdir())
    log(f"done: {_requests} requests this run; {len(_ledger)} files in ledger, {total / 1e6:.1f} MB on disk")
    for s in _skipped:
        log(f"SKIPPED {s}")
