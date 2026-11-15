"""Build event.json for one real night: detect the spike, rank facilities upwind, check the self-report.

Usage: uv run python -m pipeline.build            (writes data/build/event.real.json)
       uv run python -m pipeline.build --publish  (also copies it to web/public/event.json)
"""

import json
import math
import shutil
import statistics
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline.contract import SCHEMA, validate
from pipeline.parse import hourly_flags, hourly_table, steers_incident, steers_search

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "build"

# One demo event; build() takes any config of this shape. Monitor coordinates are TCEQ TAMIS site records.
EVENT = {
    "day": "06/21/2024", "year": "2024", "incident": "425347", "echo": "echo_milby_8mi.json", "param": "45201",
    "monitors": [
        ("48_201_0069", "Houston Milby Park", 29.7062725, -95.2611331),
        ("48_201_0307", "Manchester East Ave N", 29.7193939, -95.2594661),
        ("48_201_0057", "Galena Park", 29.7342641, -95.2384748),
        ("48_201_1614", "HRM-16 Deer Park", 29.7084870, -95.1141180),
    ],
    "wind_site": "48_201_0069",
}
BASELINE_DAYS = 7
TRIGGER_RATIO, TRIGGER_FLOOR_PPB = 10.0, 10.0
CORRIDOR_RADIUS_KM = 15.0
CORRIDOR_HALF_ANGLE = 22.5  # degrees either side of upwind; one monitor's wind can't resolve finer than this
COMPOUNDS = {"45201": ("benzene", "benceno"), "43218": ("1,3-butadiene", "1,3-butadieno")}
LOCAL_TZ = ZoneInfo("America/Chicago")


