"""Backtest: on real 2024-2025 events the companies themselves reported, does the pipeline see the spike and
find the report inside the upwind corridor?

Candidates (ground truth comes from the self-reports, never from the pipeline):
  every STEERS EMISSIONS EVENT in Harris County that started 2024-01-01..2025-12-31, reported benzene or
  1,3-butadiene pounds, and whose facility (located in EPA ECHO) is within 15 km of a Ship Channel AutoGC site.
Per candidate, the unchanged pipeline (build.trace) runs on the event's start day:
  monitors = AutoGC sites within 15 km of the facility (a farther monitor's corridor can never reach it);
  compound = benzene if the event reported benzene, else 1,3-butadiene;
  wind = the triggering monitor's own wind (nearest site with wind if it has none; recorded);
  day reports = every STEERS row that started that day (from the week searches; same query, wider window),
  plus every earlier-started row still open within 6 h of that day (its own Ended column);
  absence also needs the build.LOOKBACK_DAYS before the day covered by complete week searches.
Outcomes: detected, reporting facility in the corridor (as the pipeline places it), matched (record_check picked
this very incident).

Usage: uv run python -m pipeline.backtest   (reads data/raw/backtest, writes data/build/backtest.json)
"""

import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from pipeline import build
from pipeline.parse import _text, lbs_by_param, steers_incident, steers_search
from pipeline.regions import ALL_SITE_NAMES, HOUSTON_SITES

ROOT = Path(__file__).resolve().parent.parent
BT = ROOT / "data" / "raw" / "backtest"
OUT = ROOT / "data" / "build" / "backtest.json"
DOCS = ROOT / "docs" / "backtest.md"
CANDIDATE_RADIUS_KM = 15.0
# kn: hours around the reported start (CST) in which a trigger hit counts as "near the release". Start day only, so a
# release after ~18:00 whose plume arrives after midnight is missed; extend to the next day if that matters.
NEAR_START_H = (-1, 6)
YEARS = ("2024", "2025")

# Ship Channel AutoGC sites (the backtested region); other regions' sites live in pipeline.regions.
SITE_NAMES = HOUSTON_SITES


def site_coords(site: str, raw: Path = BT) -> tuple[float, float]:
    t = re.sub(r"\s+", " ", _text(raw / f"tamis_{site}.html"))
    lat = re.search(r"Latitude:[^(]*\((-?\d+\.\d+)", t)
    lon = re.search(r"Longitude:[^(]*\((-?\d+\.\d+)", t)
    if not (lat and lon):
        raise ValueError(f"tamis_{site}.html: no decimal Latitude/Longitude; the TAMIS page format may have changed")
    return float(lat.group(1)), float(lon.group(1))


def compound_pounds(path: Path) -> dict[str, float]:
    """Total reported pounds per compound across every emission point on a STEERS detail page."""
    return lbs_by_param(_text(path))


def event_meta(path: Path) -> dict:
    t = re.sub(r"\s+", " ", _text(path))
    typ = re.search(r"Event/Activity Type: (.+?) Date and Time", t)
    loc = re.search(r"Physical Location: (.+?) County:", t)
    return {"type": typ.group(1).strip() if typ else None, "address": loc.group(1).strip() if loc else ""}


locate = build.locate  # the shared implementation lives in build; kept here for the callers that import it


def load_universe(raw: Path = BT) -> tuple[list[dict], list[str]]:
    """Every STEERS row (any event type) from the week searches, and any week whose page is not complete."""
    rows, incomplete = [], []
    for p in sorted(raw.glob("steers_search_*_*_*.html")):
        s = steers_search(p)
        if not (s["total"] == s["shown"] == len(s["rows"])):
            incomplete.append(p.name)
        rows += [r | {"search_file": p.name} for r in s["rows"]]
    seen: set[str] = set()
    return [r for r in rows if not (r["incident"] in seen or seen.add(r["incident"]))], incomplete


def load_echo(raw: Path = BT) -> tuple[dict[str, dict], list[dict]]:
    per_site = {s: json.loads((raw / f"echo_{s}_10mi.json").read_text()) for s in ALL_SITE_NAMES
                if (raw / f"echo_{s}_10mi.json").exists()}
    rows = [r for e in per_site.values() for r in e["Results"]["Facilities"]]
    rows += [r for p in sorted(raw.glob("echo_name_*.json")) for r in json.loads(p.read_text())["Results"]["Facilities"]]
    return per_site, rows


