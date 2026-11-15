"""Export the backtest's spike scan as the site's "Past spikes" log (schema plume-witness.spikes/v1).

One row per (day, compound) spike from data/build/backtest.json, joined with the monitor's name and TAMIS
coordinates. Rows carry counts and ids, never a facility name: a spike with no matching report must not name a
company. Re-run after the backtest changes:

    uv run python -m pipeline.backtest && uv run python -m pipeline.spikes

Another region reads its own backtest (data/build/backtest-<key>.json, from `pipeline.backtest --region <key>`);
one not backtested yet runs its spike scan here directly (same backtest.spike_scan, no candidates):

    uv run python -m pipeline.spikes --region beaumont   (writes web/public/regions/beaumont/spikes.json)
"""

import json
import math
import sys
from datetime import datetime
from pathlib import Path

from pipeline import backtest, build, regions
from pipeline.contract import STATUSES

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "build" / "backtest.json"
OUT = ROOT / "web" / "public" / "spikes.json"
SCHEMA = "plume-witness.spikes/v1"
SOURCE_SCHEMA = "plume-witness.backtest/v1"
# kn: ~363 B a row; 200 KB holds ~550 rows (12 Houston monitors give 468). Split by year past that.
MAX_BYTES = 200_000
COMPOUNDS = {"45201": "benzene", "43218": "1,3-butadiene"}
# Backtest-only outcomes where the record check never ran. Each maps to the contract status that says so, plus a
# reason shown next to it. A new backtest status fails the export until it is mapped here.
ABSTAIN = {"no_wind": ("search_incomplete", "no_wind")}
# Why a record check stopped short, as a code the web maps to a translated label, plus the English sentence. Taken in
# build.record_check's order: a day search that missed rows, wind too light for a corridor, the 30 earlier days not
# all searched, else (all searched, wind fine) a report open at that hour that could not be placed on the map.
REASONS = {
    "no_wind": "No wind data for that day, so no upwind area could be drawn.",
    "day_search_incomplete": "TCEQ's search for that week did not return every report, so absence cannot be claimed.",
    "calm_wind": "The wind was too light (under 3 mph) to tell which way the air came from, so no upwind area was "
                 "drawn and absence cannot be claimed.",
    "earlier_search_incomplete": "Reports that started in the 30 days before could not all be searched, so absence "
                                 "cannot be claimed.",
    "report_not_placed": "A report open at that hour (started that day or earlier) could not be placed on the map, "
                         "so absence cannot be claimed.",
    "no_register": "Los Angeles County has no public list of every emissions event (Cal OES and NRC reports have no "
                   "end time), so absence cannot be claimed.",
}



def incomplete_reason(s: dict) -> str:
    """The reason code for a search_incomplete backtest row (see REASONS). A region outside Texas sets its own
    (pipeline.la_replay: calm_wind or no_register)."""
    if s.get("reason_code_override"):
        return s["reason_code_override"]
    if not s.get("search_complete"):
        return "day_search_incomplete"
    if s.get("calm_mph") is not None:
        return "calm_wind"
    if not s.get("earlier_search_complete"):
        return "earlier_search_incomplete"
    return "report_not_placed"


ROW_KEYS = ("night_id", "date", "hour_cst", "site_id", "site", "lat", "lon", "param", "compound", "value_ppb",
            "baseline_ppb", "ratio", "status", "reports_that_day")
# Present only when they have a value, to keep the file under budget.
OPTIONAL_KEYS = ("reason", "reason_code", "matched_incident", "report_url")


class SpikeExportError(ValueError):
    pass


def night_id(iso_date: str, param: str, site: str) -> str:
    """Id of the per-night replay file web/public/nights/<id>.json, opened in the app with ?night=<id>."""
    return f"{iso_date}_{param}_{site}"


def spike_id(row: dict) -> str:
    """Stable id of a spike row, replay or not (feed guids, React keys). night_id is null where there is no replay."""
    return night_id(row["date"], row["param"], row["site_id"])