def steers_tz_offset_h(day: date) -> int:
    """STEERS times are local (CST or CDT); monitor hours are always CST. CDT = CST + 1h."""
    return 1 if datetime(day.year, day.month, day.day, 12, tzinfo=LOCAL_TZ).dst() else 0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def bearing_deg(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def alignment(wind_from: list[float | None], bearing: float) -> float:
    """Mean of max(0, cos(angle between wind-from and facility bearing)); 1 = dead upwind."""
    vals = [max(0.0, math.cos(math.radians(w - bearing))) for w in wind_from if w is not None]
    return round(sum(vals) / len(vals), 3) if vals else 0.0


def baseline(table: dict[str, list[float | None]], day: str) -> float:
    d0 = datetime.strptime(day, "%m/%d/%Y").date()
    vals = [v for k in range(1, BASELINE_DAYS + 1)
            for v in table.get((d0 - timedelta(days=k)).strftime("%m/%d/%Y"), []) if v is not None]
    if not vals:
        raise ValueError(f"no baseline data in the {BASELINE_DAYS} days before {day}")
    return round(statistics.median(vals), 3)


def detect(monitors: list[dict]) -> dict | None:
    """Earliest hour where any monitor reaches max(ratio x baseline, floor); ties go to the higher value."""
    for h in range(24):
        hits = [(m["hourly"][h]["value"], m) for m in monitors
                if m["hourly"][h]["value"] is not None
                and m["hourly"][h]["value"] >= max(TRIGGER_RATIO * m["baseline"], TRIGGER_FLOOR_PPB)]
        if hits:
            value, m = max(hits, key=lambda x: x[0])
            return {"site_id": m["site_id"], "hour_cst": h, "value": value, "baseline": m["baseline"],
                    "rule": f"value >= max({TRIGGER_RATIO:g} x 7-day median baseline, {TRIGGER_FLOOR_PPB:g} ppb)"}
    return None


def corridor(echo: dict, origin: tuple[float, float], wind_from: list[float | None]) -> list[dict]:
    """Major sources inside the upwind corridor, nearest first. Geometry only: no facility is singled out."""
    winds = [w for w in wind_from if w is not None]
    out = []
    for f in echo["Results"]["Facilities"]:
        if f.get("AIRUniverse") != "Major Emissions" or not f.get("FacLat"):
            continue
        p = (float(f["FacLat"]), float(f["FacLong"]))
        d, b = haversine_km(origin, p), bearing_deg(origin, p)
        off = min(abs((w - b + 180) % 360 - 180) for w in winds)
        if d > CORRIDOR_RADIUS_KM or off > CORRIDOR_HALF_ANGLE:
            continue
        out.append({"id": f.get("RegistryID") or f["AIRName"], "name": f["AIRName"].title(), "lat": p[0], "lon": p[1],
                    "distance_km": round(d, 1), "bearing_deg": round(b, 1), "alignment": alignment(wind_from, b),
                    "in_corridor": True, "source": "EPA ECHO (major emissions source)",
                    "coord_precision": "as published by ECHO"})
    out.sort(key=lambda r: r["distance_km"])
    seen: set[str] = set()
    out = [r for r in out if not (r["id"] in seen or seen.add(r["id"]))]  # ECHO can list one site twice
    for i, r in enumerate(out, 1):
        r["rank"] = i
    return out


def _norm(name: str) -> str:
    return " ".join(name.lower().replace(",", " ").split())


def place_incidents(incidents: list[dict], facilities: list[dict], echo_rows: list[dict],
                    origin: tuple[float, float], winds: list[float]) -> list[dict]:
    """Put every self-report of the day on the map and say whether it falls in the upwind corridor.

    Facilities are matched by exact normalized name; an incident that can't be located stays 'unresolved',
    and an unresolved incident blocks any absence claim.
    """
    in_corr = {_norm(f["name"]): f for f in facilities}
    located = {_norm(r["AIRName"]): r for r in echo_rows if r.get("FacLat")}
    out = []
    for inc in incidents:
        key = _norm(inc["entity"])
        row = {"incident": inc["incident"], "entity": inc["entity"].title(), "rn": inc["rn"],
               "start_local": inc["start_local"], "compound": inc["compound"], "pounds": inc["pounds"]}
        if key in in_corr:
            f = in_corr[key]
            row |= {"facility_id": f["id"], "distance_km": f["distance_km"], "bearing_deg": f["bearing_deg"],
                    "in_corridor": True, "resolution": "in the upwind corridor"}
        elif key in located:
            p = (float(located[key]["FacLat"]), float(located[key]["FacLong"]))
            d, b = haversine_km(origin, p), bearing_deg(origin, p)
            off = min(abs((w - b + 180) % 360 - 180) for w in winds)
            row |= {"facility_id": located[key].get("RegistryID"), "distance_km": round(d, 1),
                    "bearing_deg": round(b, 1), "in_corridor": False,
                    "resolution": f"outside the corridor ({d:.1f} km, {off:.0f}° off the wind)"}
        else:
            row |= {"facility_id": None, "distance_km": None, "bearing_deg": None, "in_corridor": None,
                    "resolution": "unresolved: facility not located"}
        out.append(row)
    return out


FINAL_DEADLINE_DAYS = 14  # 30 TAC 101.201(b): final record within two weeks after the event ends


def final_check(inc: dict) -> tuple[str, str]:
    """T+14d from the report's own fields: a FINAL report dated within 14 days of the event's end."""
    if inc.get("report_type") != "FINAL" or not inc.get("report_date"):
        return "not_yet_reported", f"report type {inc.get('report_type') or 'not stated'}; no final report date"
    days = (date.fromisoformat(inc["report_date"]) - datetime.fromisoformat(inc["end_local"]).date()).days
    status = "reported" if days <= FINAL_DEADLINE_DAYS else "not_yet_reported"
    return status, f"final report dated {inc['report_date']}, {days} days after the event ended"


def record_check(placed: list[dict], details: dict[str, dict], det_day: date, det_hour_cst: int,
                 search_complete: bool, param: str) -> dict:
    """Did ANY facility in the corridor file a matching emissions-event report? Checked at T+24h and T+14d.

    Absence ('no report after deadline') needs a complete search AND every incident of the day located.
    Otherwise the status is search_incomplete; a named facility is never called unreported on partial data.
    """
    det_local = datetime.combine(det_day, datetime.min.time()) + timedelta(
        hours=det_hour_cst + steers_tz_offset_h(det_day))
    lo, hi = det_local - timedelta(hours=6), det_local + timedelta(hours=2)
    in_time = [p for p in placed if p["in_corridor"] and lo <= datetime.fromisoformat(p["start_local"]) <= hi]
    # A report only matches if it lists the compound the monitor saw; otherwise it is reported_mismatch.
    hits = [p for p in in_time if details[p["incident"]].get("lbs_by_param", {}).get(param, 0) > 0]
    mismatch = not hits and bool(in_time)
    hits = hits or in_time
    scope = (f"Searched every STEERS emissions event starting {det_day.strftime('%m/%d/%Y')} in Harris County "
             f"({len(placed)} found; search {'complete' if search_complete else 'incomplete'}).")
    if hits:
        p = min(hits, key=lambda x: abs(datetime.fromisoformat(x["start_local"]) - det_local))
        inc = details[p["incident"]]
        t24 = "reported" if datetime.fromisoformat(inc["notified_local"]) <= det_local + timedelta(hours=24) \
            else "not_yet_reported"
        t14, t14_note = final_check(inc)
        status = "reported_mismatch" if mismatch else t14
        return {
            "status": status, "incident": inc["incident"], "matched_facility_id": p["facility_id"],
            "source_url": STEERS_URL.format(inc["incident"]),
            "checks": [{"at": "T+24h", "status": t24, "note": f"initial notice filed {inc['notified_local']} local"},
                       {"at": "T+14d", "status": t14, "note": t14_note}],
            "compound_match": not mismatch,
            "reported": {"facility": p["entity"], "compound": inc["compound"], "pounds": inc["pounds"],
                         "start_local": inc["start_local"], "end_local": inc["end_local"],
                         "tz": f"local ({'CDT' if steers_tz_offset_h(det_day) else 'CST'})",
                         "cause": inc["cause"]},
            "day_incidents": placed, "search_scope": scope,
        }
    can_claim_absence = search_complete and all(p["in_corridor"] is not None for p in placed)
    none = "no_report_after_deadline" if can_claim_absence else "search_incomplete"
    return {"status": none, "incident": None, "matched_facility_id": None, "source_url": STEERS_SEARCH,
            "checks": [{"at": "T+24h", "status": none, "note": ""}, {"at": "T+14d", "status": none, "note": ""}],
            "reported": None, "day_incidents": placed, "search_scope": scope}


def template_packet(det: dict, monitors: list[dict], wind: dict, facilities: list[dict], rc: dict,
                    day: str = EVENT["day"], param: str = EVENT["param"]) -> dict:
    """Deterministic EN/ES draft built only from event fields (Gemini drafting is a later, guarded stretch)."""
    name_en, name_es = COMPOUNDS[param]
    trig = next(m for m in monitors if m["site_id"] == det["site_id"])
    others = [m for m in monitors if m["triggered"] and m["site_id"] != det["site_id"]]
    w = wind["hourly"][det["hour_cst"]]
    h12 = f"{(det['hour_cst'] % 12) or 12}:00 {'a.m.' if det['hour_cst'] < 12 else 'p.m.'}"
    also_en = "".join(f" {m['name']} recorded {m['hourly'][det['hour_cst']]['value']} ppb in the same hour." for m in others)
    also_es = "".join(f" {m['name']} registró {m['hourly'][det['hour_cst']]['value']} ppb en la misma hora." for m in others)
    n = len(facilities)
    if rc["status"] == "reported_mismatch":
        r = rc["reported"]
        rec_en = (f" One of them, {r['facility']}, filed report {rc['incident']} for a release starting near that hour, "
                  f"but the report does not list {name_en}, so it does not match this reading.")
        rec_es = (f" Una de ellas, {r['facility']}, presentó el informe {rc['incident']} por una emisión que empezó "
                  f"cerca de esa hora, pero el informe no incluye {name_es}, así que no corresponde a esta lectura.")
        ask_en = f" Requested follow-up: confirm what caused this {name_en} reading."
        ask_es = f" Seguimiento solicitado: confirmar qué causó esta lectura de {name_es}."
    elif rc["matched_facility_id"]:
        r = rc["reported"]
        rec_en = (f" One of them, {r['facility']}, filed emissions-event report {rc['incident']} for {r['pounds']:,.0f} "
                  f"pounds of {r['compound'].lower()} from {r['start_local'][11:]} to {r['end_local'][11:]} local time "
                  f"that day. These readings are consistent with that release reaching the monitors.")
        rec_es = (f" Una de ellas, {r['facility']}, presentó el informe de evento de emisiones {rc['incident']} por "
                  f"{r['pounds']:,.0f} libras de {name_es} de {r['start_local'][11:]} a {r['end_local'][11:]}, hora local, "
                  f"ese día. Estas lecturas son consistentes con que esa emisión llegó a los monitores.")
        ask_en = (" Requested follow-up: confirm whether nearby residents were notified, and whether the reported "
                  "amount accounts for these readings.")
        ask_es = (" Seguimiento solicitado: confirmar si se avisó a los residentes cercanos y si la cantidad reportada "
                  "explica estas lecturas.")
    else:
        rec_en = " No matching report was found in the records checked; the search is incomplete."
        rec_es = " No se encontró un informe correspondiente en los registros revisados; la búsqueda está incompleta."
        ask_en = " Requested follow-up: confirm whether any facility in this corridor reported a release that hour."
        ask_es = (" Seguimiento solicitado: confirmar si alguna instalación en este corredor reportó una emisión "
                  "a esa hora.")
    en = (f"On {det_day_str(day)}, the Texas state monitor at {trig['name']} recorded {det['value']} ppb of "
          f"{name_en} in the {h12} CST hour, against a 7-day median of {det['baseline']} ppb.{also_en} Wind there came "
          f"from {w['from_deg']:.0f} degrees at {w['speed_mph']} mph. {n} major permitted facilities lie in the "
          f"upwind corridor.{rec_en}{ask_en}")
    es = (f"El {det_day_str(day, es=True)}, el monitor estatal de Texas en {trig['name']} registró "
          f"{det['value']} ppb de {name_es} en la hora de las {h12.replace('a.m.', 'a. m.').replace('p.m.', 'p. m.')} "
          f"CST, frente a una mediana de 7 días de {det['baseline']} ppb.{also_es} El viento venía de "
          f"{w['from_deg']:.0f} grados a {w['speed_mph']} mph. Hay {n} instalaciones permitidas importantes en el "
          f"corredor de donde venía el viento.{rec_es}{ask_es}")
    return {"draft_en": en, "draft_es": es, "drafted_by": "template (deterministic, no AI)",
            "guard": {"passed": True, "rejected": []}}


def det_day_str(day: str, es: bool = False) -> str:
    d = datetime.strptime(day, "%m/%d/%Y").date()
    months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
              "noviembre", "diciembre"]
    return f"{d.day} de {months[d.month - 1]} de {d.year}" if es else d.strftime("%B %-d, %Y")