def load_winds(year: str, day: str, sites: dict[str, tuple[float, float]], raw: Path = BT) -> dict[str, dict]:
    """Each site's own wind; a site without wind borrows the nearest site that has it (site_id says which)."""
    own = {}
    for s in sites:
        try:
            w = build.load_wind(s, year, day, raw)
        except (FileNotFoundError, KeyError, ValueError):
            continue
        if any(h["from_deg"] is not None for h in w["hourly"]):
            own[s] = w
    out = {}
    for s, p in sites.items():
        if s in own:
            out[s] = own[s]
        elif own:
            near = min(own, key=lambda o: build.haversine_km(p, sites[o]))
            out[s] = own[near]
    return out


def _details(rows: list[dict], raw: Path) -> tuple[dict[str, dict], list[str]]:
    details, unreadable = {}, []
    for r in rows:
        try:
            details[r["incident"]] = steers_incident(raw / f"steers_{r['incident']}.html")
        except (FileNotFoundError, ValueError) as e:
            unreadable.append(f"{r['incident']}: {type(e).__name__}")
    return details, unreadable


def day_reports(day: str, rows_by_day: dict, incomplete_weeks: list[str], raw: Path = BT) -> tuple:
    """Every STEERS report that started on `day`, and whether that list is complete enough to claim absence."""
    day_rows = rows_by_day.get(day, [])
    covered = searched(day, raw)
    details, unreadable = _details(day_rows, raw)
    complete = (covered and not any(r["search_file"] in incomplete_weeks for r in day_rows) and not unreadable
                and len(details) == len(day_rows))
    return details, complete, unreadable


def earlier_reports(day: str, rows_by_day: dict, incomplete_weeks: list[str], raw: Path = BT) -> tuple:
    """Reports that started before `day` and were still open at or after 6 h before its first hour.

    That is a superset of what can overlap any spike that day; record_check keeps the overlapping ones. Complete
    only if every one of the build.LOOKBACK_DAYS before the day sits in a complete saved week search and every
    such report's detail page is readable (an unreadable one might have been running, so it blocks absence).
    """
    d0 = datetime.strptime(day, "%m/%d/%Y")
    floor = d0 - timedelta(hours=-build.MATCH_WINDOW_H[0])
    rows = [r for rs in rows_by_day.values() for r in rs
            if _stamp(r["began"]) < d0 and (r.get("ended") is None or _stamp(r["ended"]) >= floor)]
    details, unreadable = _details(rows, raw)
    days = [(d0 - timedelta(days=k)).strftime("%Y%m%d") for k in range(1, build.LOOKBACK_DAYS + 1)]
    weeks = _weeks(raw)
    covered = all(any(b <= d <= e and name not in incomplete_weeks for b, e, name in weeks) for d in days)
    complete = covered and not unreadable
    note = (f"Also searched reports that started in the {build.LOOKBACK_DAYS} days before and were still running "
            f"({len(details)} open that day; earlier search {'complete' if complete else 'incomplete'}).")
    return details, complete, note


def _stamp(s: str) -> datetime:
    return datetime.strptime(s, "%m/%d/%Y %I:%M %p")


_WEEKS: dict[Path, list[tuple[str, str, str]]] = {}


def _weeks(raw: Path) -> list[tuple[str, str, str]]:
    """(begin YYYYMMDD, end YYYYMMDD, file name) for every saved week search."""
    if raw not in _WEEKS:
        _WEEKS[raw] = [(*p.stem.split("_")[-2:], p.name) for p in raw.glob("steers_search_*_*_*.html")]
    return _WEEKS[raw]


def searched(day: str, raw: Path = BT) -> bool:
    """True only if a saved week search covers the day: an unsearched day has zero rows, which is not 'none'."""
    d = datetime.strptime(day, "%m/%d/%Y").strftime("%Y%m%d")
    return any(b <= d <= e for b, e, _ in _weeks(raw))


