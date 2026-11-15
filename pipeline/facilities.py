"""Facility history files: one per EPA ECHO major air facility within 15 km of a Ship Channel monitor, for reporters
and watchdog analysts who want to cite what a facility has on the public record.

Each file (schema plume-witness.facility/v1) holds only things the facility or an agency published:
  - the emissions-event reports it filed with TCEQ (STEERS) that started in 2024-2025, from the cached detail pages,
  - its EPA TRI yearly benzene / 1,3-butadiene air totals (copied from web/public/tri.json),
  - the replayed nights where it sat in the upwind corridor AND its own report matched (status "reported").
It never lists nights where a facility was upwind and no report matched: one monitor's wind cannot tell facilities
apart, so that list would read as blame. tests/test_facilities.py fails the build if such a field appears.

Usage: uv run python -m pipeline.facilities     (cache only, no network; writes web/public/facilities/)
"""

import json
import re
from datetime import datetime
from pathlib import Path

from pipeline import backtest, build, tri
from pipeline.parse import _text, lbs_by_param

ROOT = Path(__file__).resolve().parent.parent
BT = backtest.BT
OUT_DIR = ROOT / "web" / "public" / "facilities"
TRI_JSON = ROOT / "web" / "public" / "tri.json"
NIGHTS = ROOT / "web" / "public" / "nights"
SCHEMA = "plume-witness.facility/v1"
INDEX_SCHEMA = "plume-witness.facilities-index/v1"
YEARS = ("2024", "2025")
CAUSE_MAX = 200
# Words this project never uses about a facility. A STEERS cause text is the company's own prose; if it contains one,
# the excerpt is withheld (the TCEQ link carries the full text) rather than republished under our name.
BANNED = re.compile(r"\b(illegal|violations?|unreported|caught|polluters?|proves?)\b", re.IGNORECASE)
CAVEATS = [
    "Being upwind of a spike is not evidence of anything; wind at one monitor cannot tell facilities apart.",
    ("Reports listed here are what the facility reported to the state (TCEQ STEERS); amounts are the facility's own "
     "estimates."),
    ("TRI figures are what the facility reports to EPA each year for routine releases; they are estimates, not "
     "measurements, and not events."),
]
# tri.json's "tri_id_no_reports" means no TRI form, but on a facility page "no reports" reads as a claim about events.
TRI_STATUS = {"tri_id_no_reports": "linked_no_benzene_or_butadiene_form"}
CAUSE_WITHHELD = "Cause text not reproduced here; read it in the TCEQ record."


class FacilityError(ValueError):
    pass