STEERS_URL = "https://www2.tceq.texas.gov/oce/eer/index.cfm?fuseaction=main.getDetails&target={}"
STEERS_SEARCH = "https://www2.tceq.texas.gov/oce/eer/"


def load_monitors(cfg: dict, raw: Path = RAW) -> list[dict]:
    """Hourly readings and 7-day baseline for each configured monitor on cfg['day'] (compound cfg['param'])."""
    day = cfg["day"]
    monitors = []
    for site, name, lat, lon in cfg["monitors"]:
        path = raw / f"agc_{cfg['year']}_{site}_{cfg['param']}.html"
        table, flags = hourly_table(path), hourly_flags(path, day)
        vals, base = table[day], baseline(table, day)
        hourly = [{"hour_cst": h, "value": vals[h], "flag": flags[h]} for h in range(24)]
        peak_h = max((h for h in range(24) if vals[h] is not None), key=lambda h: vals[h])
        monitors.append({"site_id": site, "name": name, "lat": lat, "lon": lon, "hourly": hourly, "baseline": base,
                         "peak": {"hour_cst": peak_h, "value": vals[peak_h]}, "triggered": False})
    return monitors


def load_wind(site: str, year: str, day: str, raw: Path = RAW) -> dict:
    wdir = hourly_table(raw / f"met_{year}_{site}_61102.html")[day]
    wspd = hourly_table(raw / f"met_{year}_{site}_61101.html")[day]
    return {"site_id": site, "hourly": [{"hour_cst": h, "from_deg": wdir[h], "speed_mph": wspd[h]} for h in range(24)]}


