"""EPA Toxics Release Inventory (TRI) context: what the major facilities near the Ship Channel monitors report to EPA
each year for benzene and 1,3-butadiene air releases. Context only; it explains nothing about any single event.

Universe: ECHO "Major Emissions" air facilities within 15 km of any of the 8 AutoGC monitors (the ECHO lists already
cached for the pipeline and backtest). Linkage ECHO -> TRI: ECHO's own TRIIDs field; fallback TRI's epa_registry_id
(the FRS id) equal to the ECHO RegistryID. Data: EPA Envirofacts REST (no key), air stack + fugitive pounds per
facility per year, for the counties the area facilities sit in.

Usage: uv run python -m pipeline.tri            rebuild web/public/tri.json + docs/tri.md from data/raw/tri (no network)
       uv run python -m pipeline.tri --fetch    first download what is missing (sequential, ~1 s apart), then rebuild
All web text is untrusted data: only whitelisted fields are read, strings are cleaned and length-capped.
"""

import hashlib
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from pipeline import backtest, build

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "tri"
LEDGER = RAW / "provenance.json"
OUT = ROOT / "web" / "public" / "tri.json"
DOC = ROOT / "docs" / "tri.md"
EVENT = ROOT / "web" / "public" / "event.json"

BASE = "https://data.epa.gov/efservice"
USER_AGENT = "plume-witness-open-data/0.1 (EPA TRI context fetch; open-source hackathon project)"
SLEEP_S = 1.0
TIMEOUT_S = 120
YEARS = (2020, 2021, 2022, 2023, 2024)
RADIUS_KM = 15.0
COMPOUNDS = {"benzene": "71-43-2", "butadiene": "106-99-0"}
MEDIA = {"stack": "AIR STACK", "fugitive": "AIR FUG"}
ENVIROFACTS_ROW_CAP = 10000  # an unpaged response this long may be truncated; refuse to trust it
LBS_PER = {"pounds": 1.0, "grams": 1 / 453.59237}
ECHO_LINK = "https://echo.epa.gov/detailed-facility-report?fid="


# ---------------------------------------------------------------- pure helpers (unit-tested)

def clean(s) -> str | None:
    """Untrusted text from a web response: printable, single-spaced, length-capped. Never interpreted."""
    if not isinstance(s, str):
        return None
    s = re.sub(r"[\x00-\x1f\x7f<>]", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:200] or None


def to_lbs(value, unit: str) -> float | None:
    """Release quantity -> pounds. None stays None (not reported); an unknown unit is an error, never a guess."""
    if value is None:
        return None
    k = LBS_PER.get((unit or "").strip().lower())
    if k is None:
        raise ValueError(f"unknown TRI unit_of_measure {unit!r}; add it to LBS_PER only after checking the TRI docs")
    v = float(value)
    if not math.isfinite(v) or v < 0:
        raise ValueError(f"TRI release quantity {value!r} is not a finite non-negative number")
    return round(v * k, 2)


def in_years(rows: list[dict], years=YEARS) -> list[dict]:
    wanted = {str(y) for y in years}
    return [r for r in rows if str(r.get("reporting_year")) in wanted]


def split_ids(s) -> list[str]:
    """ECHO packs several TRIFIDs into one space-separated TRIIDs string."""
    return sorted(set(re.findall(r"[0-9A-Z]{6,}", s.upper()))) if isinstance(s, str) else []


def link_facilities(echo: list[dict], tri_facs: dict[str, dict]) -> dict[str, dict]:
    """ECHO RegistryID -> {'ids': [TRIFID...], 'via': 'echo_triids'|'frs_registry_id'}.
    Primary: the TRIFIDs ECHO itself lists. Fallback: a TRI facility whose epa_registry_id is this RegistryID."""
    by_frs = defaultdict(list)
    for tid, f in tri_facs.items():
        if f.get("epa_registry_id"):
            by_frs[f["epa_registry_id"]].append(tid)
    out = {}
    for r in echo:
        rid = r["RegistryID"]
        ids = split_ids(r.get("TRIIDs"))
        if ids:
            out[rid] = {"ids": ids, "via": "echo_triids"}
        elif by_frs.get(rid):
            out[rid] = {"ids": sorted(by_frs[rid]), "via": "frs_registry_id"}
    return out


