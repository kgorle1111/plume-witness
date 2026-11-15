"""Hand audit of a random sample of 'no_report_after_deadline' spikes (see docs/audit-no-report.md).

Draws a seeded, monitor-stratified sample from data/build/backtest.json, rebuilds each night with the unchanged
pipeline code, and gathers the evidence for four checks the pipeline does not make:
  1. every saved STEERS report running within +/-12 h of the spike hour, placed against the corridor at
     +/-22.5 deg and a wider +/-45 deg wedge (15 km);
  2. lumped compound lines (VOC, hydrocarbons, BTEX ...) on those reports;
  3. name vs address placement in ECHO (a report whose name maps somewhere other than its address);
  4. the spike's own data (duration, flags, neighbouring monitors, the other compound).
Verdicts are assigned by hand in VERDICTS after reading that evidence; the script only reproduces the sample and
the evidence. Published rows carry incident ids, never facility or company names.

Usage:
  uv run python -m pipeline.audit_no_report            # print the evidence (local review; may show names)
  uv run python -m pipeline.audit_no_report --write    # write docs/audit-no-report.json (no names)
  uv run python -m pipeline.audit_no_report --region beaumont   # evidence for that region's no-report spikes
"""

import json
import random
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

from pipeline import backtest, build, nights
from pipeline.parse import _text

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "build" / "backtest.json"
OUT = ROOT / "docs" / "audit-no-report.json"
SEED = 20261114
N = 10
MAX_PER_MONITOR = 3
AUDIT_WINDOW_H = 12
WIDE_HALF_ANGLE = 45.0
# Contaminant lines that may contain benzene or 1,3-butadiene without naming them.
# Matched at the end of the contaminant cell, so a "(VOC cap)" in the previous row's authorization column is ignored.
LUMPED_RE = re.compile(r"(?:\bunspeciated |\btotal |\bother )?(?:\bVOCs?|volatile organic compounds?|hydrocarbons?|"
                       r"\bBTEX|benzene/toluene\S*|aromatics?|\bHRVOCs?|\bNMHC|\bNMOC)(?: ?- ?non ?methane)?$",
                       re.IGNORECASE)
CONTAMINANT_RE = re.compile(r"([A-Za-z0-9][^<>]{1,80}?) (\d[\d,]*\.?\d*) POUNDS")


# Spikes that were `no_report_after_deadline` when the sample was drawn and now abstain: their report's name is
# shared by several ECHO sites and the street address does not settle it (finding B, fixed in `build.place_incidents`).
# They stay in the population the seeded shuffle draws from, so the 10 hand-read nights do not change.
DRAWN_BEFORE_NAME_FIX = {"2025-09-22_45201_48_201_0057", "2025-09-22_43218_48_201_0057"}


def sample(spikes: list[dict], seed: int = SEED, n: int = N, cap: int = MAX_PER_MONITOR) -> list[dict]:
    """Seeded shuffle of the no-report spikes (sorted first, so file order cannot change it), then take spikes in
    shuffled order, skipping any whose monitor already has `cap`."""
    pool = sorted((s for s in spikes
                   if s["status"] == "no_report_after_deadline" or spike_id(s) in DRAWN_BEFORE_NAME_FIX),
                  key=lambda s: (datetime.strptime(s["day"], "%m/%d/%Y"), s["param"], s["site_id"]))
    random.Random(seed).shuffle(pool)
    out, per = [], {}
    for s in pool:
        if per.get(s["site_id"], 0) < cap:
            out.append(s)
            per[s["site_id"]] = per.get(s["site_id"], 0) + 1
        if len(out) == n:
            break
    return out


def spike_id(s: dict) -> str:
    d = datetime.strptime(s["day"], "%m/%d/%Y").strftime("%Y-%m-%d")
    return f"{d}_{s['param']}_{s['site_id']}"


def _off(window: list[float], b: float) -> float:
    return min(abs((w - b + 180) % 360 - 180) for w in window)