def trace(monitors: list[dict], winds: dict[str, dict], wind_site: str | None, echo: dict, echo_rows: list[dict],
          details: dict[str, dict], complete: bool, det_day: date, param: str) -> dict:
    """Detect -> corridor -> place the day's reports -> record check. The one code path build and backtest share.

    wind_site None means: use the triggering monitor's own wind. Returns detection None when nothing triggered,
    and wind None when the chosen site has no wind for the detection hours.
    """
    det = detect(monitors)
    if det is None:
        return {"detection": None}
    for m in monitors:
        v = m["hourly"][det["hour_cst"]]["value"]
        m["triggered"] = v is not None and v >= max(TRIGGER_RATIO * m["baseline"], TRIGGER_FLOOR_PPB)
    trig = next(m for m in monitors if m["site_id"] == det["site_id"])
    wind = winds.get(wind_site or trig["site_id"])
    h = det["hour_cst"]
    wdir = [x["from_deg"] for x in wind["hourly"]] if wind else [None] * 24
    window = [wdir[max(0, h - 1)], wdir[h]]  # air arriving at hour h left the source up to ~1h earlier at ~7 mph
    if all(w is None for w in window):
        return {"detection": det, "wind": wind, "window": [], "trig": trig}
    facilities = corridor(echo, (trig["lat"], trig["lon"]), window)
    placed = place_incidents(list(details.values()), facilities, echo_rows, (trig["lat"], trig["lon"]),
                             [w for w in window if w is not None])
    rc = record_check(placed, details, det_day, h, search_complete=complete, param=param)
    return {"detection": det, "wind": wind, "window": [w for w in window if w is not None], "trig": trig,
            "facilities": facilities, "record_check": rc}


