"""Fetch the public TCEQ sources for one event and record provenance.

Sources (all public, no login):
- STEERS emissions-event detail page (company self-report)
- AutoGC hourly yearly summary (benzene etc., CST hours, unverified provisional data)
- Site meteorology yearly summary (wind speed/direction)

TCEQ answers parallel requests with HTTP 429, so every request is sequential with a delay.
Usage: uv run python -m pipeline.fetch_tceq
"""

import hashlib
import json
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
UA = "plume-witness-hackathon/0.1 (public-data research)"
DELAY_S = 2.0
TIMEOUT_S = 60

AGC_URL = "https://www.tceq.texas.gov/cgi-bin/compliance/monops/agc_yearly_summary.pl"
MET_URL = "https://www.tceq.texas.gov/cgi-bin/compliance/monops/yearly_summary.pl"
STEERS_DETAIL = "https://www2.tceq.texas.gov/oce/eer/index.cfm?fuseaction=main.getDetails&target={incident}"

BENZENE = "45201"
WIND_SPEED, WIND_DIR = "61101", "61102"


def _get(url: str, data: dict | None = None) -> bytes:
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        if r.status != 200:
            raise RuntimeError(f"{url} returned HTTP {r.status}; TCEQ may be rate-limiting, wait and retry once")
        return r.read()


def save(name: str, url: str, params: dict | None, content: bytes, ledger: list) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / name
    path.write_bytes(content)
    ledger.append({
        "file": name, "url": url, "params": params, "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
    })
    return path


def fetch_event(incident: str, year: str, agc_sites: list[str], met_site_select: str) -> list:
    ledger: list = []
    url = STEERS_DETAIL.format(incident=incident)
    save(f"steers_{incident}.html", url, None, _get(url), ledger)
    time.sleep(DELAY_S)
    for site in agc_sites:
        params = {"user_year": year, "user_site": site, "user_param": BENZENE, "user_units": "ppb-v",
                  "report_format": "comma", "user_decimals": "2"}
        save(f"agc_{year}_{site}_{BENZENE}.html", AGC_URL, params, _get(AGC_URL, params), ledger)
        time.sleep(DELAY_S)
    for param in (WIND_DIR, WIND_SPEED):
        params = {"submitted": "1", "first_look": "no", "select_site": met_site_select, "user_year": year,
                  "user_param": param, "time_format": "24hr", "report_format": "comma", "print_daily_avg": "1"}
        site_id = met_site_select.split("|")[2]
        save(f"met_{year}_{site_id}_{param}.html", MET_URL, params, _get(MET_URL, params), ledger)
        time.sleep(DELAY_S)
    _append_provenance(ledger)
    return ledger


ECHO_QUERY = "https://echodata.epa.gov/echo/air_rest_services.get_facilities"
ECHO_PAGE = "https://echodata.epa.gov/echo/air_rest_services.get_qid"


def fetch_echo(lat: float, lon: float, radius_mi: int, tag: str) -> list:
    """Active air-permitted facilities within radius_mi of a monitor (EPA ECHO, public)."""
    ledger: list = []
    q = {"output": "JSON", "p_lat": f"{lat:.4f}", "p_long": f"{lon:.4f}", "p_radius": str(radius_mi), "p_act": "Y"}
    qid = json.loads(_get(ECHO_QUERY + "?" + urllib.parse.urlencode(q)))["Results"]["QueryID"]
    time.sleep(DELAY_S)
    page = {"output": "JSON", "qid": qid, "pageno": "1"}
    save(f"echo_{tag}.json", ECHO_PAGE, {**q, **page}, _get(ECHO_PAGE + "?" + urllib.parse.urlencode(page)), ledger)
    _append_provenance(ledger)
    return ledger


def fetch_echo_by_name(name: str, state: str, tag: str) -> list:
    """Locate a STEERS facility that the radius query missed, by name (EPA ECHO, public)."""
    ledger: list = []
    q = {"output": "JSON", "p_fn": name, "p_st": state}
    qid = json.loads(_get(ECHO_QUERY + "?" + urllib.parse.urlencode(q)))["Results"].get("QueryID")
    if not qid:
        return ledger
    time.sleep(DELAY_S)
    page = {"output": "JSON", "qid": qid, "pageno": "1"}
    save(f"echo_name_{tag}.json", ECHO_PAGE, {**q, **page}, _get(ECHO_PAGE + "?" + urllib.parse.urlencode(page)), ledger)
    _append_provenance(ledger)
    return ledger


STEERS_HOME = "https://www2.tceq.texas.gov/oce/eer/"
STEERS_SEARCH = "https://www2.tceq.texas.gov/oce/eer/index.cfm?fuseaction=main.searchresults"


def fetch_steers_day(day: str, county: str = "HARRIS") -> list:
    """Every emissions event that STARTED on `day` (MM/DD/YYYY) in `county`, plus each incident's detail page.

    The search needs a session cookie from the home page. Results cap at 50 per page; the parser reports
    the total so the build can refuse to call a capped search complete.
    """
    import http.cookiejar
    import re

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", UA)]
    opener.open(STEERS_HOME, timeout=TIMEOUT_S).read()
    time.sleep(DELAY_S)
    params = {"newsearch": "yes", "event_start_beg_dt": day, "event_start_end_dt": day, "ls_cnty_name": county}
    with opener.open(STEERS_SEARCH, data=urllib.parse.urlencode(params).encode(), timeout=TIMEOUT_S) as r:
        page = r.read()
    ledger: list = []
    tag = day.replace("/", "")
    save(f"steers_search_{county.lower()}_{tag}.html", STEERS_SEARCH, params, page, ledger)
    for incident in sorted(set(re.findall(rb"target=(\d+)", page))):
        time.sleep(DELAY_S)
        inc = incident.decode()
        url = STEERS_DETAIL.format(incident=inc)
        save(f"steers_{inc}.html", url, None, _get(url), ledger)
    _append_provenance(ledger)
    return ledger


def _append_provenance(ledger: list) -> None:
    prov = RAW / "provenance.json"
    old = json.loads(prov.read_text()) if prov.exists() else []
    prov.write_text(json.dumps(old + ledger, indent=1))


if __name__ == "__main__":
    # INEOS Pasadena benzene event (STEERS 425347, 2024-06-21) and the Ship Channel AutoGC sites around it:
    # Milby Park, Manchester, Galena Park, HRM-16 Deer Park (the nearest, used as a contrast).
    out = fetch_event(
        incident="425347", year="2024",
        agc_sites=["48_201_0069", "48_201_0307", "48_201_0057", "48_201_1614"],
        met_site_select="site|Houston Milby Park A169 |48_201_0069|169",
    )
    out += fetch_echo(29.7063, -95.2611, 8, "milby_8mi")
    for row in out:
        print(f"{row['file']:40s} {row['bytes']:>8d} B  {row['sha256'][:12]}")