def _contaminants(path: Path) -> list[tuple[str, float]]:
    t = re.sub(r"\s+", " ", _text(path))
    i = t.find("List of Air Contaminant Compounds")
    j = t.find("Cause of Emission Event")
    body = t[i:j] if i >= 0 else ""
    body = re.sub(r"List of Air Contaminant Compounds - \d+ total Description Est\. Quantity/ Opacity Units "
                  r"Emission Limit Units Authorization", "|", body)
    out = []
    for name, qty in CONTAMINANT_RE.findall(body):
        name = re.split(r"\||Authorization|O\d{4}|\d+ - Emission Point.*", name)[-1].strip()
        out.append((name, float(qty.replace(",", ""))))
    return out


def _place(lat: float, lon: float, origin: tuple[float, float], window: list[float]) -> dict:
    d, b = build.haversine_km(origin, (lat, lon)), build.bearing_deg(origin, (lat, lon))
    off = _off(window, b) if window else None
    return {"distance_km": round(d, 1), "bearing_deg": round(b, 1), "off_wind_deg": None if off is None else round(off),
            "in_22": off is not None and d <= build.CORRIDOR_RADIUS_KM and off <= build.CORRIDOR_HALF_ANGLE,
            "in_45": off is not None and d <= build.CORRIDOR_RADIUS_KM and off <= WIDE_HALF_ANGLE}