def pick_forms(forms: list[dict]) -> dict[tuple[str, int], dict]:
    """One reporting form per (TRIFID, year): active ones only, the most recently received wins (revisions)."""
    best: dict[tuple[str, int], dict] = {}
    for f in forms:
        if str(f.get("active_status", "1")) != "1":
            continue
        k = (f["tri_facility_id"], int(f["reporting_year"]))
        key = (f.get("received_date") or "", f["doc_ctrl_num"])
        if k not in best or key > (best[k].get("received_date") or "", best[k]["doc_ctrl_num"]):
            best[k] = f
    return best


def release_lbs(rows: list[dict], unit: str) -> dict[str, dict[str, float | None]]:
    """doc_ctrl_num -> {medium: pounds|None} from tri_release_qty rows. A range-only answer
    (release_range_code set, no total) and 'NA' are None: reported without a number."""
    out: dict[str, dict] = defaultdict(dict)
    for r in rows:
        total = r.get("total_release")
        out[r["doc_ctrl_num"]][r["environmental_medium"]] = to_lbs(total, unit) if total is not None else None
    return out


def tri_coords(f: dict) -> tuple[float, float] | None:
    """TRI facility position: the preferred lat/long (decimal, longitude stored unsigned) else the legacy
    DDMMSS fields. None when neither parses; the caller then reports the distance as unknown."""
    try:
        if f.get("pref_latitude") is not None and f.get("pref_longitude") is not None:
            return float(f["pref_latitude"]), -abs(float(f["pref_longitude"]))
        la, lo = int(f["fac_latitude"]), int(f["fac_longitude"])
        dms = lambda v: v // 10000 + v % 10000 // 100 / 60 + v % 100 / 3600
        return dms(la), -dms(lo)
    except (KeyError, TypeError, ValueError):
        return None


def year_entry(stack: float | None, fug: float | None) -> dict:
    parts = [v for v in (stack, fug) if v is not None]
    return {"stack_lbs": stack, "fugitive_lbs": fug, "total_lbs": round(sum(parts), 2) if parts else None}


# ---------------------------------------------------------------- fetch

def _ledger() -> list[dict]:
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def _get(url: str, tries: int = 4) -> bytes:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or i == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if i == tries - 1:
                raise
        time.sleep(5 * 2**i)
    raise AssertionError("unreachable")


PERSONAL = re.compile(r"email|phone|contact|certif|technical|signature")


def redact(rows: list[dict]) -> tuple[list[dict], list[str]]:
    """Drop named-individual fields (certifier, contacts, phones, emails) before anything is stored: the
    pipeline never reads them and a public repo should not carry them. Provenance records both hashes."""
    gone = sorted({k for r in rows for k in r if PERSONAL.search(k)})
    return [{k: v for k, v in r.items() if k not in gone} for r in rows], gone


def _save(name: str, url: str) -> None:
    path = RAW / name
    if path.exists():
        return
    body = _get(url)
    data = json.loads(body)
    if not isinstance(data, list):
        raise TypeError(f"{name}: expected a JSON list from Envirofacts, got {type(data).__name__}: {str(data)[:200]}")
    if len(data) >= ENVIROFACTS_ROW_CAP:
        raise ValueError(f"{name}: {len(data)} rows hits the Envirofacts cap; split the query (page with /rows/a:b)")
    RAW.mkdir(parents=True, exist_ok=True)
    kept, gone = redact(data)
    stored = (json.dumps(kept, indent=1) + "\n").encode()
    path.write_bytes(stored)
    led = _ledger()
    led.append({"file": name, "url": url, "bytes_received": len(body), "sha256_received": hashlib.sha256(body).hexdigest(),
                "bytes": len(stored), "sha256": hashlib.sha256(stored).hexdigest(), "redacted_fields": gone,
                "rows": len(data), "fetched_at": datetime.now(UTC).isoformat(timespec="seconds")})
    LEDGER.write_text(json.dumps(led, indent=1) + "\n")
    print(f"fetched {name} ({len(data)} rows)", file=sys.stderr)
    time.sleep(SLEEP_S)


