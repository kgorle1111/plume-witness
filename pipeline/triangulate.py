"""Two-monitor triangulation: when more than one monitor triggers around the spike hour, intersect their upwind
wedges to see whether the air at all of them could have come from a smaller area. Informational only: it never
changes the record check, the corridor, the facility ranks or the packet.

Rules (each one testable):
  monitors used   = every monitor that meets the unchanged trigger rule (build.detect's) at the detection hour
                    or the hour either side, and has its OWN wind (a wind borrowed from a neighbour is not a
                    second observation) with a direction in the detection hour or the hour before, and not calm.
                    The flagged monitor's wedge is the corridor as drawn, so it counts only when the corridor was
                    drawn from its own wind.
  wedge           = +/-build.CORRIDOR_HALF_ANGLE of each upwind bearing in that two-hour window, out to
                    build.CORRIDOR_RADIUS_KM, the same geometry as build.corridor.
  intersection    = facilities of the drawn corridor (EPA ECHO major sources) that sit inside every other wedge.
                    The corridor is already every major source in the flagged monitor's wedge, so this is exact.
  verdict         = "narrows" when the intersection keeps at most NARROW_MAX_SHARE of the corridor's facilities.
  separation_deg  = the widest bearing difference between the monitors used, as seen from the centroid of the
                    intersection. Below ALIGNED_DEG the monitors see that area along nearly the same line, so any
                    cut comes from their wind readings differing, not from their positions; the block says so.
"""

import statistics

from pipeline import build

ALIGNED_DEG = build.CORRIDOR_HALF_ANGLE  # monitors closer together than one wedge half-width, seen from upwind
# kn: "narrows" needs the intersection at <= 3/4 of the corridor; a count share, not an area, so a corridor of 4
# facilities moves in 25% steps. Switch to wedge-overlap area if small corridors start to matter.
NARROW_MAX_SHARE = 0.75
TRIGGER_SLACK_H = 1

VERDICTS = {
    "narrows": "narrows the area",
    "aligned": "the monitors line up as seen from upwind, so it barely narrows",
    "no_narrowing": "the other wedges cover most of the same facilities, so it barely narrows",
    "no_overlap": "the wedges share no major facility, so the monitors may not have seen the same air",
    "single": "only one monitor triggered",
    "single_wind": "fewer than two triggering monitors had their own wind reading",
    "not_traced": "wind too light at the flagged monitor to draw any wedge",
}

WIND_ONLY_CAVEAT = ("The monitors see this area along nearly the same line, so the cut comes from their wind "
                    "readings pointing in slightly different directions, not from where they stand.")


def _hits(m: dict, h: int) -> int | None:
    """First hour in [h - slack, h + slack] where m meets the unchanged trigger rule, else None."""
    for k in range(max(0, h - TRIGGER_SLACK_H), min(23, h + TRIGGER_SLACK_H) + 1):
        v = m["hourly"][k]["value"]
        if v is not None and v >= max(build.TRIGGER_RATIO * m["baseline"], build.TRIGGER_FLOOR_PPB):
            return k
    return None


def in_wedge(origin: tuple[float, float], p: tuple[float, float], window: list[float]) -> bool:
    if not window or build.haversine_km(origin, p) > build.CORRIDOR_RADIUS_KM:
        return False
    b = build.bearing_deg(origin, p)
    return min(abs((w - b + 180) % 360 - 180) for w in window) <= build.CORRIDOR_HALF_ANGLE