def geo_in_corridor(fac: tuple[float, float], trig: dict, window: list[float]) -> bool:
    """Ground truth from ECHO coordinates, independent of the pipeline's name matching."""
    o = (trig["lat"], trig["lon"])
    b = build.bearing_deg(o, fac)
    return (build.haversine_km(o, fac) <= build.CORRIDOR_RADIUS_KM and bool(window)
            and min(abs((w - b + 180) % 360 - 180) for w in window) <= build.CORRIDOR_HALF_ANGLE)


_TABLES: dict[Path, dict] = {}


def _table(path: Path) -> dict:
    if path not in _TABLES:
        _TABLES[path] = build.hourly_table(path) if path.exists() else {}
    return _TABLES[path]


def scan_monitors(day: str, param: str, sites: dict, raw: Path = BT, full: bool = False) -> list[dict]:
    """Every site's readings for the day; a site with no data or no baseline that day is left out.

    full=True adds what the web app renders (hour flags, peak), for pipeline.nights; detection never reads them."""
    out = []
    for s, (lat, lon) in sites.items():
        table = _table(raw / f"agc_{day[-4:]}_{s}_{param}.html")
        if not table.get(day):
            continue
        try:
            base = build.baseline(table, day)
        except ValueError:
            continue
        vals = table[day]
        m = {"site_id": s, "name": ALL_SITE_NAMES[s], "lat": lat, "lon": lon, "baseline": base,
             "hourly": [{"hour_cst": h, "value": vals[h]} for h in range(24)], "triggered": False}
        if full:
            flags = build.hourly_flags(raw / f"agc_{day[-4:]}_{s}_{param}.html", day)
            m["hourly"] = [{"hour_cst": h, "value": vals[h], "flag": flags[h]} for h in range(24)]
            seen = [h for h in range(24) if vals[h] is not None]
            if not seen:
                continue
            peak = max(seen, key=lambda h: vals[h])
            m["peak"] = {"hour_cst": peak, "value": vals[peak]}
        out.append(m)
    return out


def spike_days(sites: dict, raw: Path = BT, full: bool = False) -> list[tuple[str, str, list[dict], dict]]:
    """Every (day, compound) in 2024-2025 where the unchanged trigger rule fires on any Ship Channel site."""
    out = []
    for year in YEARS:
        d = datetime(int(year), 1, 1)
        while d.year == int(year):
            day = d.strftime("%m/%d/%Y")
            for param in ("45201", "43218"):
                mons = scan_monitors(day, param, sites, raw, full)
                det = build.detect(mons)
                if det:
                    out.append((day, param, mons, det))
            d += timedelta(days=1)
    return out


def traced_spikes(sites: dict, rows_by_day: dict, echo_site: dict, echo_rows: list[dict],
                  incomplete_weeks: list[str], raw: Path = BT, full: bool = False, county: str = "Harris"):
    """Run build.trace on every detected spike; yields the spike with its trace and the day's search state.

    The one loop behind both the backtest's spike scan and pipeline.nights (the replayable night files)."""
    for day, param, mons, det in spike_days(sites, raw, full):
        det_day = datetime.strptime(day, "%m/%d/%Y").date()
        details, complete, _ = day_reports(day, rows_by_day, incomplete_weeks, raw)
        earlier, earlier_ok, note = earlier_reports(day, rows_by_day, incomplete_weeks, raw)
        t = build.trace(mons, load_winds(day[-4:], day, sites, raw), None, echo_site[det["site_id"]], echo_rows,
                        details, complete, det_day, param, earlier, earlier_ok, note, county=county)
        yield {"day": day, "param": param, "det_day": det_day, "monitors": mons, "det": det, "details": details,
               "complete": complete, "earlier": earlier, "earlier_complete": earlier_ok, "trace": t}