def build(cfg: dict = EVENT) -> dict:
    day = cfg["day"]
    det_day = datetime.strptime(day, "%m/%d/%Y").date()
    monitors = load_monitors(cfg)
    ws = cfg["wind_site"]
    winds = {ws: load_wind(ws, cfg["year"], day)}
    echo = json.loads((RAW / cfg["echo"]).read_text())
    search = steers_search(RAW / f"steers_search_harris_{day.replace('/', '')}.html")
    details = {r["incident"]: steers_incident(RAW / f"steers_{r['incident']}.html") for r in search["rows"]}
    complete = search["total"] == search["shown"] == len(details) and search["total"] < 50
    echo_rows = echo["Results"]["Facilities"] + [
        r for p in sorted(RAW.glob("echo_name_*.json")) for r in json.loads(p.read_text())["Results"]["Facilities"]]
    t = trace(monitors, winds, ws, echo, echo_rows, details, complete, det_day, cfg["param"])
    if t["detection"] is None:
        raise SystemExit("no monitor crossed the trigger rule on this day; nothing to replay")
    if "record_check" not in t:
        raise SystemExit(f"no wind at {ws} for the detection hours; cannot draw a corridor")
    det, wind, trig, window, facilities, rc = (t[k] for k in ("detection", "wind", "trig", "window", "facilities",
                                                               "record_check"))
    name_en = COMPOUNDS[cfg["param"]][0]
    tz = "CDT, CST+1" if steers_tz_offset_h(det_day) else "CST"
    ev = {
        "schema": SCHEMA, "label": "real", "event_id": f"steers-{cfg['incident']}",
        "title": f"{name_en.capitalize()} spike on the Houston Ship Channel", "date_local": det_day.isoformat(),
        "time_note": f"Monitor hours are CST as TCEQ publishes them; the company report uses local time ({tz}). "
                     "TCEQ labels AutoGC data provisional and subject to change.",
        "compound": {"name": name_en, "aqs_param": cfg["param"], "units": "ppb-v"},
        "monitors": monitors, "wind": wind, "detection": det, "facilities": facilities, "record_check": rc,
        "corridor": {"origin_site_id": trig["site_id"], "half_width_deg": CORRIDOR_HALF_ANGLE,
                     "max_km": CORRIDOR_RADIUS_KM, "wind_from_deg": window},
        "packet": template_packet(det, monitors, wind, facilities, rc, day, cfg["param"]),
        "cannot_say": [
            "A matching report is not proof the facility caused every reading; other sources can add to a spike.",
            ("'Not yet reported' would not mean 'illegal': Texas requires a report only above a reportable quantity, "
            "and air readings cannot measure how much was released (30 TAC 101.201)."),
            ("The upwind corridor comes from wind direction at one monitor (geometry only), not a dispersion "
            "model; it cannot tell facilities along the same bearing apart."),
            "Facility coordinates are as published by EPA ECHO and may be approximate.",
            "Only regulator-grade state monitors are used; many neighborhoods have none.",
        ],
        "provenance": json.loads((RAW / "provenance.json").read_text()),
    }
    errs = validate(ev)
    if errs:
        raise SystemExit("event.json failed the contract:\n- " + "\n- ".join(errs))
    return ev


if __name__ == "__main__":
    ev = build()
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "event.real.json"
    out.write_text(json.dumps(ev, indent=1))
    d, f0, rc = ev["detection"], ev["facilities"][0], ev["record_check"]
    print(f"wrote {out.relative_to(ROOT)}")
    print(f"detect: {d['site_id']} {d['hour_cst']:02d}:00 CST {d['value']} ppb (baseline {d['baseline']})")
    print(f"corridor: {len(ev['facilities'])} facilities; nearest {f0['name']} {f0['distance_km']} km")
    print(f"record: {rc['status']} {[c['status'] for c in rc['checks']]} matched={rc['matched_facility_id']}")
    if "--publish" in sys.argv:
        shutil.copy(out, ROOT / "web" / "public" / "event.json")
        print("published to web/public/event.json")