def counties(area: list[dict]) -> list[str]:
    return sorted({r["FacFIPSCode"] for r in area if re.fullmatch(r"\d{5}", r.get("FacFIPSCode") or "")})


def chem_id(cas: str) -> str:
    return cas.replace("-", "").zfill(10)


def fetch_all(fips_list: list[str]) -> None:
    for cname, cas in COMPOUNDS.items():
        _save(f"chem_{cname}.json", f"{BASE}/tri_chem_info/cas_registry_number/=/{cas}/JSON")
    for fips in fips_list:
        for cname, cas in COMPOUNDS.items():
            for y in YEARS:
                head = f"{BASE}/tri_reporting_form/tri_chem_id/=/{chem_id(cas)}/reporting_year/=/{y}"
                fac = f"/tri_facility/state_county_fips_code/=/{fips}"
                _save(f"forms_{fips}_{cname}_{y}.json", f"{head}{fac}/JSON")
                for m, med in MEDIA.items():
                    _save(f"rel_{m}_{fips}_{cname}_{y}.json",
                          f"{head}{fac}/tri_release_qty/environmental_medium/=/{med.replace(' ', '%20')}/JSON")
    # Facility records (for the FRS-id fallback link) come from the forms themselves; no extra requests.


# ---------------------------------------------------------------- build

def load_area() -> tuple[list[dict], dict]:
    _, rows = backtest.load_echo()
    rows += json.loads((ROOT / "data" / "raw" / "echo_milby_8mi.json").read_text())["Results"]["Facilities"]
    sites = {s: backtest.site_coords(s) for s in backtest.SITE_NAMES}
    seen, area = set(), []
    for r in rows:
        rid = r.get("RegistryID")
        if not rid or rid in seen or r.get("AIRUniverse") != "Major Emissions" or not r.get("FacLat"):
            continue
        seen.add(rid)
        p = (float(r["FacLat"]), float(r["FacLong"]))
        near = min(sites, key=lambda s: build.haversine_km(p, sites[s]))
        d = build.haversine_km(p, sites[near])
        if d <= RADIUS_KM:
            area.append(r | {"_dist_km": round(d, 1), "_near": backtest.SITE_NAMES[near]})
    return sorted(area, key=lambda r: r["RegistryID"]), sites


def _read(name: str) -> list[dict]:
    return json.loads((RAW / name).read_text())


def load_tri(fips_list: list[str]) -> tuple[list[dict], dict, dict[str, str]]:
    """-> (forms, release lbs {(doc): {medium: lbs}}, units per compound). Raises if the cache is incomplete."""
    forms, rel, units = [], {}, {}
    for cname in COMPOUNDS:
        p = RAW / f"chem_{cname}.json"
        if not p.exists():
            raise FileNotFoundError(f"{p} missing; run `uv run python -m pipeline.tri --fetch`")
        units[cname] = _read(p.name)[0]["unit_of_measure"]
    for fips in fips_list:
        for cname in COMPOUNDS:
            for y in YEARS:
                for name in [f"forms_{fips}_{cname}_{y}.json"] + [f"rel_{m}_{fips}_{cname}_{y}.json" for m in MEDIA]:
                    if not (RAW / name).exists():
                        raise FileNotFoundError(f"{RAW / name} missing; run `uv run python -m pipeline.tri --fetch`")
                rows = in_years(_read(f"forms_{fips}_{cname}_{y}.json"))
                for f in rows:
                    forms.append(f | {"_compound": cname})
                for m in MEDIA:
                    for doc, d in release_lbs(in_years(_read(f"rel_{m}_{fips}_{cname}_{y}.json")), units[cname]).items():
                        rel.setdefault(doc, {}).update(d)
    return forms, rel, units