def spike_scan(sites: dict, rows_by_day: dict, echo_site: dict, echo_rows: list[dict], incomplete_weeks: list[str],
               candidates: list[dict], raw: Path = BT, county: str = "Harris") -> list[dict]:
    """Run the record check on every detected spike, report or not. Rows carry counts and ids, never names.

    candidates [] (a region with no backtest) leaves candidate_reports_in_corridor 0: no ground truth, not "none"."""
    rows = []
    for sp in traced_spikes(sites, rows_by_day, echo_site, echo_rows, incomplete_weeks, raw, county=county):
        day, param, det, t, complete = sp["day"], sp["param"], sp["det"], sp["trace"], sp["complete"]
        earlier_ok, det_day = sp["earlier_complete"], sp["det_day"]
        row = {"day": day, "param": param, "site_id": det["site_id"], "hour_cst": det["hour_cst"],
               "value": det["value"], "baseline": det["baseline"], "search_complete": complete,
               "earlier_search_complete": earlier_ok, "day_reports": len(rows_by_day.get(day, []))}
        if "record_check" not in t:
            rows.append(row | {"status": "no_wind", "matched_incident": None, "candidate_reports_in_corridor": 0})
            continue
        rc = t["record_check"]
        det_local = build._local(det_day, det["hour_cst"])
        lo = det_local + timedelta(hours=build.MATCH_WINDOW_H[0])
        hi = det_local + timedelta(hours=build.MATCH_WINDOW_H[1])
        # a candidate report counts if it was running in the match window (it may have started on an earlier day)
        running = [c for c in candidates if _stamp(c["began_local"]) <= hi
                   and (c["ended_local"] is None or _stamp(c["ended_local"]) >= lo)]
        in_geo = [c["incident"] for c in running if geo_in_corridor(c["fac_latlon"], t["trig"], t["window"])]
        rows.append(row | {"status": rc["status"], "matched_incident": rc["incident"], "corridor_size":
                           len(t["facilities"]), "calm_mph": t["calm_mph"],
                           "ongoing_reports": len(rc["ongoing_incidents"]),
                           "matched_ongoing": bool(rc["reported"]) and rc["reported"]["match_basis"] != "started near "
                                              "the spike",
                           "candidate_reports_in_corridor": len(in_geo)})
    return rows


def trigger_hours(monitors: list[dict]) -> list[int]:
    """Every CST hour of the day at which any monitor meets the unchanged trigger rule."""
    return sorted({h for m in monitors for h in range(24) if m["hourly"][h]["value"] is not None
                   and m["hourly"][h]["value"] >= max(build.TRIGGER_RATIO * m["baseline"], build.TRIGGER_FLOOR_PPB)})


def start_hour_cst(began_local: str) -> int:
    t = datetime.strptime(began_local, "%m/%d/%Y %I:%M %p")
    return t.hour - build.steers_tz_offset_h(t.date())


def run_candidate(c: dict, sites: dict, rows_by_day: dict, echo_site: dict, echo_rows: list[dict],
                  incomplete_weeks: list[str], raw: Path = BT) -> dict:
    day, year, param = c["day"], c["day"][-4:], c["param"]
    det_day = datetime.strptime(day, "%m/%d/%Y").date()
    near = sorted((s for s in sites if build.haversine_km(c["fac_latlon"], sites[s]) <= CANDIDATE_RADIUS_KM),
                  key=lambda s: build.haversine_km(c["fac_latlon"], sites[s]))
    monitors, dropped = [], []
    for s in near:
        cfg = {"day": day, "year": year, "param": param, "monitors": [(s, SITE_NAMES[s], *sites[s])]}
        try:
            monitors += build.load_monitors(cfg, raw)
        except (FileNotFoundError, KeyError, ValueError) as e:
            dropped.append(f"{s}: {type(e).__name__}: {e}")
    hits, start = trigger_hours(monitors), start_hour_cst(c["began_local"])
    out = {"monitors": [m["site_id"] for m in monitors], "monitors_dropped": dropped, "detected": False,
           "trigger_hours_cst": hits, "start_hour_cst": start,
           "spike_near_start": any(start + NEAR_START_H[0] <= h <= start + NEAR_START_H[1] for h in hits),
           "detection": None, "wind_site": None, "facility_in_corridor": None, "matched": False,
           "matched_other_incident": None, "record_status": None, "search_complete": None, "reason": None}
    if not monitors:
        return out | {"reason": "no monitor data for the day"}
    details, complete, unreadable = day_reports(day, rows_by_day, incomplete_weeks, raw)
    earlier, earlier_ok, note = earlier_reports(day, rows_by_day, incomplete_weeks, raw)
    det = build.detect(monitors)
    if det is None:
        return out | {"reason": "no monitor crossed the trigger rule"}
    out |= {"detected": True, "detection": {k: det[k] for k in ("site_id", "hour_cst", "value", "baseline")},
            "search_complete": complete, "earlier_search_complete": earlier_ok, "unreadable_day_reports": unreadable}
    # the corridor is drawn from ECHO around the triggering monitor (10 mi = 16 km > the 15 km corridor)
    t = build.trace(monitors, load_winds(year, day, sites, raw), None, echo_site[det["site_id"]], echo_rows,
                    details, complete, det_day, param, earlier, earlier_ok, note)
    if "record_check" not in t:
        return out | {"reason": "no wind for the detection hours"}
    if t["calm_mph"] is not None:
        out["calm_mph"] = t["calm_mph"]
    rc = t["record_check"]
    mine = next((d for d in rc["day_incidents"] if d["incident"] == c["incident"]), None)
    out |= {"wind_site": t["wind"]["site_id"], "wind_from_deg": t["window"],
            "corridor_size": len(t["facilities"]), "record_status": rc["status"],
            "facility_in_corridor": mine["in_corridor"] if mine else None,
            "pipeline_resolution": mine["resolution"] if mine else "incident missing from the day's search",
            "matched": rc["incident"] == c["incident"],
            "geo_in_corridor": geo_in_corridor(c["fac_latlon"], t["trig"], t["window"]),
            "matched_other_incident": rc["incident"] if rc["incident"] not in (None, c["incident"]) else None}
    if out["matched"]:
        return out
    if t["calm_mph"] is not None:
        return out | {"reason": "wind too light to trace"}
    if mine is None or mine["in_corridor"] is None:
        return out | {"reason": "pipeline could not locate the reporting facility"}
    if not mine["in_corridor"]:
        return out | {"reason": "reporting facility outside the corridor"}
    return out | {"reason": "in corridor, but report time does not overlap the detection-time window"}