def _num(v: object, where: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        raise SpikeExportError(f"{where}: expected a finite number >= 0, got {v!r}")
    return float(v)


def export_row(s: dict, i: int, coords: dict[str, tuple[float, float]],
               site_names: dict[str, str] = backtest.SITE_NAMES, nights_dir: Path | None = None) -> dict:
    where = f"spikes[{i}]"
    try:
        day = datetime.strptime(s["day"], "%m/%d/%Y").date()
        site, param, hour, status = s["site_id"], s["param"], s["hour_cst"], s["status"]
    except (KeyError, TypeError, ValueError) as e:
        raise SpikeExportError(f"{where}: bad or missing day/site_id/param/hour_cst/status ({e!r})") from e
    if site not in site_names:
        raise SpikeExportError(f"{where}: unknown site_id {site!r}; add it to the region's sites first")
    if param not in COMPOUNDS:
        raise SpikeExportError(f"{where}: unknown param {param!r}; expected one of {sorted(COMPOUNDS)}")
    if not isinstance(hour, int) or isinstance(hour, bool) or not 0 <= hour <= 23:
        raise SpikeExportError(f"{where}: hour_cst must be an int 0..23, got {hour!r}")
    code = None
    if status in ABSTAIN:
        status, code = ABSTAIN[status]
    elif status == "search_incomplete":
        code = incomplete_reason(s)
    elif status not in STATUSES:
        raise SpikeExportError(f"{where}: status {status!r} is not in contract.STATUSES; map it in spikes.ABSTAIN "
                               "with a plain-language reason, or add it to the contract")
    value, base = _num(s["value"], f"{where}.value"), _num(s["baseline"], f"{where}.baseline")
    incident = s.get("matched_incident") if status == "reported" else None
    if status == "reported" and not incident:
        raise SpikeExportError(f"{where}: status 'reported' needs a matched_incident")
    lat, lon = coords[site]
    nid = night_id(day.isoformat(), param, site)
    # A day with no wind data has no night file (pipeline.nights skips it), so the log must not link to a 404.
    # nights_dir=None skips the check, for callers that never publish the row.
    has_night = nights_dir is None or (nights_dir / f"{nid}.json").is_file()
    row = {
        "night_id": nid if has_night else None, "date": day.isoformat(), "hour_cst": hour,
        "site_id": site, "site": site_names[site],
        "lat": round(lat, 5), "lon": round(lon, 5), "param": param, "compound": COMPOUNDS[param], "value_ppb": value,
        "baseline_ppb": base, "ratio": round(value / base, 1) if base > 0 else None, "status": status,
        "reason": REASONS[code] if code else None, "reason_code": code, "reports_that_day": int(s.get("day_reports") or 0), "matched_incident": incident,
        "report_url": build.STEERS_URL.format(incident) if incident else None,
    }
    return {k: v for k, v in row.items() if k in ROW_KEYS or v is not None}


def export(bt: dict, coords: dict[str, tuple[float, float]], region: regions.Region = regions.HOUSTON) -> dict:
    if bt.get("schema") != SOURCE_SCHEMA:
        raise SpikeExportError(f"backtest schema is {bt.get('schema')!r}, expected {SOURCE_SCHEMA}; "
                               "re-run `uv run python -m pipeline.backtest`")
    spikes = bt.get("spikes")
    # A not-backtested region with no reading above the trigger is a real result (an empty log), not a broken file.
    if not isinstance(spikes, list) or (not spikes and region is regions.HOUSTON):
        raise SpikeExportError("backtest.json has no 'spikes' list; re-run `uv run python -m pipeline.backtest`")
    rows = [export_row(s, i, coords, region.sites, region.nights_out) for i, s in enumerate(spikes)]
    rows.sort(key=lambda r: (r["date"], r["hour_cst"], r["site_id"], r["param"]))
    # A missing night file is expected only for the no-wind abstentions; any other gap means nights were not regenerated.
    stray = [spike_id(r) for r in rows if r["night_id"] is None and r.get("reason_code") != "no_wind"]
    if stray:
        raise SpikeExportError(f"no night file for {stray[:3]}; run `uv run python -m pipeline.nights"
                               f"{'' if region is regions.HOUSTON else ' --region ' + region.key}` first")
    ss = bt.get("spike_summary") or {}
    if ss.get("spikes") not in (None, len(rows)):
        raise SpikeExportError(f"spike_summary.spikes={ss.get('spikes')} but {len(rows)} rows; backtest.json is "
                               "inconsistent, re-run the backtest")
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    rules = bt.get("rules") or {}
    # Houston's file keeps its exact shape; another region says up front that nothing here is backtested.
    head = {} if region is regions.HOUSTON else {
        "region": {"key": region.key, "label": region.label, "county": region.county_title,
                   "backtested": region.backtested, "note": region.note}}
    return {
        "schema": SCHEMA, **head,
        "generated_by": "uv run python -m pipeline.spikes",
        "source": bt.get("source", "data/build/backtest.json"),
        "trigger": rules.get("trigger") or f"value >= max({build.TRIGGER_RATIO:g} x 7-day median baseline, "
                                             f"{build.TRIGGER_FLOOR_PPB:g} ppb)",
        "corridor": rules.get("corridor"),
        "years": rules.get("years"),
        "units": "ppb (parts per billion), hourly AutoGC values as TCEQ publishes them (provisional)",
        "tceq_search_page": build.STEERS_SEARCH,
        "summary": {
            "spikes": len(rows), "spike_days": len({r["date"] for r in rows}), "by_status": by_status,
            # Ground truth from the backtest: "no report" rows where a company report we know of was in the corridor.
            "known_missed_reports": ss.get("false_no_report"),
        },
        "rows": rows,
    }


def region_scan(region: regions.Region) -> tuple[dict, dict[str, tuple[float, float]]]:
    """A backtest.json-shaped spike scan for a region with no backtest: same trigger, corridor and record check,
    no candidate set, so there is no ground truth (known_missed_reports stays None)."""
    raw = region.raw
    coords = {s: backtest.site_coords(s, raw) for s in region.sites}
    universe, incomplete = backtest.load_universe(raw)
    echo_site, echo_rows = backtest.load_echo(raw)
    rows_by_day: dict[str, list[dict]] = {}
    for r in universe:
        rows_by_day.setdefault(r["began"][:10], []).append(r)
    rows = backtest.spike_scan(coords, rows_by_day, echo_site, echo_rows, incomplete, [], raw, region.search_county_title)
    rules = {"years": list(backtest.YEARS),
             "trigger": f"value >= max({build.TRIGGER_RATIO:g} x {build.BASELINE_DAYS}-day median, "
                        f"{build.TRIGGER_FLOOR_PPB:g} ppb), earliest hour of the day",
             "corridor": f"+/-{build.CORRIDOR_HALF_ANGLE} deg of upwind, <= {build.CORRIDOR_RADIUS_KM} km"}
    bt = {"schema": SOURCE_SCHEMA, "source": f"{raw.relative_to(ROOT)} (spike scan)",
          "rules": rules, "spikes": rows, "spike_summary": {"spikes": len(rows), "false_no_report": None},
          "incomplete_week_searches": incomplete}
    return bt, coords


def source(region: regions.Region = regions.HOUSTON) -> tuple[dict, dict[str, tuple[float, float]]]:
    """(backtest.json-shaped dict, site coords): the region's own backtest if it has one, else a fresh spike scan."""
    if region.backtested:
        src = backtest.out_paths(region)[0]
        try:
            bt = json.loads(src.read_text())
        except FileNotFoundError as e:
            raise SystemExit(f"{src} not found; run `{backtest.command(region)}` first") from e
        if region is not regions.HOUSTON:
            if bt.get("region") != region.key:
                raise SystemExit(f"{src} is not {region.key}'s backtest; rerun `{backtest.command(region)}`")
            bt["source"] = src.relative_to(ROOT).as_posix()
        coords = {s: backtest.site_coords(s, region.raw) for s in region.sites}
    else:
        bt, coords = region_scan(region)
    return bt, coords


def main(region: regions.Region = regions.HOUSTON) -> None:
    out = export(*source(region), region)
    text = dumps(out)
    size = len(text.encode())
    if size > MAX_BYTES:
        raise SystemExit(f"spikes.json would be {size} bytes, over the {MAX_BYTES} budget; drop fields or split it")
    dest = region.spikes_out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print(f"wrote {dest.relative_to(ROOT)}: {len(out['rows'])} rows, {size} bytes, by status {out['summary']['by_status']}")


def dumps(out: dict) -> str:
    return json.dumps(out, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main(regions.get(sys.argv[2]) if sys.argv[1:2] == ["--region"] else regions.HOUSTON)
