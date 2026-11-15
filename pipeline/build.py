"""Build event.json for one real night: detect the spike, rank facilities upwind, check the self-report.

Usage: uv run python -m pipeline.build   (writes data/build/event.real.json, the hand-configured audit build)
web/public/event.json is written by `uv run python -m pipeline.nights` (the same night from the full run).
"""

import json
import math
import re
import statistics
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline.contract import SCHEMA, validate
from pipeline.names import display_name
from pipeline.parse import hourly_flags, hourly_table, lists_param, steers_incident, steers_search

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "build"

# One demo event; build() takes any config of this shape. Monitor coordinates are TCEQ TAMIS site records.
EVENT = {
    "day": "06/21/2024", "year": "2024", "incident": "425347", "echo": "echo_milby_10mi.json", "param": "45201",
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


def site_names(rows: list[dict]) -> dict[str, list[str]]:
    """Every distinct name of a major ECHO air source per RegistryID, sorted. One registry id can hold several permit
    holders at one address (5 at 5900 Highway 225, Deer Park), so no single row's name speaks for the whole site."""
    out: dict[str, set[str]] = {}
    for r in rows:
        if r.get("RegistryID") and r.get("AIRName") and r.get("AIRUniverse") == "Major Emissions" and r.get("FacLat"):
            out.setdefault(r["RegistryID"], set()).add(" ".join(r["AIRName"].split()))
    return {k: sorted(v) for k, v in out.items()}


def site_label(rid: str | None, air_name: str, names: dict[str, list[str]]) -> str:
    """How a corridor site is named: every permit holder ECHO lists at the registry id, sorted, joined by " / "
    (the facility pages' rule), so no one holder's row names a site that others share. One holder: its own name."""
    held = names.get(rid or "", [])
    return " / ".join(display_name(n) for n in held) if len(held) > 1 else display_name(air_name)


def corridor(echo: dict, origin: tuple[float, float], wind_from: list[float | None],
             names: dict[str, list[str]] | None = None) -> list[dict]:
    """Major sources inside the upwind corridor, nearest first. Geometry only: no facility is singled out.

    `names` is site_names() over every ECHO row the caller has (all monitors' files), so a site reads the same on
    every night whichever monitor's file listed it; None uses this file's rows alone."""
    winds = [w for w in wind_from if w is not None]
    names = site_names(echo["Results"]["Facilities"]) if names is None else names
    out = []
    for f in echo["Results"]["Facilities"]:
        if f.get("AIRUniverse") != "Major Emissions" or not f.get("FacLat"):
            continue
        p = (float(f["FacLat"]), float(f["FacLong"]))
        d, b = haversine_km(origin, p), bearing_deg(origin, p)
        off = min(abs((w - b + 180) % 360 - 180) for w in winds)
        if d > CORRIDOR_RADIUS_KM or off > CORRIDOR_HALF_ANGLE:
            continue
        out.append({"id": f.get("RegistryID") or f["AIRName"], "name": site_label(f.get("RegistryID"), f["AIRName"], names), "lat": p[0], "lon": p[1],
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


def _street_no(addr: str | None) -> str | None:
    m = re.match(r"\s*(\d+)", addr or "")
    return m.group(1) if m else None


def locate(entity: str, address: str, echo_rows: list[dict]) -> tuple[dict | None, str]:
    """Ground-truth location for a reporting facility: exact ECHO name, disambiguated by street number.

    Falls back to street number + street name when the names differ. Ambiguity is never resolved by guessing.
    """
    norm = _norm
    rows = [r for r in echo_rows if r.get("FacLat")]
    by_name = {r["RegistryID"]: r for r in rows if norm(r["AIRName"]) == norm(entity)}
    no = _street_no(address)
    if len(by_name) == 1:
        return next(iter(by_name.values())), "ECHO exact name"
    if len(by_name) > 1:
        same = {k: r for k, r in by_name.items() if no and _street_no(r.get("AIRStreet")) == no}
        if len(same) == 1:
            return next(iter(same.values())), "ECHO exact name + street number"
        return None, f"ambiguous: {len(by_name)} ECHO sites share the name"
    street = norm(address.split(";")[0])
    by_addr = {r["RegistryID"]: r for r in rows if no and street and norm(r.get("AIRStreet") or "") == street}
    if len(by_addr) == 1:
        return next(iter(by_addr.values())), "ECHO street address"
    return None, "not located in ECHO" if not by_addr else f"ambiguous: {len(by_addr)} ECHO sites at the address"


def place_incidents(incidents: list[dict], facilities: list[dict], echo_rows: list[dict],
                    origin: tuple[float, float], winds: list[float]) -> list[dict]:
    """Put every self-report of the day on the map and say whether it falls in the upwind corridor.

    Each report is located with `locate` (exact ECHO name, disambiguated by the report's own street number, else
    street address). A name shared by several ECHO sites that the address cannot settle stays 'unresolved', never
    a guess, and an unresolved incident blocks any absence claim.
    """
    in_corr = {f["id"]: f for f in facilities}
    out = []
    for inc in incidents:
        row = {"incident": inc["incident"], "entity": display_name(inc["entity"]), "rn": inc["rn"],
               "start_local": inc["start_local"], "compound": inc["compound"], "pounds": inc["pounds"]}
        fac, how = locate(inc["entity"], inc.get("address", ""), echo_rows)
        rid = fac.get("RegistryID") if fac else None
        if fac is not None and rid in in_corr:
            f = in_corr[rid]
            row |= {"facility_id": f["id"], "distance_km": f["distance_km"], "bearing_deg": f["bearing_deg"],
                    "in_corridor": True, "resolution": "in the upwind corridor"}
        elif fac is not None:
            p = (float(fac["FacLat"]), float(fac["FacLong"]))
            d, b = haversine_km(origin, p), bearing_deg(origin, p)
            off = min(abs((w - b + 180) % 360 - 180) for w in winds)
            row |= {"facility_id": rid, "distance_km": round(d, 1),
                    "bearing_deg": round(b, 1), "in_corridor": False,
                    "resolution": f"outside the corridor ({d:.1f} km, {off:.0f}° off the wind)"}
        else:
            why = "facility not located" if how.startswith("not located") else how.replace("ambiguous: ", "ambiguous, ")
            row |= {"facility_id": None, "distance_km": None, "bearing_deg": None, "in_corridor": None,
                    "resolution": f"unresolved: {why}"}
        out.append(row)
    return out


FINAL_DEADLINE_DAYS = 14  # 30 TAC 101.201(b): final record within two weeks after the event ends


def final_check(inc: dict) -> tuple[str, str]:
    """T+14d from the report's own fields: a FINAL report dated within 14 days of the event's end.

    A FINAL report dated later is 'reported_late', never 'not_yet_reported': the record exists, so "not yet" would
    be false. 'not_yet_reported' is kept for the final report of a page that has none on file (only the initial
    notice, or no final date): that check only, since the notice itself is on the record (record_check)."""
    if inc.get("report_type") != "FINAL" or not inc.get("report_date"):
        return "not_yet_reported", (f"final report pending: the cached report is type "
                                    f"{inc.get('report_type') or 'not stated'}, with no final report date")
    days = (date.fromisoformat(inc["report_date"]) - datetime.fromisoformat(inc["end_local"]).date()).days
    status = "reported" if days <= FINAL_DEADLINE_DAYS else "reported_late"
    return status, f"final report dated {inc['report_date']}, {days} days after the event ended"


MATCH_WINDOW_H = (-6, 2)  # a report matches if its [start, end] overlaps [spike - 6 h, spike + 2 h] (local time)
# kn: absence needs this many earlier days searched; p99 STEERS event length in 2024-25 is 26 d (3 of 335 ran
# longer), so a still-running event that started more than 30 days earlier can be missed. Widen if that matters.
LOOKBACK_DAYS = 30
CALM_MPH = 3.0  # below this, one monitor's wind direction is too unsteady to draw an upwind corridor
KMH_PER_MPH = 1.609


def _local(det_day: date, det_hour_cst: int) -> datetime:
    """The detection hour's start in STEERS local time (CST or CDT, from the detection day)."""
    return datetime.combine(det_day, datetime.min.time()) + timedelta(
        hours=det_hour_cst + steers_tz_offset_h(det_day))


def _gap(inc: dict, t: datetime) -> timedelta:
    """How far t lies outside the report's [start, end]; zero when the report was running at t."""
    s, e = datetime.fromisoformat(inc["start_local"]), datetime.fromisoformat(inc["end_local"])
    return max(s - t, t - e, timedelta(0))


def _travel(p: dict, inc: dict, det_local: datetime, speed_mph: float | None) -> dict:
    """Informational timing: how long air takes from the facility to the monitor at the detection-hour wind."""
    if not speed_mph or p.get("distance_km") is None:
        return {"travel_h": None, "travel_speed_mph": speed_mph, "start_to_spike_h": None}
    travel_h = p["distance_km"] / (speed_mph * KMH_PER_MPH)
    start = datetime.fromisoformat(inc["start_local"])
    return {"travel_h": round(travel_h, 2), "travel_speed_mph": speed_mph, "travel_distance_km": p["distance_km"],
            "start_to_spike_h": round((det_local - start).total_seconds() / 3600, 2),
            "arrival_local": (start + timedelta(hours=travel_h)).isoformat(timespec="minutes"),
            "spike_hour_local": [det_local.isoformat(timespec="minutes"),
                                 (det_local + timedelta(hours=1)).isoformat(timespec="minutes")]}


def county_en(county: str) -> str:
    """"Harris" -> "Harris County"; a region searched by several, "Ector, Midland" -> "Ector and Midland counties"."""
    *rest, last = [c.strip() for c in county.split(",")]
    return f"{last} County" if not rest else f"{', '.join(rest)} and {last} counties"


def county_es(county: str) -> str:
    """"Harris" -> "el condado de Harris"; "Ector, Midland" -> "los condados de Ector y Midland"."""
    *rest, last = [c.strip() for c in county.split(",")]
    return f"el condado de {last}" if not rest else f"los condados de {', '.join(rest)} y {last}"


def record_check(placed: list[dict], details: dict[str, dict], det_day: date, det_hour_cst: int,
                 search_complete: bool, param: str, ongoing: list[dict] | None = None,
                 earlier_complete: bool = False, earlier_note: str = "", calm_note: str = "",
                 speed_mph: float | None = None, county: str = "Harris",
                 unplaced_other: tuple[str, ...] | list[str] = ()) -> dict:
    """Did ANY facility in the corridor file a matching emissions-event report? Checked at T+24h and T+14d.

    A report matches if it was running at any time in [spike - 6 h, spike + 2 h]; it may have started on an
    earlier day (`ongoing`: reports that started before the detection day, placed like `placed`).
    Absence ('no report after deadline') needs the day's search complete, the LOOKBACK_DAYS before it searched
    (`earlier_complete`), traceable wind, and every report of the day and every overlapping earlier report located.
    Otherwise the status is search_incomplete; a named facility is never called out on partial data.
    `unplaced_other`: ids of second-source (NRC) reports that could match but could not be located; they block
    absence the same way, and are listed as `unplaced_other_reports`.
    """
    det_local = _local(det_day, det_hour_cst)
    lo, hi = det_local + timedelta(hours=MATCH_WINDOW_H[0]), det_local + timedelta(hours=MATCH_WINDOW_H[1])

    def overlaps(p: dict) -> bool:
        inc = details[p["incident"]]
        return datetime.fromisoformat(inc["start_local"]) <= hi and datetime.fromisoformat(inc["end_local"]) >= lo

    still_open = [p for p in ongoing or [] if overlaps(p)]
    # placed may also hold next-day reports (a window past midnight); the next-day count is in earlier_note
    today = sum(1 for p in placed if (p.get("start_local") or "")[:10] <= det_day.isoformat())
    scope = (f"Searched every STEERS emissions event starting {det_day.strftime('%m/%d/%Y')} in {county_en(county)} "
             f"({today} found; search {'complete' if search_complete else 'incomplete'}).")
    scope += f" {earlier_note}" if earlier_note else " Events that started on earlier days were not searched."
    if calm_note:
        scope += f" {calm_note[0].upper()}{calm_note[1:]}: no corridor drawn, so the search is incomplete."
    base = {"day_incidents": placed, "ongoing_incidents": still_open, "search_scope": scope}
    in_time = [] if calm_note else [p for p in placed + still_open if p["in_corridor"] and overlaps(p)]
    # A report only matches if it lists the compound the monitor saw; otherwise it is reported_mismatch.
    hits = [p for p in in_time if lists_param(details[p["incident"]], param)]
    mismatch = not hits and bool(in_time)
    hits = hits or in_time
    if hits:
        p = min(hits, key=lambda x: (_gap(details[x["incident"]], det_local),
                                     abs(datetime.fromisoformat(x["start_local"]) - det_local)))
        inc = details[p["incident"]]
        start = datetime.fromisoformat(inc["start_local"])
        # 30 TAC 101.201(a)(1): the initial notice is due within 24 h of discovery, not of the monitor spike.
        notice_h = (datetime.fromisoformat(inc["notified_local"]) - start).total_seconds() / 3600
        t24 = "reported" if notice_h <= 24 else "reported_late"  # the notice is on file, dated after 24 h
        t14, t14_note = final_check(inc)
        # No final report on file yet: the initial notice is, so the report's status is the notice's (T+24h), never
        # "not yet reported" for a report that is on the record (review L9); the T+14d check says the final is pending.
        status = "reported_mismatch" if mismatch else t24 if t14 == "not_yet_reported" else t14
        basis = ("started near the spike" if start.date() >= det_day
                 else f"ongoing (started {start.date().isoformat()})")
        # On a match, the compound and pounds are the monitored compound's, summed over the report's emission points;
        # the report's first contaminant line can be another compound (CO before benzene). A mismatch keeps that
        # first line: it is what the report does list. A report that names the compound only inside a lumped row
        # ("BTEX - benzene, ...") gives that row and the mixture's pounds, never those pounds as the compound's.
        lumped = [] if mismatch or inc["lbs_by_param"][param] > 0 else inc.get("lumped_by_param", {}).get(param, [])
        compound, pounds = ((inc["compound"], inc["pounds"]) if mismatch
                            else (COMPOUNDS[param][0], inc["lbs_by_param"][param]) if not lumped
                            else ("; ".join(r["cell"] for r in lumped),
                                  float(sum(Decimal(repr(r["pounds"])) for r in lumped))))
        return base | {
            "status": status, "incident": inc["incident"], "matched_facility_id": p["facility_id"],
            "source_url": STEERS_URL.format(inc["incident"]),
            "checks": [{"at": "T+24h", "status": t24,
                        "note": f"initial notice filed {inc['notified_local']} local, {notice_h:.1f} h after the "
                                f"reported discovery {inc['start_local']}"},
                       {"at": "T+14d", "status": t14, "note": t14_note}],
            "compound_match": not mismatch,
            "reported": {"facility": p["entity"], "compound": compound, "pounds": pounds,
                         "start_local": inc["start_local"], "end_local": inc["end_local"],
                         "tz": f"local ({'CDT' if steers_tz_offset_h(det_day) else 'CST'})",
                         "cause": inc["cause"], "match_basis": basis}
                        | ({"lumped": True} if lumped else {})
                        | ({"revisions": inc["revisions"]} if inc.get("revisions") else {})
                        | _travel(p, inc, det_local, speed_mph),
        }
    located = all(p["in_corridor"] is not None for p in placed + still_open) and not unplaced_other
    if unplaced_other:
        base["unplaced_other_reports"] = list(unplaced_other)
    can_claim_absence = search_complete and earlier_complete and located and not calm_note
    none = "no_report_after_deadline" if can_claim_absence else "search_incomplete"
    if can_claim_absence:
        base["search_scope"] += " No matching report found in a complete search."
    elif not located and not calm_note:  # a calm night places nothing (in_corridor None); calm_note says why
        base["search_scope"] += " A report open at that time could not be located, so the search is incomplete."
    return base | {"status": none, "incident": None, "matched_facility_id": None, "source_url": STEERS_SEARCH,
                   "checks": [{"at": "T+24h", "status": none, "note": calm_note},
                              {"at": "T+14d", "status": none, "note": calm_note}],
                   "reported": None}


NRC_UNITS = {"POUND(S)": ("pounds", "libras"), "GALLON(S)": ("gallons", "galones")}  # NRC's own unit spellings


def template_packet(det: dict, monitors: list[dict], wind: dict, facilities: list[dict], rc: dict,
                    day: str = EVENT["day"], param: str = EVENT["param"], county: str = "Harris") -> dict:
    """Deterministic EN/ES draft built only from event fields (Gemini drafting is a later, guarded stretch)."""
    name_en, name_es = COMPOUNDS[param]
    det_iso = datetime.strptime(day, "%m/%d/%Y").date().isoformat()
    trig = next(m for m in monitors if m["site_id"] == det["site_id"])
    others = [m for m in monitors if m["triggered"] and m["site_id"] != det["site_id"]]
    w = wind["hourly"][det["hour_cst"]]
    # An AutoGC-form wind can miss the detection hour while the hour before (still in the corridor window) has it.
    if w["from_deg"] is None:
        wind_en, wind_es = " Wind there had no direction reading for that hour.", (
            " No hubo lectura de la dirección del viento en esa hora.")
    else:
        deg = _exact(w["from_deg"])
        wind_en = f" Wind there came from {deg} degrees at {w['speed_mph']} mph."
        wind_es = f" El viento venía de {deg} grados a {w['speed_mph']} mph."
    h12 = f"{(det['hour_cst'] % 12) or 12}:00 {'a.m.' if det['hour_cst'] < 12 else 'p.m.'}"
    also_en = "".join(f" {m['name']} recorded {m['hourly'][det['hour_cst']]['value']} ppb in the same hour." for m in others)
    also_es = "".join(f" {m['name']} registró {m['hourly'][det['hour_cst']]['value']} ppb en la misma hora." for m in others)
    n = len(facilities)
    calm = rc["checks"][0]["note"].startswith("wind too light")
    corr_en = (" The wind was too light to trace where the air came from, so no upwind corridor is drawn." if calm
               else f" {n} major permitted facilities lie in the upwind corridor.")
    corr_es = (" El viento era demasiado débil para saber de dónde venía el aire, así que no se traza un corredor."
               if calm else f" Hay {n} instalaciones grandes con permiso en el corredor viento arriba.")
    if rc["status"] == "reported_mismatch":
        r = rc["reported"]
        when_en, when_es, _ = _release_when(r, det_iso)
        rec_en = (f" One of them, {r['facility']}, filed report {rc['incident']} for {when_en}, "
                  f"but the report does not list {name_en}, so it does not match this reading.")
        rec_es = (f" Una de ellas, {r['facility']}, presentó el reporte {rc['incident']} por {when_es}, "
                  f"pero el reporte no incluye {name_es}, así que no corresponde a esta lectura.")
        ask_en = f" Requested follow-up: confirm what caused this {name_en} reading."
        ask_es = f" Seguimiento solicitado: confirmar qué causó esta lectura de {name_es}."
    elif rc["status"] == "reported_nrc":
        n = rc["nrc"]
        who = f"{n['company']}, " if n["company"] else ""
        start = n["incident_local"].replace("T", " ")
        unit_en, unit_es = NRC_UNITS.get(n["unit"], (n["unit"].lower(), n["unit"].lower()))
        amount_en = f"{_exact(n['amount'], grouped=True)} {unit_en}" if n["amount"] is not None else (
            "an amount not stated")
        amount_es = f"{_exact(n['amount'], grouped=True)} {unit_es}" if n["amount"] is not None else (
            "una cantidad no indicada")
        rec_en = (f" No matching report was found in that day's state emissions-event records for {county} County, but a "
                  f"report to the federal National Response Center, NRC report {n['report']}, names {who}a site in the "
                  f"upwind corridor, starting {start} local time, and lists {n['material'].lower()} ({amount_en}). "
                  "NRC reports are initial phone reports; other sources may also contribute.")
        rec_es = (f" No se encontró un reporte que coincida en los registros estatales de eventos de emisiones de ese día "
                  f"en el condado de {county}, pero un reporte al Centro Nacional de Respuesta federal, el reporte NRC "
                  f"{n['report']}, nombra {('a ' + n['company'] + ', ') if n['company'] else ''}un sitio en el corredor "
                  f"viento arriba, a partir de {start}, hora local, y menciona {name_es} («{n['material']}»; {amount_es}). "
                  "Los reportes al NRC son avisos telefónicos iniciales; otras fuentes también pueden contribuir.")
        ask_en = (" Requested follow-up: confirm whether this release was also reported to the state, and whether it "
                  "accounts for these readings.")
        ask_es = (" Seguimiento solicitado: confirmar si esta emisión también se reportó al estado y si explica estas "
                  "lecturas.")
    elif rc["matched_facility_id"]:
        r = rc["reported"]
        lbs = _exact(r["pounds"], grouped=True)
        when_en, when_es, same_day = _release_when(r, det_iso)
        # A lumped row's pounds are the mixture's: say so, never "N pounds of benzene".
        what_en = (f"a mixture the report lists as \"{r['compound']}\", which includes {name_en}" if r.get("lumped")
                   else name_en)
        what_es = (f"una mezcla que el reporte indica como «{r['compound']}», que incluye {name_es}" if r.get("lumped")
                   else name_es)
        if same_day:
            rec_en = (f" One of them, {r['facility']}, filed emissions-event report {rc['incident']} for {lbs} "
                      f"pounds of {what_en} {when_en.removeprefix('a release ')}. The reported release window and the "
                      "wind line up with these readings; other sources may also contribute.")
            rec_es = (f" Una de ellas, {r['facility']}, presentó el reporte de evento de emisiones {rc['incident']} por "
                      f"{lbs} libras de {what_es} {when_es.removeprefix('una emisión ')}. El horario de la emisión "
                      "reportada y el viento coinciden con estas lecturas; otras fuentes también pueden contribuir.")
        else:  # a report that ran across days: its pounds are the whole release's, not these hours'
            rec_en = (f" One of them, {r['facility']}, filed emissions-event report {rc['incident']} for {when_en}, "
                      f"listing {lbs} pounds of {what_en} for the whole release, not for these hours. The reported "
                      "release window reaches the hours around these readings; other sources may also contribute.")
            rec_es = (f" Una de ellas, {r['facility']}, presentó el reporte de evento de emisiones {rc['incident']} por "
                      f"{when_es}, con {lbs} libras de {what_es} para toda la emisión, no solo para estas horas. El "
                      "horario de la emisión reportada llega a las horas de estas lecturas; otras fuentes también "
                      "pueden contribuir.")
        ask_en = (" Requested follow-up: confirm whether nearby residents were notified, and whether the reported "
                  "amount accounts for these readings.")
        ask_es = (" Seguimiento solicitado: confirmar si se avisó a los residentes cercanos y si la cantidad reportada "
                  "explica estas lecturas.")
    elif rc["status"] == "no_report_after_deadline":
        rec_en = (" No matching report found in a complete search of that day's emissions-event records for "
                  f"{county_en(county)}. That does not show who or what caused the reading.")
        rec_es = (" No se encontró un reporte que coincida en una búsqueda completa de los registros de eventos "
                  f"de emisiones de ese día en {county_es(county)}. Eso no indica quién o qué causó la lectura.")
        ask_en = " Requested follow-up: confirm whether any facility in this corridor reported a release that hour."
        ask_es = (" Seguimiento solicitado: confirmar si alguna instalación en este corredor reportó una emisión "
                  "a esa hora.")
    else:
        rec_en = " No matching report was found in the records checked; the search is incomplete."
        rec_es = " No se encontró un reporte que coincida en los registros revisados; la búsqueda está incompleta."
        ask_en = " Requested follow-up: confirm whether any facility in this corridor reported a release that hour."
        ask_es = (" Seguimiento solicitado: confirmar si alguna instalación en este corredor reportó una emisión "
                  "a esa hora.")
    if calm:  # no corridor is drawn on a calm night, so the question cannot point at "this corridor"
        ask_en = " Requested follow-up: confirm whether any facility near the monitor reported a release that hour."
        ask_es = (" Seguimiento solicitado: confirmar si alguna instalación cercana al monitor reportó una emisión "
                  "a esa hora.")
    en = (f"On {det_day_str(day)}, the Texas state monitor at {trig['name']} recorded {det['value']} ppb of "
          f"{name_en} in the {h12} CST hour, against a 7-day median of {det['baseline']} ppb.{also_en}{wind_en}"
          f"{corr_en}{rec_en}{ask_en}")
    es = (f"El {det_day_str(day, es=True)}, el monitor estatal de Texas en {trig['name']} registró "
          f"{det['value']} ppb de {name_es} en la hora de las {h12.replace('a.m.', 'a. m.').replace('p.m.', 'p. m.')} "
          f"CST, frente a una mediana de 7 días de {det['baseline']} ppb.{also_es}{wind_es}{corr_es}{rec_es}{ask_es}")
    return {"draft_en": en, "draft_es": es, "drafted_by": "template (deterministic, no AI)",
            "guard": {"passed": True, "rejected": []}}


def _release_when(r: dict, det_iso: str) -> tuple[str, str, bool]:
    """When the report says the release ran (EN, ES, began and ended on the detection day), from match_basis and the
    report's own start and end dates.

    Most matched reports were already running when the monitor spiked: "from 10:37 to 17:00 local time that day" for
    a report that ran from 2024-04-20 10:37 to 2024-04-25 17:00 put the window on the wrong day and left out the
    spike hour (review H1). Only a release that began and ended on the detection day is given as clock times."""
    start, end = r["start_local"].replace("T", " "), r["end_local"].replace("T", " ")
    if r["match_basis"].startswith("ongoing"):
        return (f"a release that started {start} and, per the report, ran until {end} local time",
                f"una emisión que empezó el {start} y que, según el reporte, siguió hasta el {end}, hora local", False)
    if start[:10] != det_iso:  # began after midnight, inside the window that runs into the next day
        return (f"a release that, per the report, ran from {start} to {end} local time",
                f"una emisión que, según el reporte, fue del {start} al {end}, hora local", False)
    if end[:10] == start[:10]:
        return (f"a release from {start[11:]} to {end[11:]} local time that day",
                f"una emisión de {start[11:]} a {end[11:]}, hora local, ese día", True)
    return (f"a release that started at {start[11:]} that day and, per the report, ran until {end} local time",
            (f"una emisión que empezó a las {start[11:]} ese día y que, según el reporte, siguió hasta el {end}, "
             "hora local"), False)


def _exact(x: float, grouped: bool = False) -> str:
    """77.0 -> '77', 77.5 -> '77.5', 8469.74 -> '8,469.74' grouped: drop a whole value's '.0' but never round.

    The guard wants the exact figure: rounding printed "8,470" for 8469.74 lb and "0 pounds" for 0.07 lb."""
    d = Decimal(repr(float(x)))  # repr keeps the published digits; 'f' never falls back to '1e-05'
    if d == d.to_integral_value():
        d = d.to_integral_value()
    return format(d, ",f" if grouped else "f")


def det_day_str(day: str, es: bool = False) -> str:
    d = datetime.strptime(day, "%m/%d/%Y").date()
    months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
              "noviembre", "diciembre"]
    return f"{d.day} de {months[d.month - 1]} de {d.year}" if es else f"{d:%B} {d.day}, {d.year}"


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


# A site's own wind, in the order it is tried: the met form (61102 direction, 61101 speed), then the AutoGC form's
# resultant wind (61104 direction, 61103 speed; 2024-25 check at the 8 sites with both: 87-91% of a site-year's hours
# within 22.5 deg of the met form, speed 0.3-0.4 mph lower). Only when both are missing for the day does a site
# borrow its nearest neighbour's.
WIND_SOURCES = ("met", "autogc")
_WIND_FILES = {"met": ("met", "61101", "61102"), "autogc": ("agc", "61103", "61104")}  # (prefix, speed, direction)
WIND_FORM = {"met": "met form", "autogc": "AutoGC form, resultant wind"}


def wind_files(site: str, year: str, source: str = "met") -> list[str]:
    """Raw file names behind one site's wind: [speed, direction] (the order provenance has always listed them)."""
    prefix, s, d = _WIND_FILES[source]
    return [f"{prefix}_{year}_{site}_{s}.html", f"{prefix}_{year}_{site}_{d}.html"]


def _wind_row(site: str, year: str, day: str, source: str, raw: Path, table) -> tuple[list, list] | None:
    """(speed, direction) hourly lists for one day from one source's two files, or None (file or row missing)."""
    paths = [raw / f for f in wind_files(site, year, source)]
    if not all(p.exists() for p in paths):
        return None
    try:
        wspd, wdir = ((table or hourly_table)(p).get(day) for p in paths)
    except ValueError:
        return None
    return (wspd, wdir) if wspd and wdir else None


def previous_hour(site: str, day: str, source: str, raw: Path = RAW, table=None) -> tuple[dict | None, str]:
    """The previous day's 23:00 CST reading at the site from the same source, for a spike in hour 0, and a note.

    On 1 January that day is in the previous year's file. Missing file or row: (None, why); the caller then reads
    hour 0 alone (the fallback: one hour of wind, not the hour before twice)."""
    prev = datetime.strptime(day, "%m/%d/%Y") - timedelta(days=1)
    pday, pyear = prev.strftime("%m/%d/%Y"), str(prev.year)
    row = _wind_row(site, pyear, pday, source, raw, table)
    if row is None:
        return None, (f"no cached {WIND_FORM[source]} wind for {prev.date().isoformat()} 23:00 CST "
                      f"({', '.join(wind_files(site, pyear, source))}), so hour 0's wind is used alone")
    wspd, wdir = row
    return ({"date": prev.date().isoformat(), "hour_cst": 23, "from_deg": wdir[23], "speed_mph": wspd[23]},
            f"the hour before is {prev.date().isoformat()} 23:00 CST")


def own_wind(site: str, year: str, day: str, raw: Path = RAW, table=None) -> dict | None:
    """The site's own wind for the day from the first source in WIND_SOURCES that has a direction that day, else None.

    A met-form wind keeps the original shape {site_id, hourly}; an AutoGC one adds source "autogc". `table` is a
    path -> hourly table function (a cache); a missing file or a page with no hourly rows counts as no wind.
    `prev_hour` is the previous day's 23:00 from the same source (None when not cached; `prev_hour_note` says why),
    read only by a spike in hour 0 (wind_pair) and kept in event.json only for one (wind_block)."""
    for source in WIND_SOURCES:
        row = _wind_row(site, year, day, source, raw, table)
        if row is None or all(v is None for v in row[1]):
            continue
        wspd, wdir = row
        w = {"site_id": site, "hourly": [{"hour_cst": h, "from_deg": wdir[h], "speed_mph": wspd[h]} for h in range(24)]}
        prev, note = previous_hour(site, day, source, raw, table)
        return (w if source == "met" else w | {"source": source}) | {"prev_hour": prev, "prev_hour_note": note}
    return None


def wind_pair(wind: dict, h: int) -> list[dict]:
    """The wind readings for the hour before the detection hour and the hour itself (the corridor window).

    At hour 0 the hour before is the previous day's 23:00 (`prev_hour`); without it, hour 0 alone. Reading hour 0
    twice drew the window from one bearing and checked calm on one hour while saying two (review L8)."""
    if h:
        return [wind["hourly"][h - 1], wind["hourly"][h]]
    prev = wind.get("prev_hour")
    return [prev, wind["hourly"][0]] if prev else [wind["hourly"][0]]


def name_filer(facilities: list[dict], rc: dict, echo_rows: list[dict]) -> None:
    """Name the matched site as the report names its filer.

    One registry id can carry several permit holders' names (5 at 5900 Highway 225, Deer Park), and the corridor
    lists them all (site_label). The Check step prints this name beside the report number, so on the matched site
    it is the company that filed; every major-source name ECHO lists for the site is kept in echo_names."""
    if not rc.get("matched_facility_id") or not rc.get("reported"):
        return
    f = next((x for x in facilities if x["id"] == rc["matched_facility_id"]), None)
    filer = rc["reported"]["facility"]
    if f is None or f["name"] == filer:
        return
    f["echo_names"] = [display_name(n) for n in site_names(echo_rows).get(f["id"], [])] or [f["name"]]
    f["name"] = filer


def disambiguate(facilities: list[dict], echo_facilities: list[dict], keep_id: str | None = None) -> None:
    """Give corridor sites that share a display name a street, then an EPA registry id if the street is shared too.

    ECHO registers 4 separate "GALENA PARK TERMINAL" sites (two at 906 Clinton Dr) and 2 "LA PORTE VCM PLANT" sites at
    one address, so the Trace list showed the same name 2-4 times (UI audit 3, S124). ECHO has no operator field, so
    the street is the first tie-breaker. keep_id (the matched site) keeps its name: the Check step prints it beside
    the report number and it must stay the filer's name."""
    street: dict[str, str] = {}
    for r in echo_facilities:  # first major-source row per site, in file order, so the result is deterministic
        if r.get("RegistryID") and r.get("AIRUniverse") == "Major Emissions" and (r.get("AIRStreet") or "").strip():
            street.setdefault(r["RegistryID"], display_name(" ".join(r["AIRStreet"].split())))
    names = [f["name"] for f in facilities]
    clash = {n for n in names if names.count(n) > 1}
    tagged = [f for f in facilities if f["name"] in clash and f["id"] != keep_id]
    keys = [(f["name"], street.get(f["id"])) for f in tagged]
    for f, (name, st) in zip(tagged, keys, strict=True):
        label = st if st and keys.count((name, st)) == 1 else ", ".join(x for x in (st, f"EPA {f['id']}") if x)
        f["name"] = f"{name} ({label})"


def trace(monitors: list[dict], winds: dict[str, dict], wind_site: str | None, echo: dict, echo_rows: list[dict],
          details: dict[str, dict], complete: bool, det_day: date, param: str,
          earlier: dict[str, dict] | None = None, earlier_complete: bool = False, earlier_note: str = "",
          county: str = "Harris", nrc_reports: list[dict] | None = None) -> dict:
    """Detect -> corridor -> place the day's reports -> record check. The one code path build and backtest share.

    wind_site None means: use the triggering monitor's own wind. Returns detection None when nothing triggered,
    and wind None when the chosen site has no wind for the detection hours. `earlier` holds reports that started
    before the day and may still have been running; record_check keeps the ones that overlap the spike.
    `nrc_reports` (pipeline.nrc.load) are the second source: one that could match but cannot be located blocks
    absence like an unlocated STEERS report; one in the corridor counts only where STEERS found nothing in the
    corridor and window (nrc.second_source). None skips the second source.
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
    pair = wind_pair(wind, h) if wind else []
    window = [x["from_deg"] for x in pair]  # air arriving at hour h left the source up to ~1h earlier at ~7 mph
    if all(w is None for w in window):
        return {"detection": det, "wind": wind, "window": [], "trig": trig}
    speeds = [x["speed_mph"] for x in pair]
    known = [v for v in speeds if v is not None]
    # kn: an hour with direction but no speed is not treated as calm; abstain on unknown speed if those nights matter.
    calm = min(known) if known and min(known) < CALM_MPH else None
    calm_note = f"wind too light to trace ({calm:g} mph)" if calm is not None else ""
    origin, winds_ok = (trig["lat"], trig["lon"]), [w for w in window if w is not None]
    facilities = [] if calm_note else corridor(echo, origin, window, site_names(echo_rows))
    earlier = earlier or {}
    placed = place_incidents(list(details.values()), facilities, echo_rows, origin, winds_ok)
    ongoing = place_incidents(list(earlier.values()), facilities, echo_rows, origin, winds_ok)
    if calm_note:
        for r in placed + ongoing:
            r |= {"in_corridor": None, "resolution": f"not traced: {calm_note}"}
    speed = speeds[-1] if speeds[-1] is not None else speeds[0]
    nrc_cands: list[dict] = []
    if nrc_reports is not None and not calm_note:
        from pipeline import nrc  # imported here: nrc builds on this module's geometry and locate

        nrc_cands = nrc.candidates(nrc_reports, det_day, h, param, facilities, echo_rows, origin, winds_ok)
    rc = record_check(placed, details | earlier, det_day, h, search_complete=complete, param=param, ongoing=ongoing,
                      earlier_complete=earlier_complete, earlier_note=earlier_note, calm_note=calm_note,
                      speed_mph=speed, county=county,
                      unplaced_other=[c["report"] for c in nrc_cands if c["in_corridor"] is None])
    if nrc_cands:
        rc = nrc.second_source(rc, nrc_cands, param)
    name_filer(facilities, rc, echo_rows)
    disambiguate(facilities, echo["Results"]["Facilities"], rc["matched_facility_id"])
    return {"detection": det, "wind": wind, "window": winds_ok, "trig": trig, "calm_mph": calm,
            "facilities": facilities, "record_check": rc, "winds": winds}


CANNOT_SAY = [
    "A matching report is not proof the facility caused every reading; other sources can add to a spike.",
    ("'Not yet reported' is not a finding about any facility: Texas requires a report only at or above a "
     "reportable quantity, and air readings cannot measure how much was released (30 TAC 101.201)."),
    ("The upwind corridor comes from wind direction at one monitor (geometry only), not a dispersion "
     "model; it cannot tell facilities along the same bearing apart."),
    "Facility coordinates are as published by EPA ECHO and may be approximate.",
    ("Only regulator-grade monitors whose data the state publishes are used (including two industry-funded "
     "Houston Regional Monitoring sites), never low-cost sensors."),
]
# Added to cannot_say only when the corridor's wind was measured at another monitor.
BORROWED_WIND_CAVEAT = ("The wind used here was measured at a nearby monitor, not at the monitor that flagged the "
                        "spike, so the upwind direction there may differ.")


def wind_block(wind: dict | None, trig: dict, monitors: list[dict], hour_cst: int | None = None) -> dict | None:
    """event.json's wind: as loaded when it is the flagged monitor's own met-form wind (the original shape, so those
    files do not change); otherwise it also says where it came from (source, source_note). The previous day's 23:00
    (prev_hour, prev_hour_note) is kept only for a spike in hour 0, the one night that reads it."""
    if wind and hour_cst != 0 and "prev_hour_note" in wind:
        wind = {k: v for k, v in wind.items() if k not in ("prev_hour", "prev_hour_note")}
    if not wind or (wind["site_id"] == trig["site_id"] and "source" not in wind):
        return wind
    own = wind["site_id"] == trig["site_id"]
    form = wind.get("source", "met")
    if own:
        note = f"Wind: own monitor ({WIND_FORM[form]})."
    else:
        src = next((m for m in monitors if m["site_id"] == wind["site_id"]), None)
        name = src["name"] if src else wind["site_id"]
        km = f", {haversine_km((trig['lat'], trig['lon']), (src['lat'], src['lon'])):.1f} km away" if src else ""
        note = f"Wind: borrowed from {name} ({WIND_FORM[form]}){km}; {trig['name']} has no wind reading that day."
    return wind | {"source": f"{'own' if own else 'borrowed'}_{form}", "source_note": note}


def assemble_event(t: dict, monitors: list[dict], det_day: date, param: str, event_id: str,
                   provenance: list[dict], region=None) -> dict:
    """One event.json from a finished trace(). build() and pipeline.nights both call this, so a replayed night
    is the same document the demo night is. region None is Houston, the backtested region, unchanged; any other
    pipeline.regions.Region renames the place and county and labels the event with its backtest line."""
    det, wind, trig, window, facilities, rc = (t[k] for k in ("detection", "wind", "trig", "window", "facilities",
                                                               "record_check"))
    name_en = COMPOUNDS[param][0]
    tz = "CDT, CST+1" if steers_tz_offset_h(det_day) else "CST"
    return {
        "schema": SCHEMA, "label": "real", "event_id": event_id,
        "title": f"{name_en.capitalize()} spike {region.place if region else 'on the Houston Ship Channel'}",
        "date_local": det_day.isoformat(),
        "time_note": f"Monitor hours are CST as TCEQ publishes them; the company report uses local time ({tz}). "
                     "TCEQ labels AutoGC data provisional and subject to change.",
        "compound": {"name": name_en, "aqs_param": param, "units": "ppb-v"},
        "monitors": monitors, "wind": wind_block(wind, trig, monitors, det["hour_cst"]), "detection": det, "facilities": facilities, "record_check": rc,
        "corridor": {"origin_site_id": trig["site_id"], "half_width_deg": CORRIDOR_HALF_ANGLE,
                     "max_km": CORRIDOR_RADIUS_KM, "wind_from_deg": window},
        "packet": template_packet(det, monitors, wind, facilities, rc, det_day.strftime("%m/%d/%Y"), param,
                                  region.search_county_title if region else "Harris"),
        "cannot_say": (list(CANNOT_SAY) if region is None else _region_cannot_say(region))
        + ([BORROWED_WIND_CAVEAT] if wind and wind["site_id"] != trig["site_id"] else []),
        "provenance": provenance,
    } | ({} if region is None else {"region": {"key": region.key, "label": region.label, "backtested": region.backtested,
                                               "note": region.note}})


def _region_cannot_say(region) -> list[str]:
    """Houston's list minus its Houston-only monitor-network line, with the region's backtest line (if it has one)
    first."""
    return [*([region.note] if region.note else []), *(c for c in CANNOT_SAY if "Houston" not in c),
            "Only regulator-grade monitors whose data the state publishes are used, never low-cost sensors."]


def build(cfg: dict = EVENT) -> dict:
    day = cfg["day"]
    det_day = datetime.strptime(day, "%m/%d/%Y").date()
    monitors = load_monitors(cfg)
    ws = cfg["wind_site"]
    winds = {ws: load_wind(ws, cfg["year"], day)}
    # Triangulation only: other monitors' own wind, from the demo folder or else the backtest cache (same TCEQ form).
    wind_dirs = {}
    for site, *_ in cfg["monitors"]:
        for d in (RAW, RAW / "backtest"):
            if site != ws and (d / f"met_{cfg['year']}_{site}_61102.html").exists():
                winds[site], wind_dirs[site] = load_wind(site, cfg["year"], day, d), d
                break
    echo = json.loads((RAW / cfg["echo"]).read_text())
    search = steers_search(RAW / f"steers_search_harris_{day.replace('/', '')}.html")
    details = {r["incident"]: steers_incident(RAW / f"steers_{r['incident']}.html") for r in search["rows"]}
    complete = search["total"] == search["shown"] == len(details) and search["total"] < 50
    echo_rows = echo["Results"]["Facilities"] + [
        r for p in sorted(RAW.glob("echo_name_*.json")) for r in json.loads(p.read_text())["Results"]["Facilities"]]
    from pipeline import nrc

    t = trace(monitors, winds, ws, echo, echo_rows, details, complete, det_day, cfg["param"],
              nrc_reports=nrc.load("Harris"))
    if t["detection"] is None:
        raise SystemExit("no monitor crossed the trigger rule on this day; nothing to replay")
    if "record_check" not in t:
        raise SystemExit(f"no wind at {ws} for the detection hours; cannot draw a corridor")
    ev = assemble_event(t, monitors, det_day, cfg["param"], f"steers-{cfg['incident']}",
                        json.loads((RAW / "provenance.json").read_text()))
    from pipeline import triangulate  # imported here: triangulate builds on this module's geometry

    ev["triangulation"] = triangulate.triangulate(t, monitors)
    extra = triangulate.wind_files(ev["triangulation"], cfg["year"], ws)
    have = {p["file"] for p in ev["provenance"]}
    bt_prov = {p["file"]: p for p in json.loads((RAW / "backtest" / "provenance.json").read_text())}
    for f in extra:
        site = f.split("_", 2)[2].rsplit("_", 1)[0]
        key = f if wind_dirs.get(site) == RAW else f"backtest/{f}"
        if key not in have:
            if key not in bt_prov:
                raise SystemExit(f"triangulation wind file {key} has no provenance entry")
            ev["provenance"].append(bt_prov[key])
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