def select_candidates(universe: list[dict], echo_rows: list[dict], sites: dict, raw: Path = BT) -> tuple:
    """The ground-truth set, from self-reports and ECHO only. Returns (candidates, funnel, unlocated)."""
    funnel = {"steers_rows": len(universe), "detail_missing": 0, "not_emissions_event": 0,
              "no_benzene_or_butadiene": 0, "outside_2024_2025": 0, "facility_not_located": 0,
              "beyond_15km": 0, "candidates": 0}
    unlocated, candidates = [], []
    for r in universe:
        p = raw / f"steers_{r['incident']}.html"
        if not p.exists():
            funnel["detail_missing"] += 1
            continue
        meta = event_meta(p)
        if meta["type"] != "EMISSIONS EVENT":
            funnel["not_emissions_event"] += 1
            continue
        lbs = compound_pounds(p)
        if not (lbs["45201"] or lbs["43218"]):
            funnel["no_benzene_or_butadiene"] += 1
            continue
        if r["began"][6:10] not in YEARS:
            funnel["outside_2024_2025"] += 1
            continue
        fac, how = locate(r["entity"], meta["address"], echo_rows)
        if fac is None:
            funnel["facility_not_located"] += 1
            unlocated.append({"incident": r["incident"], "reason": how})
            continue
        ll = (float(fac["FacLat"]), float(fac["FacLong"]))
        dmin = min(build.haversine_km(ll, p2) for p2 in sites.values())
        if dmin > CANDIDATE_RADIUS_KM:
            funnel["beyond_15km"] += 1
            continue
        funnel["candidates"] += 1
        candidates.append({"incident": r["incident"], "entity": r["entity"], "rn": r["rn"], "day": r["began"][:10],
                           "began_local": r["began"], "ended_local": r.get("ended"), "param": "45201" if lbs["45201"] else "43218",
                           "benzene_lbs": lbs["45201"], "butadiene_lbs": lbs["43218"],
                           "fac_registry_id": fac["RegistryID"], "fac_latlon": ll, "located_by": how,
                           "nearest_site_km": round(dmin, 1)})
    return candidates, funnel, unlocated