def evidence(s: dict, ctx: dict, raw: Path = backtest.BT) -> dict:
    """Rebuild the night with pipeline code and gather the four checks' raw evidence (names included; local only)."""
    day, param, sites = s["day"], s["param"], ctx["sites"]
    det_day = datetime.strptime(day, "%m/%d/%Y").date()
    mons = backtest.scan_monitors(day, param, sites, raw, full=True)
    det = build.detect(mons)
    details, complete, _ = backtest.day_reports(day, ctx["rows_by_day"], ctx["incomplete"], raw)
    earlier, earlier_ok, note = backtest.earlier_reports(day, ctx["rows_by_day"], ctx["incomplete"], raw)
    t = build.trace(mons, backtest.load_winds(day[-4:], day, sites, raw), None, ctx["echo_site"][det["site_id"]],
                    ctx["echo_rows"], details, complete, det_day, param, earlier, earlier_ok, note)
    rebuilt = {"site_id": det["site_id"], "hour_cst": det["hour_cst"], "value": det["value"],
               "status": t["record_check"]["status"]}
    origin, window, h = (t["trig"]["lat"], t["trig"]["lon"]), t["window"], det["hour_cst"]
    det_local = build._local(det_day, h)
    lo, hi = det_local - timedelta(hours=AUDIT_WINDOW_H), det_local + timedelta(hours=AUDIT_WINDOW_H + 1)
    mlo, mhi = det_local + timedelta(hours=build.MATCH_WINDOW_H[0]), det_local + timedelta(hours=build.MATCH_WINDOW_H[1])
    echo_rows = [r for r in ctx["echo_rows"] if r.get("FacLat")]
    by_name_last = {build._norm(r["AIRName"]): r for r in echo_rows}  # what place_incidents uses (last one wins)
    corridor_ids = {f["id"] for f in t["facilities"]}

    reports = []
    for rows in ctx["rows_by_day"].values():
        for r in rows:
            began = backtest._stamp(r["began"])
            path = raw / f"steers_{r['incident']}.html"
            inc = backtest.steers_incident(path) if path.exists() else None
            ended = (datetime.fromisoformat(inc["end_local"]) if inc else
                     backtest._stamp(r["ended"]) if r.get("ended") else began)
            if not (began <= hi and ended >= lo):
                continue
            meta = backtest.event_meta(path) if path.exists() else {"type": None, "address": ""}
            rep = {"incident": r["incident"], "entity": inc["entity"] if inc else r["entity"], "rn": r["rn"], "type": meta["type"],
                   "detail_page": path.exists(), "began_local": r["began"],
                   "ended_local": ended.strftime("%m/%d/%Y %I:%M %p"),
                   "start_minus_spike_h": round((began - det_local).total_seconds() / 3600, 1),
                   "in_match_window": began <= mhi and ended >= mlo,
                   "lbs": inc["lbs_by_param"] if inc else None}
            if path.exists():
                lumped = [(n, q) for n, q in _contaminants(path) if LUMPED_RE.search(n)]
                rep["lumped_lines"] = lumped
            # check 3: where the pipeline puts it (name, last ECHO row wins) vs every ECHO row by name or address
            entity = inc["entity"] if inc else r["entity"]  # the search column truncates long names
            key = build._norm(entity)
            name_rows = {x["RegistryID"]: x for x in echo_rows if build._norm(x["AIRName"]) == key}
            loc, how = backtest.locate(entity, meta["address"], ctx["echo_rows"])
            pipe = by_name_last.get(key)
            rep["pipeline_registry_id"] = pipe["RegistryID"] if pipe else None
            rep["pipeline_place"] = _place(float(pipe["FacLat"]), float(pipe["FacLong"]), origin, window) if pipe else None
            rep["pipeline_in_corridor_list"] = bool(pipe) and pipe["RegistryID"] in corridor_ids
            rep["name_sites"] = len(name_rows)
            rep["name_places"] = {k: _place(float(x["FacLat"]), float(x["FacLong"]), origin, window) | {
                "universe": x.get("AIRUniverse")} for k, x in name_rows.items()}
            rep["address_locate"] = how
            rep["address_place"] = (_place(float(loc["FacLat"]), float(loc["FacLong"]), origin, window)
                                    | {"registry_id": loc["RegistryID"], "universe": loc.get("AIRUniverse")}
                                    if loc else None)
            reports.append(rep)
    reports.sort(key=lambda x: x["start_minus_spike_h"])

    # check 4: the spike's own data
    trig = next(m for m in mons if m["site_id"] == det["site_id"])
    thr = lambda m: max(build.TRIGGER_RATIO * m["baseline"], build.TRIGGER_FLOOR_PPB)
    around = [{"hour": k, "value": trig["hourly"][k]["value"], "flag": trig["hourly"][k]["flag"]}
              for k in range(max(0, h - 3), min(24, h + 4))]
    nxt = (det_day + timedelta(days=1)).strftime("%m/%d/%Y")
    tpath = raw / f"agc_{day[-4:]}_{trig['site_id']}_{param}.html"
    if h >= 21 and nxt[-4:] == day[-4:]:  # a late spike's tail runs past midnight
        vals, flags = build.hourly_table(tpath).get(nxt), build.hourly_flags(tpath, nxt)
        around += [{"hour": 24 + k, "value": vals[k], "flag": flags[k]} for k in range(h - 20)]
    prev_flag = trig["hourly"][h - 1]["flag"] if h else build.hourly_flags(
        tpath, (det_day - timedelta(days=1)).strftime("%m/%d/%Y"))[23]
    hours_over = [k for k in range(24) if trig["hourly"][k]["value"] is not None
                  and trig["hourly"][k]["value"] >= thr(trig)]
    neighbours = sorted(({"site_id": m["site_id"], "km": round(build.haversine_km(origin, (m["lat"], m["lon"])), 1),
                          "value_at_h": m["hourly"][h]["value"], "baseline": m["baseline"],
                          "max_h-1..h+2": max((m["hourly"][k]["value"] for k in range(max(0, h - 1), min(24, h + 3))
                                               if m["hourly"][k]["value"] is not None), default=None)}
                         for m in mons if m["site_id"] != trig["site_id"]), key=lambda x: x["km"])
    other = "43218" if param == "45201" else "45201"
    omons = backtest.scan_monitors(day, other, sites, raw)
    o = next((m for m in omons if m["site_id"] == trig["site_id"]), None)
    other_c = None if o is None else {"param": other, "baseline": o["baseline"],
                                      "values_h-1..h+1": [o["hourly"][k]["value"] for k in range(max(0, h - 1),
                                                                                                    min(24, h + 2))]}
    wind = t["wind"]["hourly"]
    return {"id": spike_id(s), "row": s, "rebuilt": rebuilt, "wind_site": t["wind"]["site_id"],
            "window_deg": window, "speed_mph": [wind[max(0, h - 1)]["speed_mph"], wind[h]["speed_mph"]],
            "corridor_size": len(t["facilities"]), "reports": reports,
            "corridor_counties": sorted({(f2.get("AIRCounty") or "?").title() for f2 in ctx["echo_site"][det["site_id"]]
                                         ["Results"]["Facilities"] if f2.get("RegistryID") in corridor_ids}),
            "spike": {"around": around, "previous_hour_flag": prev_flag, "hours_over_trigger": hours_over, "threshold": thr(trig),
                      "neighbours": neighbours, "other_compound": other_c}}


