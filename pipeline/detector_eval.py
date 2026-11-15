"""Characterize the spike detector on the backtest's real self-reported releases, against a control.

Questions, all on the candidates `backtest.select_candidates` builds (company-reported benzene / 1,3-butadiene
emissions events, facility within 15 km of a Ship Channel AutoGC site), start day only, CST hours:
  1. Downwind-conditional recall: was some monitor within 15 km downwind of the facility (facility inside the
     +/-22.5 deg upwind wedge of that monitor's wind, build.py geometry) during start-1 h..+6 h, and of those
     releases, how many had a trigger hit near the start? Split by reported pounds of the monitored compound.
  2. Threshold sweep: ratio x floor -> near-start recall, the same rate on control days, and alerts per week
     across all monitors in 2024-2025 (the false-alarm proxy).
  3. Calm share: how many alert-day detections came in wind under 3 mph, where direction means little.
Control: the same facility, monitors, compound and hour window on the days 7, 14 and 21 days before and after the
release (same weekday), kept only inside 2024-2025 and never on any candidate's start day. If releases trigger no
more often than these ordinary days, the trigger cannot tell a release from background at those hours.

Usage: uv run python -m pipeline.detector_eval   (reads data/raw/backtest, writes data/build/detector_eval.json
       and docs/detector.md)
       uv run python -m pipeline.backtest --region <key>   runs this for any region (pipeline.regions), with its
       backtest, into data/build/detector_eval-<key>.json and docs/detector-<key>.md
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

from pipeline import backtest, build, regions

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "build" / "detector_eval.json"
DOCS = ROOT / "docs" / "detector.md"
RATIOS = (3.0, 5.0, 10.0)
FLOORS = (1.0, 3.0, 10.0)
CURRENT = (build.TRIGGER_RATIO, build.TRIGGER_FLOOR_PPB)
CALM_MPH = 3.0
CONTROL_OFFSETS_D = (-21, -14, -7, 7, 14, 21)  # multiples of 7 keep the weekday (traffic, shifts) the same
POUND_BINS = ((0.0, 10.0, "under 10 lb"), (10.0, 100.0, "10-100 lb"), (100.0, 1000.0, "100-1,000 lb"),
              (1000.0, float("inf"), "1,000 lb or more"))


def out_paths(region: regions.Region = regions.HOUSTON) -> tuple[Path, Path]:
    """(json, doc) for a region; Houston keeps its original file names."""
    if region is regions.HOUSTON:
        return OUT, DOCS
    return ROOT / "data" / "build" / f"detector_eval-{region.key}.json", ROOT / "docs" / f"detector-{region.key}.md"


def setting_key(ratio: float, floor: float) -> str:
    return f"{ratio:g}x/{floor:g}ppb"


def hit_hours(monitor: dict, ratio: float, floor: float) -> list[int]:
    """CST hours at which one monitor meets value >= max(ratio x baseline, floor): build.detect's rule, any hour."""
    thr = max(ratio * monitor["baseline"], floor)
    return [h for h in range(24) if monitor["hourly"][h]["value"] is not None and monitor["hourly"][h]["value"] >= thr]


def near_window(start_hour_cst: int) -> list[int]:
    """backtest.NEAR_START_H around the reported start, clipped to the start day (the backtest's limit)."""
    lo, hi = start_hour_cst + backtest.NEAR_START_H[0], start_hour_cst + backtest.NEAR_START_H[1]
    return [h for h in range(24) if lo <= h <= hi]


def downwind_hours(fac: tuple[float, float], site: tuple[float, float], wind_hourly: list[dict]) -> list[int]:
    """Hours the facility sits inside the monitor's upwind wedge (wind-FROM direction, build.CORRIDOR_* limits)."""
    if build.haversine_km(site, fac) > build.CORRIDOR_RADIUS_KM:
        return []
    b = build.bearing_deg(site, fac)
    return [h for h, w in enumerate(wind_hourly) if w["from_deg"] is not None
            and abs((w["from_deg"] - b + 180) % 360 - 180) <= build.CORRIDOR_HALF_ANGLE]


def winds_for(day: str, sites: dict[str, tuple[float, float]], raw: Path = backtest.BT) -> dict[str, dict]:
    """backtest.load_winds for one day (own met wind, else own AutoGC wind, else the nearest site's; cached tables)."""
    return backtest.load_winds(day[-4:], day, sites, raw)