def run(raw: Path = BT) -> dict:
    sites = {s: site_coords(s, raw) for s in SITE_NAMES}
    universe, incomplete_weeks = load_universe(raw)
    echo_site, echo_rows = load_echo(raw)
    rows_by_day: dict[str, list[dict]] = {}
    for r in universe:
        rows_by_day.setdefault(r["began"][:10], []).append(r)
    candidates, funnel, unlocated = select_candidates(universe, echo_rows, sites, raw)
    results = []
    for c in candidates:
        res = run_candidate(c, sites, rows_by_day, echo_site, echo_rows, incomplete_weeks, raw)
        results.append({k: v for k, v in c.items() if k != "fac_latlon"} | res)
    spikes = spike_scan(sites, rows_by_day, echo_site, echo_rows, incomplete_weeks, candidates, raw)
    det = [r for r in results if r["detected"]]
    said_none = [r for r in spikes if r["status"] == "no_report_after_deadline"]
    spike_summary = {
        "spikes": len(spikes), "spike_days": len({r["day"] for r in spikes}),
        "by_status": _count(r["status"] for r in spikes),
        "false_no_report": sum(1 for r in said_none if r["candidate_reports_in_corridor"]),
        "no_report_found_after_complete_search": sum(1 for r in said_none if not r["candidate_reports_in_corridor"]),
        "abstained_search_incomplete": sum(1 for r in spikes if r["status"] == "search_incomplete"),
        "abstained_calm_wind": sum(1 for r in spikes if r.get("calm_mph") is not None),
        "abstained_earlier_days_unsearched": sum(1 for r in spikes if r["status"] == "search_incomplete"
                                                 and r["search_complete"] and not r["earlier_search_complete"]),
        "matched_an_ongoing_report": sum(1 for r in spikes if r.get("matched_ongoing")),
    }
    summary = {
        "candidates": len(results), "detected": len(det),
        "detected_and_in_corridor": sum(1 for r in det if r["facility_in_corridor"] is True),
        "detected_and_matched": sum(1 for r in det if r["matched"]),
        "matched_on_complete_search": sum(1 for r in det if r["matched"] and r["search_complete"]),
        "not_matched_reasons": _count(r["reason"] for r in results if not r["matched"]),
        "detected_but_other_incident_matched": sum(1 for r in det if r["matched_other_incident"]),
        "detected_said_no_report_after_deadline": sum(1 for r in det
                                                      if r["record_status"] == "no_report_after_deadline"),
        "detected_said_no_report_but_geo_in_corridor": sum(
            1 for r in det if r["record_status"] == "no_report_after_deadline" and r.get("geo_in_corridor")),
        "detected_abstained_search_incomplete": sum(1 for r in det if r["record_status"] == "search_incomplete"),
        "spike_near_start": sum(1 for r in results if r["spike_near_start"]),
        "spike_near_start_and_matched": sum(1 for r in results if r["spike_near_start"] and r["matched"]),
    }
    return {"schema": "plume-witness.backtest/v1", "generated_by": "uv run python -m pipeline.backtest",
            "rules": {"candidate_radius_km": CANDIDATE_RADIUS_KM, "years": list(YEARS),
                      "trigger": f"value >= max({build.TRIGGER_RATIO:g} x {build.BASELINE_DAYS}-day median, "
                                 f"{build.TRIGGER_FLOOR_PPB:g} ppb), earliest hour of the event's start day",
                      "corridor": f"+/-{build.CORRIDOR_HALF_ANGLE} deg of upwind, <= {build.CORRIDOR_RADIUS_KM} km",
                      "match": "record_check picks this incident: in corridor, report [start, end] overlaps -6h..+2h of "
                               "detection (it may have started on an earlier day)",
                      "calm_mph": build.CALM_MPH, "lookback_days": build.LOOKBACK_DAYS},
            "summary": summary, "spike_summary": spike_summary, "funnel": funnel, "incomplete_week_searches": incomplete_weeks,
            "unlocated": unlocated, "events": results, "spikes": spikes}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval; honest for small n, where k/n alone overstates certainty."""
    if n == 0:
        return (0.0, 1.0)
    p, d = k / n, 1 + z * z / n
    c, h = (p + z * z / (2 * n)) / d, z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (round(max(0.0, c - h), 3), round(min(1.0, c + h), 3))


def render_md(res: dict) -> str:
    s, f, sp = res["summary"], res["funnel"], res["spike_summary"]
    n, d, c, m = s["candidates"], s["detected"], s["detected_and_in_corridor"], s["detected_and_matched"]

    def pct(k: int, base: int) -> str:
        lo, hi = wilson(k, base)
        return f"{k} / {base}" + (f" ({100 * k / base:.0f}%; 95% CI {100 * lo:.0f}-{100 * hi:.0f}%)" if base else "")

    reasons = "\n".join(f"| {r} | {k} |" for r, k in s["not_matched_reasons"].items())
    no_wind = [x for x in SITE_NAMES if not any(BT.glob(f"met_*_{x}_61102.html"))]
    by_param = {p: sum(1 for e in res["events"] if e["param"] == p) for p in ("45201", "43218")}
    return f"""# Backtest: does the pipeline find the company's own report?