# Hand verdicts, written after reading the evidence printed by this script and the cached pages it points to.
# rule: which check decided it. evidence: facts only, never a facility or company name; incident ids only on
# "likely missed" rows (none in this sample).
GAP, MISSED, DOUBTFUL, CANT = "gap stands", "likely missed by us", "spike doubtful", "can't tell"
VERDICTS: dict[str, dict] = {
    "2024-03-29_45201_48_201_0057": {
        "verdict": GAP, "rule": "check 1 (no report within +/-12 h); check 4 (spike looks real)",
        "evidence": "No Harris County STEERS report of any type was running within +/-12 h. Two hours over the "
                    "trigger (15.84, then 12.09 ppb after midnight) with 1,3-butadiene up at the same hour "
                    "(4.37 ppb vs 0.04 baseline); no flag next to the spike."},
    "2025-10-17_43218_48_201_0069": {
        "verdict": GAP, "rule": "check 1 (only report far off the wind); check 4 (three hours over trigger)",
        "evidence": "One report running within +/-12 h: a maintenance activity 23.9 km away, 100 deg off the "
                    "wind, listing neither compound. Spike holds for three hours (10.02, 14.84, 12.06 ppb)."},
    "2024-09-25_45201_48_201_1015": {
        "verdict": CANT, "rule": "check 4 (spike starts on the first valid hour after a calibration check)",
        "evidence": "No report within +/-12 h, so no report was missed. But the spike starts on the first valid "
                    "hour after the analyzer's span (ST) and blank (BL) hours, and at this site in 2024 hours "
                    "right after a flagged hour read >= 10 ppb 2.8% of the time (10/351) vs 0.6% (30/5097) "
                    "otherwise. A second hour is also over (11.05 ppb), which argues for a real reading. "
                    "Would decide it: TCEQ's final validated AutoGC data (these are provisional) or the "
                    "site's span-check log for that night."},
    "2025-11-18_43218_48_201_0307": {
        "verdict": GAP, "rule": "check 1 (no report within +/-12 h); check 4 (spike looks real)",
        "evidence": "No report of any type running within +/-12 h. Two hours over (10.08, 38.65 ppb); the "
                    "monitor 1.6 km away also rose (2.44 ppb vs 0.0 baseline) within the hour."},
    "2025-03-25_43218_48_201_0069": {
        "verdict": GAP, "rule": "check 1 (report outside even the 45 deg wedge); check 3 (placement differs, "
                                "same outcome)",
        "evidence": "One report within +/-12 h, starting 1.2 h after the spike hour; it lists benzene and "
                    "unspeciated VOCs, no 1,3-butadiene. By its street address it sits 5.9 km away, 63 deg off "
                    "the wind; the pipeline's name match put it at a same-name site 9.5 km away, 49 deg off. "
                    "Outside the 45 deg wedge either way. Single hour over (13.96 ppb) after hours of 2-5 ppb."},
    "2025-09-11_45201_48_201_0057": {
        "verdict": GAP, "rule": "check 1 and 2 (lumped-VOC report outside the 45 deg wedge, started after the spike)",
        "evidence": "Two reports within +/-12 h. One is 20.1 km away, 118 deg off the wind, neither compound. "
                    "The other lists only lumped VOC (563 lb), sits 14.4 km away 63 deg off the wind, and started "
                    "0.9 h after the spike hour, while air at 3.6 mph needs ~2.5 h to cover 14.4 km. Wind is "
                    "borrowed from Milby Park (no wind at this site). Spike: two hours over, 1,3-butadiene up too."},
    "2025-06-12_43218_48_201_0026": {
        "verdict": GAP, "rule": "check 1 (no report within +/-12 h); check 4 (spike looks real)",
        "evidence": "No report of any type running within +/-12 h. Rising over three hours (9.97, 14.40, then "
                    "7.14 ppb after midnight); no flag next to the spike."},
    "2024-04-15_43218_48_201_0069": {
        "verdict": GAP, "rule": "check 1 and 2 (lumped-VOC report outside the 45 deg wedge in every nearby hour)",
        "evidence": "One report within +/-12 h, running for 26 days, listing C4 hydrocarbons and a lumped "
                    "'VOC - nonmethane' line but no 1,3-butadiene; 8.8 km away at bearing 79 deg, 54 deg off the "
                    "detection-hour wind. The wind at this monitor from 19:00 to 02:00 CST came from 133-210 deg, "
                    "never near 79 deg. Spike barely over the trigger (10.78 ppb) for one hour, 3.03 ppb next."},
    "2025-09-19_45201_48_201_0057": {
        "verdict": CANT, "rule": "check 1 (report inside the 45 deg wedge, not the 22.5 deg corridor)",
        "evidence": "A flaring report was running at the spike hour, 11.3 km away and 38 deg off the wind: "
                    "inside the wider 45 deg wedge, outside the pipeline's 22.5 deg corridor. It lists sulfur "
                    "dioxide, CO, H2S and light hydrocarbons, no benzene and no lumped VOC line. The wind is "
                    "borrowed from Milby Park 3.8 km away (no wind at this site) and turned from 142 to 181 deg "
                    "over the next hour. Would decide it: wind measured at Galena Park, or a speciated flare "
                    "analysis for that event."},
    "2025-10-31_45201_48_201_1614": {
        "verdict": GAP, "rule": "check 1 (reports far off the wind)",
        "evidence": "Two reports running within +/-12 h: one 18.5 km away (maintenance, neither compound), one "
                    "9.3 km away 119 deg off the wind (2.5 lb benzene, running for 10 days). Neither inside the "
                    "45 deg wedge. Wind borrowed from Lynchburg Ferry. Benzene 5-10 ppb for four hours before "
                    "the trigger hour."},
}