def _angle(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def separation_deg(points: list[tuple[float, float]], monitors: list[tuple[float, float]]) -> float | None:
    """Widest pairwise bearing difference between the monitors, seen from the centroid of `points`."""
    if not points or len(monitors) < 2:
        return None
    c = (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
    bs = [build.bearing_deg(c, m) for m in monitors]
    return round(max(_angle(a, b) for i, a in enumerate(bs) for b in bs[i + 1:]), 1)


def _own_window(wind: dict | None, site: str, h: int) -> tuple[list[float], str | None]:
    """(upwind bearings, reason excluded) from a monitor's own wind in the detection hour and the hour before."""
    if not wind or wind.get("site_id") != site:
        return [], "no wind reading of its own"
    hours = build.wind_pair(wind, h)
    window = [x["from_deg"] for x in hours if x["from_deg"] is not None]
    if not window:
        return [], "no wind direction for the detection hours"
    known = [x["speed_mph"] for x in hours if x["speed_mph"] is not None]
    if known and min(known) < build.CALM_MPH:
        return [], f"wind too light to trace ({min(known):g} mph)"
    return window, None


def triangulate(t: dict, monitors: list[dict]) -> dict:
    """The optional `triangulation` block for one finished build.trace(); reads t, writes nothing back."""
    det, trig, facilities = t["detection"], t["trig"], t.get("facilities") or []
    h, winds = det["hour_cst"], t.get("winds") or {}
    rule = (f"monitors meeting the trigger rule within {TRIGGER_SLACK_H} h of the detection hour; each wedge "
            f"+/-{build.CORRIDOR_HALF_ANGLE:g} deg of its own upwind bearing, <= {build.CORRIDOR_RADIUS_KM:g} km; "
            f"narrows when the intersection keeps <= {NARROW_MAX_SHARE:.0%} of the corridor; aligned below "
            f"{ALIGNED_DEG:g} deg separation")
    used = [{"site_id": trig["site_id"], "name": trig["name"], "lat": trig["lat"], "lon": trig["lon"],
             "role": "flagged", "trigger_hour_cst": h, "wind_site_id": (t.get("wind") or {}).get("site_id"),
             "wind_from_deg": list(t.get("window") or [])}]
    excluded, triggered = [], 1
    flagged_own = (t.get("wind") or {}).get("site_id") == trig["site_id"]
    if not flagged_own:
        excluded.append({"site_id": trig["site_id"], "name": trig["name"], "trigger_hour_cst": h,
                         "reason": "no wind reading of its own (corridor drawn from a neighbour's wind)"})
    for m in monitors:
        if m["site_id"] == trig["site_id"]:
            continue
        hit = _hits(m, h)
        if hit is None:
            continue
        triggered += 1
        window, why = _own_window(winds.get(m["site_id"]), m["site_id"], h)
        if why:
            excluded.append({"site_id": m["site_id"], "name": m["name"], "trigger_hour_cst": hit, "reason": why})
            continue
        used.append({"site_id": m["site_id"], "name": m["name"], "lat": m["lat"], "lon": m["lon"], "role": "also triggered",
                     "trigger_hour_cst": hit, "wind_site_id": m["site_id"], "wind_from_deg": window})
    inter = [f for f in facilities
             if all(in_wedge((u["lat"], u["lon"]), (f["lat"], f["lon"]), u["wind_from_deg"]) for u in used[1:])]
    ids = list(dict.fromkeys(f["id"] for f in inter))
    sep = separation_deg([(f["lat"], f["lon"]) for f in inter], [(u["lat"], u["lon"]) for u in used])
    if t.get("calm_mph") is not None or not t.get("window"):
        verdict = "not_traced"
    elif triggered == 1:
        verdict = "single"
    elif len(used) < 2 or not flagged_own:
        verdict = "single_wind"
    elif not ids:
        verdict = "no_overlap"
    elif len(ids) <= NARROW_MAX_SHARE * len({f["id"] for f in facilities}):
        verdict = "narrows"
    elif sep is not None and sep < ALIGNED_DEG:
        verdict = "aligned"
    else:
        verdict = "no_narrowing"
    multi = verdict not in ("not_traced", "single", "single_wind")
    caveat = (WIND_ONLY_CAVEAT if verdict == "narrows" and sep is not None and sep < ALIGNED_DEG else None)
    return {"rule": rule, "half_width_deg": build.CORRIDOR_HALF_ANGLE, "max_km": build.CORRIDOR_RADIUS_KM,
            "monitors_triggered": triggered, "monitors": used, "excluded": excluded,
            "single_wedge_count": len({f["id"] for f in facilities}),
            "intersection_count": len(ids) if multi else None,
            "intersection_ids": ids if multi else [],
            "separation_deg": sep if multi else None,
            "verdict": verdict, "verdict_text": VERDICTS[verdict], "caveat": caveat}


def wind_files(block: dict, year: str, trace_wind_site: str | None, winds: dict[str, dict] | None = None) -> list[str]:
    """Cached wind files behind the extra wedges (the flagged monitor's wind is already in the provenance); each
    monitor's own source (met form, or AutoGC form) as `winds` loaded it."""
    winds, out = winds or {}, []
    hour0 = block["monitors"][0].get("trigger_hour_cst") == 0
    for u in block["monitors"][1:]:
        if u["site_id"] == trace_wind_site:
            continue
        w = winds.get(u["site_id"]) or {}
        out += build.wind_files(u["site_id"], year, w.get("source", "met"))
        prev = w.get("prev_hour") if hour0 else None
        if prev and prev["date"][:4] != year:  # hour 0 on 1 January reads last year's file for 23:00
            out += build.wind_files(u["site_id"], prev["date"][:4], w.get("source", "met"))
    return out


def stats(evs: list[dict], skipped: int) -> dict:
    """Backtest-scan numbers over every replayable spike night (pipeline.nights) plus the ones it had to skip."""
    tris = [ev["triangulation"] for ev in evs]
    multi = [(ev, tr) for ev, tr in zip(evs, tris) if tr["intersection_count"] is not None]
    shares = [tr["intersection_count"] / tr["single_wedge_count"] for _, tr in multi if tr["single_wedge_count"]]
    matched = [(ev, tr) for ev, tr in multi if ev["record_check"]["matched_facility_id"]]
    verdicts: dict[str, int] = {}
    for tr in tris:
        verdicts[tr["verdict"]] = verdicts.get(tr["verdict"], 0) + 1
    return {
        "spikes": len(evs) + skipped, "nights": len(evs), "skipped_no_wind": skipped,
        "two_plus_triggered": sum(1 for tr in tris if tr["monitors_triggered"] >= 2),
        "two_plus_with_wedges": len(multi), "verdicts": dict(sorted(verdicts.items(), key=lambda kv: -kv[1])),
        "excluded_reasons": _count(e["reason"] for tr in tris for e in tr["excluded"] if tr["monitors_triggered"] >= 2),
        "median_single": statistics.median(tr["single_wedge_count"] for _, tr in multi) if multi else None,
        "median_intersection": statistics.median(tr["intersection_count"] for _, tr in multi) if multi else None,
        "median_share": round(statistics.median(shares), 3) if shares else None,
        "narrows": sum(1 for _, tr in multi if tr["verdict"] == "narrows"),
        "narrows_wind_only": sum(1 for _, tr in multi if tr["verdict"] == "narrows" and tr["caveat"]),
        "separation_below_aligned": sum(1 for _, tr in multi if tr["separation_deg"] is not None
                                        and tr["separation_deg"] < ALIGNED_DEG),
        "matched_spikes": sum(1 for ev in evs if ev["record_check"]["matched_facility_id"]),
        "matched_with_wedges": len(matched),
        "matched_in_intersection": sum(1 for ev, tr in matched
                                       if ev["record_check"]["matched_facility_id"] in tr["intersection_ids"]),
        "with_intersection": sum(1 for _, tr in multi if tr["intersection_count"]),
        "max_monitor_km": round(max((build.haversine_km((a["lat"], a["lon"]), (b["lat"], b["lon"]))
                                     for _, tr in multi for a in tr["monitors"] for b in tr["monitors"]), default=0), 1),
        "rows": [{"id": ev["event_id"], "monitors": [u["site_id"] for u in tr["monitors"]],
                  "single": tr["single_wedge_count"], "intersection": tr["intersection_count"],
                  "separation_deg": tr["separation_deg"], "verdict": tr["verdict"],
                  "record_status": ev["record_check"]["status"],
                  "matched_in_intersection": (ev["record_check"]["matched_facility_id"] in tr["intersection_ids"])
                  if ev["record_check"]["matched_facility_id"] else None} for ev, tr in multi],
    }


def _count(xs) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def render_md(s: dict) -> str:
    from pipeline.backtest import wilson

    def pct(k: int, n: int) -> str:
        lo, hi = wilson(k, n)
        return f"{k} / {n}" + (f" ({100 * k / n:.0f}%; 95% CI {100 * lo:.0f}-{100 * hi:.0f}%)" if n else "")

    rows = "\n".join(
        f"| {r['id']} | {', '.join(r['monitors'])} | {r['single']} | {r['intersection']} | "
        f"{'-' if r['separation_deg'] is None else r['separation_deg']} | {r['verdict']} | {r['record_status']} | "
        f"{'-' if r['matched_in_intersection'] is None else ('yes' if r['matched_in_intersection'] else 'no')} |"
        for r in s["rows"])
    verdicts = ", ".join(f"{k} {v}" for k, v in s["verdicts"].items())
    excluded = ", ".join(f"{k} ({v})" for k, v in s["excluded_reasons"].items()) or "none"
    return f"""# Triangulation: do two triggering monitors narrow where the air came from?

*Generated by `uv run python -m pipeline.triangulate` from the same spike nights as `pipeline.nights`
(`data/raw/backtest/`, cache only). Do not edit numbers by hand; rerun the command.*

Informational only. Triangulation never changes a record-check status, the corridor, the facility list or any
number in `docs/backtest.md`; it adds an optional `triangulation` block to each event.

## Method

- **Monitors used:** every monitor that meets the unchanged trigger rule ({build.TRIGGER_RATIO:g}x the 7-day
  median and {build.TRIGGER_FLOOR_PPB:g} ppb) in the detection hour or within {TRIGGER_SLACK_H} h of it. The flagged
  monitor's wedge is the corridor as drawn. Any other monitor needs its own wind reading (a borrowed wind is not a
  second observation), with a direction in the detection hour or the hour before, and wind of at least
  {build.CALM_MPH:g} mph.
- **Wedge:** +/-{build.CORRIDOR_HALF_ANGLE:g} degrees of each upwind bearing, out to {build.CORRIDOR_RADIUS_KM:g} km
  (the corridor's own geometry).
- **Intersection:** the corridor's EPA ECHO major sources that also sit inside every other monitor's wedge.
- **Verdict:** "narrows" when the intersection keeps at most {NARROW_MAX_SHARE:.0%} of the corridor's facilities.
- **Separation:** the widest bearing difference between the monitors as seen from the centre of the intersection.
  Under {ALIGNED_DEG:g} degrees the monitors see that area along nearly the same line, so any cut comes from their
  wind readings disagreeing, not from where they stand.

## Results over the spike scan

| Question | Answer |
|---|---|
| Spikes in the scan | {s["spikes"]} ({s["skipped_no_wind"]} without wind at the flagged monitor, so no corridor) |
| 2+ monitors met the trigger within {TRIGGER_SLACK_H} h | {pct(s["two_plus_triggered"], s["spikes"])} |
| ...and 2+ of them had a usable wedge (own wind, not calm) | {pct(s["two_plus_with_wedges"], s["spikes"])} |
| Median facilities: corridor vs intersection (those {s["two_plus_with_wedges"]}) | {s["median_single"]} vs {s["median_intersection"]} (median share kept {s["median_share"]}) |
| Verdict "narrows" (intersection <= {NARROW_MAX_SHARE:.0%} of corridor) | {pct(s["narrows"], s["two_plus_with_wedges"])} |
| ...of which the monitors were under {ALIGNED_DEG:g} degrees apart as seen from the intersection | {s["narrows_wind_only"]} of {s["narrows"]} |
| Spikes whose record check matched a report | {s["matched_spikes"]} |
| ...with 2+ usable wedges | {s["matched_with_wedges"]} |
| ...matched facility inside the intersection | {pct(s["matched_in_intersection"], s["matched_with_wedges"])} |

Verdicts over all nights: {verdicts}. Monitors that met the trigger but were left out (on spikes with 2+
triggering): {excluded}.

## Every spike with 2+ usable wedges

| Night | Monitors (flagged first) | Corridor | Intersection | Separation (deg) | Verdict | Record check | Matched facility in intersection |
|---|---|---|---|---|---|---|---|
{rows}

## What this does and does not show

- **n is tiny.** {s["two_plus_with_wedges"]} of {s["spikes"]} spikes had two usable wedges, and
  {s["matched_with_wedges"]} of those had a matched report, so the "matched facility inside the intersection"
  row is an anecdote, not a rate. Its 95% interval says as much.
- **Seen from the intersection, the monitors were nearly in line.** On {s["separation_below_aligned"]} of the
  {s["with_intersection"]} spikes with a non-empty intersection the monitors were under {ALIGNED_DEG:g} degrees apart
  as seen from it, so any narrowing there comes from two wind vanes pointing in slightly different directions,
  which is as consistent with wind-direction noise as with a smaller source area. (Monitors used were at most
  {s["max_monitor_km"]} km apart.)
- **No overlap is not a finding.** When the wedges share no major facility the monitors may have seen different
  air, or the wind may have shifted between them.
- **Geometry only.** Like the corridor, this uses wind direction, not a dispersion model; a facility inside the
  intersection is not named as a source, and one outside it is not cleared.
"""


if __name__ == "__main__":
    import json
    import sys

    from pipeline import nights

    evs, skipped = nights.generate()
    s = stats([ev for ev, _ in evs], len(skipped))
    out = build.ROOT / "docs" / "triangulation.md"
    out.write_text(render_md(s))
    print(json.dumps({k: v for k, v in s.items() if k != "rows"}, indent=1))
    print(f"wrote {out.relative_to(build.ROOT)}")
    sys.exit(0)