def evaluate_unit(fac: tuple[float, float], day: str, param: str, start_hour_cst: int,
                  sites: dict[str, tuple[float, float]], raw: Path = backtest.BT) -> dict:
    """One (facility, day, hour window): who was downwind, and which settings fire near the start."""
    near = {s: p for s, p in sites.items() if build.haversine_km(fac, p) <= backtest.CANDIDATE_RADIUS_KM}
    mons = backtest.scan_monitors(day, param, near, raw)
    winds = winds_for(day, sites, raw)
    window = set(near_window(start_hour_cst))
    dw = {s: set(downwind_hours(fac, p, winds[s]["hourly"])) if s in winds else set() for s, p in near.items()}
    with_data = {m["site_id"] for m in mons}
    out = {"monitors_near": len(near), "monitors_with_data": len(with_data),
           "downwind": any(dw[s] & window for s in near),
           "downwind_with_data": any(dw[s] & window for s in with_data),
           "near_hit": {}, "downwind_hit": {}}
    for r in RATIOS:
        for f in FLOORS:
            k = setting_key(r, f)
            hits = {m["site_id"]: [h for h in hit_hours(m, r, f) if h in window] for m in mons}
            out["near_hit"][k] = any(hits.values())
            # strict: the hit is at a monitor that was downwind that hour or the hour before (build.trace's window)
            out["downwind_hit"][k] = any(h in dw[s] or h - 1 in dw[s] for s, hs in hits.items() for h in hs)
    return out


def control_days(day: str, exclude: set[str]) -> list[str]:
    d0 = datetime.strptime(day, "%m/%d/%Y")
    days = [(d0 + timedelta(days=k)).strftime("%m/%d/%Y") for k in CONTROL_OFFSETS_D]
    return [d for d in days if d[-4:] in backtest.YEARS and d not in exclude]


def pound_bin(lbs: float) -> str:
    return next(label for lo, hi, label in POUND_BINS if lo <= lbs < hi)


def alert_scan(sites: dict[str, tuple[float, float]], raw: Path = backtest.BT) -> dict:
    """Alerts = (day, compound) pairs where any of the sites fires at any hour: backtest.spike_days' unit."""
    counts = {setting_key(r, f): 0 for r in RATIOS for f in FLOORS}
    days, days_with_data, current = 0, 0, []
    for year in backtest.YEARS:
        d = datetime(int(year), 1, 1)
        while d.year == int(year):
            day, days, any_data = d.strftime("%m/%d/%Y"), days + 1, False
            for param in ("45201", "43218"):
                mons = backtest.scan_monitors(day, param, sites, raw)
                any_data |= bool(mons)
                for r in RATIOS:
                    for f in FLOORS:
                        counts[setting_key(r, f)] += any(hit_hours(m, r, f) for m in mons)
                det = build.detect(mons)  # the current rule, exactly as the product alerts
                if det:
                    current.append({"day": day, "param": param, "site_id": det["site_id"], "hour_cst": det["hour_cst"]})
            days_with_data += any_data
            d += timedelta(days=1)
    return {"days": days, "days_with_data": days_with_data, "alerts": counts, "current_detections": current}


def calm_share(detections: list[dict], sites: dict[str, tuple[float, float]], raw: Path = backtest.BT) -> dict:
    """Wind speed at the detecting monitor (own or borrowed, as the pipeline would use) in the detection hour."""
    calm = known = 0
    for det in detections:
        w = winds_for(det["day"], sites, raw).get(det["site_id"])
        spd = w["hourly"][det["hour_cst"]]["speed_mph"] if w else None
        if spd is None:
            continue
        known += 1
        calm += spd < CALM_MPH
    return {"detections": len(detections), "with_speed": known, "calm": calm, "calm_mph": CALM_MPH}