Generated by `uv run python -m pipeline.backtest` from public data in `data/raw/backtest/` (every file has a URL,
SHA-256 and fetch time in `data/raw/backtest/provenance.json`). Full per-event results: `data/build/backtest.json`.
Do not edit the numbers by hand; rerun the command.

## Headline

Of **{n}** real 2024-2025 emissions events that a company reported to TCEQ (benzene or 1,3-butadiene, Harris
County, facility within {CANDIDATE_RADIUS_KM:g} km of a Ship Channel AutoGC monitor):

| Step | Count | Denominator |
|---|---|---|
| Monitor spike detected on the event's start day | {pct(d, n)} | all candidates |
| ...and the reporting facility inside the upwind corridor | {pct(c, d)} | detected |
| ...and the pipeline matched that exact report | {pct(m, d)} | detected |
| End to end: detected and matched | {pct(m, n)} | all candidates |
| Monitor spike within {NEAR_START_H[0]:+d} h to +{NEAR_START_H[1]} h of the company's reported start | {pct(s["spike_near_start"], n)} | all candidates |

"Detected" above means a trigger hit at any hour of the start day, and the pipeline takes the earliest one, which
is often hours from the release. Requiring the hit near the reported start (CST, daylight saving removed) leaves
{s["spike_near_start"]} of {n}; {s["spike_near_start_and_matched"]} of those {s["spike_near_start"]} matched.
So the day-level count overstates how often a release reached a monitor, and the (b) cross-check below compares
day-level spikes that are mostly not the release itself, so it does not measure a false "no report" rate.

Of the {m} matches, {s["matched_on_complete_search"]} came from a day search the pipeline could call complete.
On {s["detected_but_other_incident_matched"]} detected events the pipeline matched a different report filed that
day instead of the candidate. Compound used: benzene for {by_param["45201"]} events, 1,3-butadiene for
{by_param["43218"]} (events that reported no benzene).

## The three numbers for the slide

| Question | Answer | Denominator |
|---|---|---|
| (a) Matched / missed | {m} matched, {n - m} missed ({n - d} never detected, {d - m} detected but not matched) | {n} reported candidate events ({d} detected) |
| (b) False "no report": the check said *no report after deadline* although a candidate report running in the match window had its facility inside that spike's corridor (ECHO coordinates) | {sp["false_no_report"]} | {sp["spikes"]} detected spikes |
| (c) Real spikes with no matching report in the corridor after a complete search | {sp["no_report_found_after_complete_search"]} | {sp["spikes"]} detected spikes |

(b) cross-check from the candidate side: of the {d} detected candidates, the check said *no report after
deadline* on {s["detected_said_no_report_after_deadline"]}, of which {s["detected_said_no_report_but_geo_in_corridor"]}
had the reporting facility geometrically inside the corridor; it abstained (*search incomplete*) on
{s["detected_abstained_search_incomplete"]}.

The spike scan runs the unchanged trigger on every day of 2024-2025 for both compounds at all
{len(SITE_NAMES)} sites: {sp["spikes"]} (day, compound) spikes on {sp["spike_days"]} distinct days. Status of each
spike's record check: {", ".join(f"{k} {v}" for k, v in sp["by_status"].items())}. The pipeline abstains rather than
claim absence when the day's search or the {build.LOOKBACK_DAYS} days before it are not completely searched, or
the wind is too light to trace ({sp["abstained_search_incomplete"]} spikes; {sp["abstained_calm_wind"]} of them
under {build.CALM_MPH:g} mph, {sp["abstained_earlier_days_unsearched"]} because earlier days were not searched).
{sp["matched_an_ongoing_report"]} spikes matched a report that started on an earlier day and was still running.
"No matching report found" is not a finding about any facility: Texas requires a report only above a reportable
quantity (30 TAC 101.201), other sources (traffic, ships, tank farms, permitted emissions) raise readings, and
the corridor is geometry only. These spikes are counted, never named.