def published_row(ev: dict) -> dict:
    s, v = ev["row"], VERDICTS.get(ev["id"], {})
    return {"id": ev["id"], "date": s["day"], "monitor": s["site_id"], "monitor_name": backtest.SITE_NAMES[s["site_id"]],
            "compound": build.COMPOUNDS[s["param"]][0], "hour_cst": s["hour_cst"], "value_ppb": s["value"],
            "baseline_ppb": s["baseline"], "reproduced": ev["rebuilt"]["status"] == s["status"],
            "reports_within_12h": len(ev["reports"]),
            "verdict": v.get("verdict", "unreviewed"), "rule": v.get("rule", ""), "evidence": v.get("evidence", ""),
            "incidents": v.get("incidents", [])}


def sweep(evs: list[dict]) -> dict:
    """Checks 1 and 3 run automatically over every no-report spike (no hand reading; counts only)."""
    win = [e for e in evs if any(r["in_match_window"] for r in e["reports"])]
    return {
        "spikes": len(evs),
        "reproduced": sum(1 for e in evs if e["rebuilt"]["status"] == "no_report_after_deadline"),
        "with_any_report_within_12h": sum(1 for e in evs if e["reports"]),
        "report_within_12h_inside_22_5_deg": sum(1 for e in evs if any(
            (r["address_place"] or r["pipeline_place"] or {}).get("in_22") for r in e["reports"])),
        "report_within_12h_inside_45_deg": sum(1 for e in evs if any(
            (r["address_place"] or r["pipeline_place"] or {}).get("in_45") for r in e["reports"])),
        "report_in_match_window_inside_45_deg": sum(1 for e in win if any(
            r["in_match_window"] and (r["address_place"] or r["pipeline_place"] or {}).get("in_45")
            for r in e["reports"])),
        "report_in_match_window_inside_45_deg_listing_spike_compound": sum(1 for e in win if any(
            r["in_match_window"] and (r["address_place"] or r["pipeline_place"] or {}).get("in_45")
            and (r["lbs"] or {}).get(e["row"]["param"], 0) > 0 for r in e["reports"])),
        "report_inside_45_deg_with_lumped_voc_only": sum(1 for e in evs if any(
            (r["address_place"] or r["pipeline_place"] or {}).get("in_45") and r.get("lumped_lines")
            and not any((r["lbs"] or {}).values()) for r in e["reports"])),
        "report_name_shared_by_several_echo_sites": sum(1 for e in evs if any(
            r["name_sites"] > 1 for r in e["reports"] if r["in_match_window"])),
        "report_placed_elsewhere_than_its_address": sum(1 for e in evs if any(
            r["in_match_window"] and r["address_place"] and r["pipeline_registry_id"]
            and r["pipeline_registry_id"] != r["address_place"]["registry_id"] for r in e["reports"])),
        "trigger_hour_right_after_flagged_hour": sum(1 for e in evs if e["spike"]["previous_hour_flag"]),
        "single_hour_over_trigger": sum(1 for e in evs if len(e["spike"]["hours_over_trigger"]) == 1),
        "wind_borrowed_from_another_site": sum(1 for e in evs if e["wind_site"] != e["row"]["site_id"]),
    }