def build_tri() -> dict:
    area, sites = load_area()
    fips_list = counties(area)
    forms, rel, units = load_tri(fips_list)
    tri_facs = {f["tri_facility_id"]: f for f in forms}
    links = link_facilities(area, tri_facs)
    chosen: dict[tuple[str, str, int], dict] = {}
    for cname in COMPOUNDS:
        for (tid, y), f in pick_forms([f for f in forms if f["_compound"] == cname]).items():
            chosen[(cname, tid, y)] = f

    def years_for(ids: list[str], y: int) -> tuple[dict, tuple | None]:
        ent, first = {}, None
        for cname in COMPOUNDS:
            docs = [(tid, chosen[(cname, tid, y)]) for tid in ids if (cname, tid, y) in chosen]
            if not docs:
                continue
            s = {m: [rel.get(f["doc_ctrl_num"], {}).get(med) for _, f in docs] for m, med in MEDIA.items()}
            s = {m: (round(sum(v for v in xs if v is not None), 2) if any(v is not None for v in xs) else None)
                 for m, xs in s.items()}
            ent[cname] = year_entry(s["stack"], s["fugitive"])
            first = first or (docs[0][0], clean(docs[0][1].get("facility_name")))
        return ent, first

    facilities, claimed = {}, set()
    for r in area:
        rid = r["RegistryID"]
        e = {"name": clean(r["AIRName"]), "tri_name": None, "trifid": None, "tri_ids": [], "link_via": None,
             "status": "no_tri_id", "reason": None, "distance_km": r["_dist_km"], "nearest_monitor": r["_near"],
             "lat": float(r["FacLat"]), "lon": float(r["FacLong"]), "link": ECHO_LINK + rid, "years": {}}
        lk = links.get(rid)
        if not lk:
            e["reason"] = "ECHO lists no TRI id for this facility and no TRI facility carries its registry id"
        else:
            e["tri_ids"], e["link_via"] = lk["ids"], lk["via"]
            claimed.update(lk["ids"])
            for y in YEARS:
                ent, first = years_for(lk["ids"], y)
                if first and e["trifid"] is None:
                    e["trifid"], e["tri_name"] = first
                if ent:
                    e["years"][str(y)] = ent
            if e["years"]:
                e["status"] = "tri_data"
            else:
                e["status"] = "tri_id_no_reports"
                e["reason"] = ("linked to TRI, but no benzene or 1,3-butadiene form for 2020-2024 "
                               "(the facility may report other chemicals, or none of these)")
                e["trifid"] = lk["ids"][0]
        facilities[rid] = e

    unlinked = []
    for tid in sorted(set(tri_facs) - claimed):
        f = tri_facs[tid]
        p = tri_coords(f)
        near = min(sites, key=lambda k: build.haversine_km(p, sites[k])) if p else None
        d = round(build.haversine_km(p, sites[near]), 1) if p else None
        yrs = {str(y): ent for y in YEARS if (ent := years_for([tid], y)[0])}
        unlinked.append({"trifid": tid, "name": clean(f.get("facility_name")), "city": clean(f.get("city_name")),
                         "epa_registry_id": f.get("epa_registry_id"), "distance_km": d,
                         "within_radius": d is not None and d <= RADIUS_KM, "years": yrs})
    area_ids = {r["RegistryID"] for r in area}
    totals = {str(y): {c: {"total_lbs": 0.0, "stack_lbs": 0.0, "fugitive_lbs": 0.0, "facilities": 0} for c in COMPOUNDS}
              for y in YEARS}
    for rid in area_ids:
        for y, ent in facilities[rid]["years"].items():
            for c, v in ent.items():
                t = totals[y][c]
                for k in ("total_lbs", "stack_lbs", "fugitive_lbs"):
                    t[k] = round(t[k] + (v[k] or 0), 2)
                t["facilities"] += v["total_lbs"] is not None
    n = len(area)
    by_status = defaultdict(int)
    for e in facilities.values():
        by_status[e["status"]] += 1
    matched = by_status["tri_data"] + by_status["tri_id_no_reports"]
    return {
        "schema": "plume-witness/tri/1",
        "source": "EPA Toxics Release Inventory via Envirofacts (data.epa.gov/efservice); facility universe EPA ECHO",
        "years": list(YEARS), "radius_km": RADIUS_KM, "units": "pounds",
        "compounds": {c: {"cas": cas, "unit_in_tri": units[c]} for c, cas in COMPOUNDS.items()},
        "match": {"echo_majors_in_area": n, "matched_to_tri_id": matched,
                  "match_rate": round(matched / n, 3) if n else None,
                  "with_benzene_or_butadiene_data": by_status["tri_data"],
                  "via_echo_triids": sum(1 for e in facilities.values() if e["link_via"] == "echo_triids"),
                  "via_frs_registry_id": sum(1 for e in facilities.values() if e["link_via"] == "frs_registry_id"),
                  "no_tri_id": by_status["no_tri_id"]},
        "totals_by_year": totals,
        "unlinked_tri_reporters": unlinked,
        "caveat": "Self-reported annual estimates of routine releases, not measurements and not events. Context only.",
        "facilities": facilities,
    }