## Why the others did not match (counts only)

| Reason | Events |
|---|---|
{reasons}

Unmatched events are not listed by name here. Every candidate *did* file a report; an unmatched row is a miss by
this pipeline, not a finding about the facility.

## How the candidate set was built

| Step | Rows |
|---|---|
| STEERS rows, Harris County, any type, started 2024-01-01..2025-12-31 (week-by-week searches) | {f["steers_rows"]} |
| listed as a non-emissions event type in the search results (detail page not fetched) | {f["detail_missing"]} |
| not an EMISSIONS EVENT (maintenance, startup, shutdown, opacity) | {f["not_emissions_event"]} |
| no benzene or 1,3-butadiene pounds reported | {f["no_benzene_or_butadiene"]} |
| facility not located in EPA ECHO (no unique match by name, name + street number, or address) | {f["facility_not_located"]} |
| facility more than {CANDIDATE_RADIUS_KM:g} km from every AutoGC site | {f["beyond_15km"]} |
| **candidates** | **{f["candidates"]}** |

Week searches whose page did not list every record: {len(res["incomplete_week_searches"])}.

## Exact rules

- **Sites:** {", ".join(f"{v} ({k})" for k, v in SITE_NAMES.items())}. Coordinates from TCEQ TAMIS.
- **Monitors per event:** the AutoGC sites within {CANDIDATE_RADIUS_KM:g} km of the facility (a farther site's
  corridor can never reach it). A monitor without data or baseline for the day is dropped and recorded.
- **Detection (unchanged pipeline):** {res["rules"]["trigger"]}.
- **Corridor (unchanged pipeline):** {res["rules"]["corridor"]}, from the wind at the triggering monitor in the
  detection hour and the hour before; a monitor with no wind uses the nearest site that has it (recorded per event).
  The TCEQ met form returned no hourly wind for {", ".join(SITE_NAMES[x] for x in no_wind) or "none"}, so they
  always borrow.
  Facilities come from EPA ECHO major sources within 10 mi of the triggering monitor.
- **Match (unchanged pipeline):** {res["rules"]["match"]}. STEERS local time is converted with America/Chicago DST.
- **Day's reports:** every STEERS row that started that day, taken from the week search (same query, wider window),
  plus every row that started earlier and was still open (its Ended column) within 6 h of the day's first hour.
  Absence also needs the {build.LOOKBACK_DAYS} days before covered by complete week searches, so spikes in early
  January 2024 always abstain. A report that started more than {build.LOOKBACK_DAYS} days earlier is still matched
  when it is in the saved searches, but its absence is not guaranteed.
- **Calm wind:** when the wind at the detection hour or the hour before is under {build.CALM_MPH:g} mph, no
  corridor is drawn and the check abstains (*search incomplete*, "wind too light to trace").

## What this does NOT measure

- **False-alarm rate.** (c) counts spikes with no matching report, but nobody knows the true cause of those
  readings, so they cannot be scored as right or wrong; this is not a precision number.
- **Reports below detection.** A release that never reaches a monitor at
  {build.TRIGGER_RATIO:g}x baseline and {build.TRIGGER_FLOOR_PPB:g} ppb counts as "not detected", whether or not
  any monitor could have seen it. {n - d} of the {n} candidates stop here, so this backtest mostly measures
  whether that trigger fires, and says little about the tracing on the events it never saw.
- **Next-day spikes.** Detection looks only at the event's start day (CST hours); a late-night release that
  reached a monitor after midnight counts as missed.
- **Causation.** A match means the timing and geometry are consistent with the report, not that this release
  caused the reading.
- **Facilities outside the candidate set** ({f["facility_not_located"]} unlocated, {f["beyond_15km"]} beyond
  {CANDIDATE_RADIUS_KM:g} km) are not in any denominator.
- AutoGC data are labeled provisional by TCEQ and may change; a rerun on refetched data can differ.
"""


def _count(xs) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


if __name__ == "__main__":
    res = run()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1))
    DOCS.parent.mkdir(parents=True, exist_ok=True)
    DOCS.write_text(render_md(res))
    print(json.dumps(res["funnel"], indent=1))
    print(json.dumps(res["summary"], indent=1))
    print(json.dumps(res["spike_summary"], indent=1))