def summarize(release: list[dict], control: list[dict], alerts: dict) -> dict:
    weeks = alerts["days"] / 7
    sweep = []
    for r in RATIOS:
        for f in FLOORS:
            k = setting_key(r, f)
            dw_rel = [u for u in release if u["downwind_with_data"]]
            dw_ctl = [u for u in control if u["downwind_with_data"]]
            sweep.append({
                "setting": k, "ratio": r, "floor_ppb": f, "current": (r, f) == CURRENT,
                "release_hits": sum(u["near_hit"][k] for u in release), "release_n": len(release),
                "control_hits": sum(u["near_hit"][k] for u in control), "control_n": len(control),
                "release_downwind_hits": sum(u["downwind_hit"][k] for u in dw_rel), "release_downwind_n": len(dw_rel),
                "control_downwind_hits": sum(u["downwind_hit"][k] for u in dw_ctl), "control_downwind_n": len(dw_ctl),
                "alerts": alerts["alerts"][k], "alerts_per_week": round(alerts["alerts"][k] / weeks, 1)})
    cur = setting_key(*CURRENT)
    by_lbs = []
    for _, _, label in POUND_BINS:
        units = [u for u in release if u["lbs_bin"] == label]
        dw = [u for u in units if u["downwind_with_data"]]
        by_lbs.append({"bin": label, "n": len(units), "downwind": sum(u["downwind"] for u in units),
                       "downwind_with_data": len(dw), "near_hit": sum(u["near_hit"][cur] for u in dw),
                       "downwind_hit": sum(u["downwind_hit"][cur] for u in dw)})
    for s in sweep:
        s["separable"] = separable(s["release_hits"], s["release_n"], s["control_hits"], s["control_n"])
    return {"sweep": sweep, "by_pounds": by_lbs, "weeks": round(weeks, 1)}


def separable(k1: int, n1: int, k0: int, n0: int) -> bool:
    """Release rate clearly above control: the 95% Wilson intervals do not overlap (conservative on purpose)."""
    return n1 > 0 and n0 > 0 and backtest.wilson(k1, n1)[0] > backtest.wilson(k0, n0)[1]


def run(raw: Path | None = None, region: regions.Region = regions.HOUSTON) -> dict:
    raw = raw or region.raw
    sites = {s: backtest.site_coords(s, raw) for s in region.sites}
    universe, _ = backtest.load_universe(raw)
    _, echo_rows = backtest.load_echo(raw)
    candidates, funnel, _ = backtest.select_candidates(universe, echo_rows, sites, raw)
    cand_days = {c["day"] for c in candidates}
    release, control = [], []
    for c in candidates:
        start = backtest.start_hour_cst(c["began_local"])
        lbs = c["benzene_lbs"] if c["param"] == "45201" else c["butadiene_lbs"]
        u = evaluate_unit(c["fac_latlon"], c["day"], c["param"], start, sites, raw)
        release.append({"incident": c["incident"], "day": c["day"], "param": c["param"], "start_hour_cst": start,
                        "lbs": lbs, "lbs_bin": pound_bin(lbs)} | u)
        for d in control_days(c["day"], cand_days):
            control.append({"incident": c["incident"], "day": d} | evaluate_unit(c["fac_latlon"], d, c["param"],
                                                                                  start, sites, raw))
    alerts = alert_scan(sites, raw)
    s = summarize(release, control, alerts)
    head = {} if region is regions.HOUSTON else {"region": region.key}
    generated_by = ("uv run python -m pipeline.detector_eval" if region is regions.HOUSTON
                    else backtest.command(region))
    return {"schema": "plume-witness.detector_eval/v1", **head, "generated_by": generated_by,
            "candidates": len(candidates), "funnel_candidates": funnel["candidates"],
            "rules": {"near_start_h": list(backtest.NEAR_START_H), "candidate_radius_km": backtest.CANDIDATE_RADIUS_KM,
                      "wedge": f"+/-{build.CORRIDOR_HALF_ANGLE} deg of the wind-from direction, "
                               f"<= {build.CORRIDOR_RADIUS_KM} km",
                      "control_offsets_days": list(CONTROL_OFFSETS_D), "current": setting_key(*CURRENT),
                      "calm_mph": CALM_MPH},
            "downwind": {"geometry_any_monitor": sum(u["downwind"] for u in release),
                         "with_data": sum(u["downwind_with_data"] for u in release),
                         "control_with_data": sum(u["downwind_with_data"] for u in control),
                         "control_n": len(control)},
            "calm": calm_share(alerts["current_detections"], sites, raw),
            "alert_days": alerts["days"], "alert_days_with_data": alerts["days_with_data"],
            "weeks": s["weeks"], "sweep": s["sweep"], "by_pounds": s["by_pounds"],
            "release_units": release}