def _lb(x) -> str:
    return "-" if x is None else f"{x:,.0f}"


def _lbs(x) -> str:
    return "no figure" if x is None else f"{x:,.0f} lb"


def render_doc(t: dict, event: dict | None) -> str:
    m, fac = t["match"], t["facilities"]
    rows = []
    for y in reversed(t["years"]):
        a = t["totals_by_year"][str(y)]
        rows.append(f"| {y} | {_lb(a['benzene']['total_lbs'])} | {a['benzene']['facilities']} | "
                    f"{_lb(a['butadiene']['total_lbs'])} | {a['butadiene']['facilities']} |")
    latest = str(t["years"][-1])
    inside = [u for u in t["unlinked_tri_reporters"] if u["within_radius"]]
    inside_txt = "; ".join(
        f"{u['name']} (benzene {_lbs((u['years'].get(latest, {}).get('benzene') or {}).get('total_lbs'))}, "
        f"1,3-butadiene {_lbs((u['years'].get(latest, {}).get('butadiene') or {}).get('total_lbs'))})"
        for u in inside) or "none"
    top = []
    for c, label in (("benzene", "benzene"), ("butadiene", "1,3-butadiene")):
        ranked = sorted(((e["years"][latest][c]["total_lbs"], rid, e) for rid, e in fac.items()
                         if c in e["years"].get(latest, {}) and e["years"][latest][c]["total_lbs"]), reverse=True)[:8]
        top.append(f"\n**{label}, {latest}**\n\n| Facility (as named in TRI) | Reports to EPA (air, lb/yr) | Stack | Fugitive |\n|---|---|---|---|")
        top += [f"| {e['tri_name'] or e['name']} | {_lb(v)} | {_lb(e['years'][latest][c]['stack_lbs'])} | "
                f"{_lb(e['years'][latest][c]['fugitive_lbs'])} |" for v, _, e in ranked]
        top.append("")
    corridor = ""
    if event:
        ids = [f["id"] for f in event.get("facilities", []) if f.get("in_corridor")]
        lines = []
        for i in ids:
            e = fac.get(i)
            if e and e["status"] == "tri_data":
                parts = []
                for c in COMPOUNDS:
                    v = e["years"].get(latest, {}).get(c)
                    parts.append(f"{c} {_lb(v['total_lbs'])} lb" if v and v["total_lbs"] is not None
                                 else f"{c} no number given" if v else f"{c} no {latest} form")
                lines.append(f"- {e['tri_name'] or e['name']}: reports {', '.join(parts)} to EPA for {latest}")
        corridor = (f"\n## The {event.get('date_local', 'demo')} demo corridor\n\n"
                    f"{len(ids)} major facilities sit in the upwind corridor; {len(lines)} of them have benzene or "
                    f"1,3-butadiene TRI forms.\n\n" + "\n".join(lines) + "\n")
    return f"""# TRI context: annual benzene and 1,3-butadiene air releases near the Ship Channel monitors

*Generated by `pipeline/tri.py`; do not edit by hand. Rebuild: `uv run python -m pipeline.tri` (cache only) or
`--fetch` (downloads what is missing). Output: `web/public/tri.json`.*

## Method

1. **Universe.** EPA ECHO air facilities classed "Major Emissions" in the lists already cached for the pipeline and
   backtest, kept if within {t['radius_km']:.0f} km of any of the 8 AutoGC monitors (TAMIS coordinates, haversine).
   That is {m['echo_majors_in_area']} facilities.
2. **Linkage to TRI.** First, the TRI facility ids (TRIFIDs) ECHO itself lists for the facility. Where ECHO lists
   none, a TRI facility whose `epa_registry_id` equals the ECHO RegistryID. Nothing is matched by name.
3. **Data.** Envirofacts `tri_reporting_form` joined to `tri_facility` and `tri_release_qty`, for CAS 71-43-2
   (benzene) and 106-99-0 (1,3-butadiene), reporting years {t['years'][0]}-{t['years'][-1]}, for each county the area
   facilities sit in. Environmental media "AIR STACK" and "AIR FUG" (point and fugitive air releases), in pounds
   (unit checked against `tri_chem_info`). Where a facility filed more than one form for a year, the most recently
   received active one is used. Every raw response is in `data/raw/tri/` with URL, time and SHA-256 in
   `provenance.json`.
4. **Totals** add stack and fugitive. A blank means the form gave no number for that medium (not zero).

## Match rate

{m['matched_to_tri_id']} of {m['echo_majors_in_area']} ECHO majors in the area ({m['match_rate']:.0%}) link to a TRI facility id
({m['via_echo_triids']} via ECHO's TRIIDs, {m['via_frs_registry_id']} via the registry-id fallback);
{m['with_benzene_or_butadiene_data']} of them filed a benzene or 1,3-butadiene form in {t['years'][0]}-{t['years'][-1]}.
{m['no_tri_id']} have no TRI id in ECHO. In `tri.json` each of these carries `status` and a `reason`.

**Coverage gap, stated plainly.** {len(t['unlinked_tri_reporters'])} TRI facilities that filed these forms in the same
counties are not among the linked area majors; {len(inside)} of them sit within {t['radius_km']:.0f} km of a monitor by
TRI's own coordinates (nearest-monitor distance in `unlinked_tri_reporters`). They are absent from the cached ECHO
major list or carry no TRIID there, so they are **not** in the totals below, which therefore understate the area.
Their {latest} totals, listed separately: {inside_txt}.

## Totals in the {t['radius_km']:.0f} km area, pounds per year reported to EPA

| Year | Benzene (air, lb) | Facilities | 1,3-Butadiene (air, lb) | Facilities |
|---|---|---|---|---|
{chr(10).join(rows)}

## Largest reported totals, {latest}
{chr(10).join(top)}{corridor}
## Limits

- Annual **self-reported estimates** made by the facility, using its own methods (monitoring, emission factors,
  engineering estimates). They are not measurements by EPA or by the monitors.
- **Routine, permitted emissions** reported once a year. Emissions events (the TCEQ STEERS reports used elsewhere in
  this project) are a different record; TRI is not an event record and this file says nothing about any single day.
- TRI covers facilities above reporting thresholds in listed industries; absence of a TRI form is not absence of
  emissions.
- Facility names are as TRI spells them; ECHO and TRI coordinates and ids can disagree.
- Context only: no causation is drawn between these totals and what a monitor reads.
- The figures say how much a facility reports to EPA; they do not rate it or compare it with a limit.
- The facility universe is the cached ECHO major list (see the coverage gap above); the totals cover only linked
  facilities.
"""


def main(argv: list[str]) -> int:
    area, _ = load_area()
    if "--fetch" in argv:
        fetch_all(counties(area))
    try:
        t = build_tri()
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(t, indent=1, sort_keys=False) + "\n")
    event = json.loads(EVENT.read_text()) if EVENT.exists() else None
    DOC.write_text(render_doc(t, event))
    print(json.dumps(t["match"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