def clean(s: str) -> str:
    """Untrusted text from a web page: printable, single-spaced, no angle brackets."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f<>]", " ", s)).strip()


def excerpt(text: str, limit: int = CAUSE_MAX) -> str:
    """At most `limit` characters, cut at a word boundary with an ellipsis when shortened."""
    text = clean(text)
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:.-")
    return f"{cut}…"


def cause_excerpt(cause: str | None) -> tuple[str, bool]:
    """(text, withheld). Banned wording anywhere in the full cause text withholds the excerpt."""
    if not cause:
        return "No cause text on the TCEQ record.", False
    if BANNED.search(cause):
        return CAUSE_WITHHELD, True
    return excerpt(cause), False


def _stamp(s: str) -> str:
    return datetime.strptime(s, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes")


def report_summary(path: Path) -> dict:
    """The fields a facility page shows from one STEERS detail page. Raises FacilityError naming the file when
    the page no longer has the labels this reads, so a TCEQ format change cannot silently empty a page."""
    t = re.sub(r"\s+", " ", _text(path))

    def grab(pattern: str, what: str) -> str:
        m = re.search(pattern, t)
        if not m:
            raise FacilityError(f"{path.name}: no {what}; the STEERS page format may have changed")
        return m.group(1).strip()

    stamp = r"(\d{2}/\d{2}/\d{4} \d{2}:\d{2} [AP]M)"
    lbs = lbs_by_param(t)
    cause = re.search(r"Reason for Scheduled Activity: (.*?) Actions Taken", t)
    text, withheld = cause_excerpt(cause.group(1) if cause else None)
    out = {
        "incident": path.stem.split("_")[-1],
        "event_type": grab(r"Event/Activity Type: (.+?) Date and Time", "event type").title(),
        "start_local": _stamp(grab(rf"Scheduled Activity Start: {stamp}", "start time")),
        "end_local": _stamp(grab(rf"Scheduled Activity Ended: {stamp}", "end time")),
        "benzene_lbs": float(lbs["45201"]),
        "butadiene_lbs": float(lbs["43218"]),
        "cause_excerpt": text,
        "url": build.STEERS_URL.format(path.stem.split("_")[-1]),
    }
    if withheld:
        out["cause_withheld"] = True
    return out


def meta(path: Path) -> dict:
    """Entity and address as the STEERS page prints them, used only to place the report on an ECHO facility."""
    t = re.sub(r"\s+", " ", _text(path))
    ent = re.search(r"Regulated Entity Name: (.+?) RN:", t)
    loc = re.search(r"Physical Location: (.+?) County:", t)
    if not ent:
        raise FacilityError(f"{path.name}: no Regulated Entity Name; the STEERS page format may have changed")
    return {"entity": ent.group(1).strip(), "address": loc.group(1).strip() if loc else ""}


def load_echo_rows() -> list[dict]:
    _, rows = backtest.load_echo()
    return rows + json.loads((ROOT / "data" / "raw" / "echo_milby_8mi.json").read_text())["Results"]["Facilities"]


def place_reports(area_ids: set[str], echo_rows: list[dict], raw: Path = BT) -> tuple[dict[str, list[dict]], dict]:
    """Cached STEERS detail pages -> {RegistryID: [report summaries]} for the area's majors, plus coverage counts.

    A report is placed only when backtest.locate finds exactly one ECHO site (exact name, then street address);
    an ambiguous or unknown one is counted, never guessed."""
    universe, _ = backtest.load_universe(raw)
    by_fac: dict[str, list[dict]] = {}
    cov = {"search_rows": len(universe), "detail_pages_cached": 0, "outside_2024_2025": 0, "placed_on_a_major": 0,
           "placed_elsewhere": 0, "not_placed": 0}
    for r in universe:
        p = raw / f"steers_{r['incident']}.html"
        if not p.exists():
            continue
        cov["detail_pages_cached"] += 1
        s = report_summary(p)
        if s["start_local"][:4] not in YEARS:
            cov["outside_2024_2025"] += 1
            continue
        m = meta(p)
        fac, _how = backtest.locate(m["entity"], m["address"], echo_rows)
        if fac is None:
            cov["not_placed"] += 1
        elif fac["RegistryID"] in area_ids:
            cov["placed_on_a_major"] += 1
            by_fac.setdefault(fac["RegistryID"], []).append(s)
        else:
            cov["placed_elsewhere"] += 1
    for lst in by_fac.values():
        lst.sort(key=lambda s: (s["start_local"], s["incident"]))
    return by_fac, cov


def matched_nights(by_fac: dict[str, list[dict]], nights: Path = NIGHTS) -> dict[str, list[dict]]:
    """Nights where the facility was in the upwind corridor and its own report was the match (status 'reported').

    The pipeline's matched facility must be the facility this module placed the incident on; if the two ever
    disagree the build stops, because a night listed on the wrong page would be a false statement."""
    own = {s["incident"]: rid for rid, lst in by_fac.items() for s in lst}
    out: dict[str, list[dict]] = {}
    for row in json.loads((nights / "index.json").read_text()):
        if row["status"] != "reported":
            continue
        n = json.loads((nights / f"{row['id']}.json").read_text())
        rc = n["record_check"]
        rid, inc = rc["matched_facility_id"], rc["incident"]
        if rc["status"] != "reported" or not rid or not inc:
            raise FacilityError(f"{row['id']}: index says reported but the night file has no matched report")
        if own.get(inc) != rid:
            raise FacilityError(f"{row['id']}: pipeline matched incident {inc} to facility {rid}, but the report "
                                f"is placed on {own.get(inc)}; fix the placement before publishing this page")
        f = next((x for x in n["facilities"] if x["id"] == rid and x["in_corridor"]), None)
        if f is None:
            raise FacilityError(f"{row['id']}: matched facility {rid} is not in that night's upwind corridor")
        out.setdefault(rid, []).append({
            "night_id": row["id"], "date": n["date_local"], "hour_cst": n["detection"]["hour_cst"],
            "monitor": row["site_name"], "compound": n["compound"]["name"], "value_ppb": n["detection"]["value"],
            "incident": inc, "distance_km": f["distance_km"], "bearing_deg": f["bearing_deg"],
        })
    for lst in out.values():
        lst.sort(key=lambda x: x["night_id"])
    return out


def tri_block(entry: dict) -> dict:
    """The TRI facts for one facility, as tri.json holds them (already pounds, already cleaned)."""
    return {
        "status": TRI_STATUS.get(entry["status"], entry["status"]), "reason": entry["reason"], "tri_ids": entry["tri_ids"],
        "years": entry["years"], "source": "EPA Toxics Release Inventory via Envirofacts",
        "note": "Pounds per year, stack plus fugitive air releases; a null means the form gave no number.",
    }


def build_files() -> tuple[dict[str, dict], dict]:
    area, _ = tri.load_area()
    tri_json = json.loads(TRI_JSON.read_text())
    area_ids = {r["RegistryID"] for r in area}
    missing = area_ids ^ set(tri_json["facilities"])
    if missing:
        raise FacilityError(f"tri.json and the ECHO area disagree on {len(missing)} facilities; "
                            "run `uv run python -m pipeline.tri` first")
    by_fac, cov = place_reports(area_ids, load_echo_rows())
    nights = matched_nights(by_fac)
    files = {}
    for r in area:
        rid, t = r["RegistryID"], tri_json["facilities"][r["RegistryID"]]
        reports = by_fac.get(rid, [])
        files[rid] = {
            "schema": SCHEMA, "registry_id": rid, "name": clean(r["AIRName"]),
            "address": ", ".join(x for x in (clean(r.get("AIRStreet") or ""), clean(r.get("AIRCity") or "")) if x),
            "lat": round(float(r["FacLat"]), 5), "lon": round(float(r["FacLong"]), 5),
            "distance_km": r["_dist_km"], "nearest_monitor": r["_near"], "echo_url": t["link"],
            "reports_to_state": {
                "source": "TCEQ Air Emission Event Report Database (STEERS), cached detail pages",
                "years": list(YEARS), "count": len(reports), "reports": reports,
            },
            "reports_to_epa": tri_block(t),
            "matched_nights": nights.get(rid, []),
            "caveats": CAVEATS,
        }
    return files, cov


def index_rows(files: dict[str, dict]) -> list[dict]:
    rows = [{
        "id": f["registry_id"], "name": f["name"], "address": f["address"], "distance_km": f["distance_km"],
        "nearest_monitor": f["nearest_monitor"], "reports": f["reports_to_state"]["count"],
        "tri_years": sum(1 for y in f["reports_to_epa"]["years"].values() if y),
        "matched_nights": len(f["matched_nights"]),
    } for f in files.values()]
    return sorted(rows, key=lambda r: (r["name"].lower(), r["id"]))


def dumps(obj: object) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=True) + "\n"


def write(files: dict[str, dict], cov: dict, out_dir: Path = OUT_DIR) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()
    for rid, f in files.items():
        (out_dir / f"{rid}.json").write_text(dumps(f))
    rows = index_rows(files)
    index = {
        "schema": INDEX_SCHEMA, "generated_by": "uv run python -m pipeline.facilities",
        "universe": "EPA ECHO 'Major Emissions' air facilities within 15 km of any of the 8 AutoGC monitors",
        "report_years": list(YEARS), "coverage": cov, "caveats": CAVEATS, "facilities": rows,
    }
    (out_dir / "index.json").write_text(dumps(index))
    return index


def main() -> None:
    files, cov = build_files()
    index = write(files, cov)
    size = sum(p.stat().st_size for p in OUT_DIR.glob("*.json"))
    print(f"{len(files)} facilities, {sum(r['reports'] for r in index['facilities'])} reports, "
          f"{sum(r['matched_nights'] for r in index['facilities'])} matched nights, {size:,} bytes; coverage {cov}")


if __name__ == "__main__":
    main()