def _pct(k: int, n: int) -> str:
    if not n:
        return f"{k} / 0"
    lo, hi = backtest.wilson(k, n)
    return f"{k} / {n} ({100 * k / n:.0f}%; 95% CI {100 * lo:.0f}-{100 * hi:.0f}%)"


def render_md(res: dict, region: regions.Region = regions.HOUSTON) -> str:
    n, dwn, cur = res["candidates"], res["downwind"], res["rules"]["current"]
    site_names, raw = region.sites, region.raw
    raw_rel, json_rel, bt_doc = backtest.rel(raw), backtest.rel(out_paths(region)[0]), backtest.rel(
        backtest.out_paths(region)[1])
    # The geometry sentence is a claim; it is made only when the interval supports it (Houston: 68-86%).
    most = ' "Most releases never reach a state monitor" is not supported by this geometry.' if (
        n and backtest.wilson(dwn["with_data"], n)[0] > 0.5) else ""
    no_met = [site_names[s] for s in site_names if not any(raw.glob(f"met_*_{s}_61102.html"))]
    wind_src = (f"{', '.join(no_met)} have no met-form wind and use their own AutoGC-form resultant\n  wind; a site "
                "with neither on a day uses the nearest site's." if no_met else
                "Every site has met-form wind; a site with none on a day uses the nearest site's.")
    row = next(s for s in res["sweep"] if s["current"])
    gaps = [100 * (s["release_hits"] / s["release_n"] - s["control_hits"] / s["control_n"]) for s in res["sweep"]]
    lo1 = next(s for s in res["sweep"] if s["setting"] == "3x/1ppb")
    any_sep = [s for s in res["sweep"] if s["separable"]]
    calm = res["calm"]
    under10 = next(b for b in res["by_pounds"] if b["bin"] == "under 10 lb")
    sweep_rows = "\n".join(
        f"| {s['ratio']:g}x{' (current)' if s['current'] else ''} | {s['floor_ppb']:g} | {_pct(s['release_hits'], s['release_n'])} | "
        f"{_pct(s['control_hits'], s['control_n'])} | {s['release_downwind_hits']} / {s['release_downwind_n']} | "
        f"{s['control_downwind_hits']} / {s['control_downwind_n']} | {s['alerts']} | {s['alerts_per_week']} |"
        for s in sorted(res["sweep"], key=lambda s: (-s["ratio"], -s["floor_ppb"])))
    lbs_rows = "\n".join(f"| {b['bin']} | {b['n']} | {b['downwind']} | {b['downwind_with_data']} | "
                         f"{b['near_hit']} | {b['downwind_hit']} |" for b in res["by_pounds"])
    if any_sep:
        verdict = (f"At {', '.join(s['setting'] for s in any_sep)} the release-day rate is clearly above the "
                   "control rate (95% intervals do not overlap).")
    else:
        verdict = ("At no setting in the sweep is the release-day rate clearly above the control rate (the 95% "
                   "intervals overlap at every setting), so **hourly monitors at these triggers cannot tell these "
                   "releases apart from ordinary days at the same hours.**")
    return f"""# Detector: what the monitors can and cannot see

Generated by `{res["generated_by"]}` from `{raw_rel}/`; full output in
`{json_rel}`. Do not edit numbers by hand; rerun the command. Denominator: the **{n}**
candidate releases of `{bt_doc}` (as computed on this branch's `pipeline/backtest.py`).
{backtest.small_n_note(n)}
## Sentences a pitch can use (each with its denominator)

1. **Downwind:** in {_pct(dwn["with_data"], n)} of the company-reported releases, a state monitor within 15 km that had data that day was downwind of the facility at some hour from 1 h before to 6 h after the reported start ({dwn["geometry_any_monitor"]} of {n} counting monitors without data that day).{most}
2. **Recall at the current trigger ({cur}):** {_pct(row["release_hits"], n)} releases had a trigger hit near the reported start; of the {row["release_downwind_n"]} with a downwind monitor, {row["release_downwind_hits"]} hit at a monitor that was downwind that hour or the hour before.
3. **Control:** on ordinary days (same monitors, same hours, same weekday, 7/14/21 days either side, no candidate that day), the same trigger hits in {_pct(row["control_hits"], row["control_n"])} of windows. {verdict}
4. **Lowering the trigger:** the most sensitive setting, 3x / 1 ppb, hits {lo1["release_hits"]} of {n} releases and {lo1["control_hits"]} of {lo1["control_n"]} control windows, at {lo1["alerts_per_week"]} alerts a week across the {len(site_names)} monitors (current: {row["alerts_per_week"]} a week). Across all {len(gaps)} settings, the release-day rate minus the control rate runs from {min(gaps):+.0f} to {max(gaps):+.0f} percentage points: a lower trigger fires more often on release days and on ordinary days alike.
5. **Small releases:** {under10["n"]} of {n} releases reported under 10 lb of the monitored compound.
6. **Calm wind:** {_pct(calm["calm"], calm["with_speed"])} current-trigger alerts with a wind speed reading ({calm["detections"]} alerts in all) came in wind under {calm["calm_mph"]:g} mph at the detecting monitor, where the upwind direction is unreliable.

## Threshold sweep

Near-start = a trigger hit at any monitor within 15 km of the facility, {res["rules"]["near_start_h"][0]:+d} h to
+{res["rules"]["near_start_h"][1]} h of the reported start (CST, start day only). "Downwind" columns: only units
where a monitor with data was downwind in that window, and only hits at that monitor in a downwind hour (or the
hour after). Alerts = (day, compound) pairs with a hit at any of the {len(site_names)} monitors, over {res["alert_days"]} days
({res["weeks"]} weeks; {res["alert_days_with_data"]} days had data at some monitor).

| Ratio | Floor (ppb) | Releases with a near-start hit | Control windows with a hit | Downwind releases hit | Downwind control hit | Alerts 2024-25 | Alerts / week |
|---|---|---|---|---|---|---|---|
{sweep_rows}

## Downwind exposure by reported pounds (monitored compound)

Current trigger ({cur}). "Downwind" = geometry, any monitor within 15 km; "with data" = that monitor reported the
compound that day; hit columns count only the "with data" releases.

| Reported pounds | Releases | Downwind | Downwind, with data | Near-start hit | Hit at the downwind monitor |
|---|---|---|---|---|---|
{lbs_rows}

## How to read this

- A control window is the release's own window moved by 7, 14 or 21 days (same weekday), kept only inside
  2024-2025 and never on a day that is any candidate's start day: {row["control_n"]} windows. The comparison asks
  whether a release day looks different from an ordinary day at the same place and hour. It does not prove that a
  hit on a release day came from the release.
- Downwind on control days uses that day's wind, so the control "downwind" columns compare like with like.
- "Separable" means the two 95% Wilson intervals do not overlap, a deliberately conservative test with this few
  events.

## Limits

- **Start day only.** Hours after midnight are not looked at, so a release after ~18:00 CST loses part of its
  window.
- **Reported start times can be off.** The window is anchored on the company's reported start; a late or rounded
  start moves the window.
- **ECHO coordinates.** Facility positions are EPA ECHO points, which can sit hundreds of meters from the
  emission point; the wedge test uses them as given.
- **Wind source.** {wind_src}
- **Geometry, not dispersion.** "Downwind" is the build.py wedge (+/-22.5 deg, 15 km), not a plume model; a
  downwind monitor can still miss a narrow or lofted plume.
- **Alerts per week is a false-alarm proxy, not a false-alarm rate:** nobody knows the true cause of each alert.
- Candidate count depends on `backtest.select_candidates` on this branch; a parser fix that adds candidates
  changes every denominator. AutoGC data are provisional.
"""


def write(res: dict, region: regions.Region = regions.HOUSTON) -> None:
    out, docs = out_paths(region)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1))
    docs.write_text(render_md(res, region))


if __name__ == "__main__":
    res = run()
    write(res)
    print(json.dumps({k: res[k] for k in ("candidates", "downwind", "calm", "weeks")}, indent=1))
    for s in res["sweep"]:
        print(s["setting"], s["release_hits"], s["release_n"], s["control_hits"], s["control_n"],
              s["release_downwind_hits"], s["release_downwind_n"], s["control_downwind_hits"],
              s["control_downwind_n"], s["alerts_per_week"], "sep" if s["separable"] else "")
    print(json.dumps(res["by_pounds"], indent=1))