def region_evidence(key: str) -> list[dict]:
    """The same four checks for every no-report spike of another region (evidence only: verdicts are written by hand)."""
    from pipeline import regions
    reg = regions.get(key)
    ctx = nights.load_context(reg.raw, reg.sites)
    rows = json.loads(reg.spikes_out.read_text())["rows"]
    return [evidence({"day": datetime.fromisoformat(r["date"]).strftime("%m/%d/%Y"), "param": r["param"],
                      "site_id": r["site_id"]}, ctx, reg.raw)
            for r in rows if r["status"] == "no_report_after_deadline"]


def main() -> None:
    if sys.argv[1:2] == ["--region"]:
        print(json.dumps(region_evidence(sys.argv[2]), indent=1, default=str))
        return
    bt = json.loads(SRC.read_text())
    ctx = nights.load_context()
    picked = sample(bt["spikes"])
    evs = [evidence(s, ctx) for s in picked]
    if "--write" in sys.argv:
        rows = [published_row(e) for e in evs]
        counts = {v: sum(1 for r in rows if r["verdict"] == v) for v in (GAP, MISSED, DOUBTFUL, CANT)}
        k = counts[MISSED] + counts[DOUBTFUL]
        everyone = [evidence(s, ctx) for s in bt["spikes"] if s["status"] == "no_report_after_deadline"]
        OUT.write_text(json.dumps({"schema": "plume-witness.audit-no-report/v1", "seed": SEED, "n": N,
                                   "max_per_monitor": MAX_PER_MONITOR, "population": len(everyone),
                                   "generated_by": "uv run python -m pipeline.audit_no_report --write",
                                   "counts": counts,
                                   "missed_or_doubtful": {"k": k, "n": len(rows),
                                                          "wilson_95": backtest.wilson(k, len(rows))},
                                   "if_every_cant_tell_were_an_error": {
                                       "k": k + counts[CANT], "n": len(rows),
                                       "wilson_95": backtest.wilson(k + counts[CANT], len(rows))},
                                   "population_sweep": (sw := sweep(everyone)),
                                   "wide_wedge_compound_reports_wilson_95": backtest.wilson(
                                       sw["report_in_match_window_inside_45_deg_listing_spike_compound"], len(everyone)),
                                   "rows": rows}, indent=1) + "\n")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(rows)} rows)")
    else:
        print(json.dumps(evs, indent=1, default=str))


if __name__ == "__main__":
    main()
