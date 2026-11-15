"""Export the backtest's spike scan as the site's "Past spikes" log (schema plume-witness.spikes/v1).

One row per (day, compound) spike from data/build/backtest.json, joined with the monitor's name and TAMIS
coordinates. Rows carry counts and ids, never a facility name: a spike with no matching report must not name a
company. Re-run after the backtest changes:

    uv run python -m pipeline.backtest && uv run python -m pipeline.spikes
"""

import json
import math
from datetime import datetime
from pathlib import Path

from pipeline import backtest, build
from pipeline.contract import STATUSES

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "build" / "backtest.json"
OUT = ROOT / "web" / "public" / "spikes.json"
SCHEMA = "plume-witness.spikes/v1"
SOURCE_SCHEMA = "plume-witness.backtest/v1"
MAX_BYTES = 150_000
COMPOUNDS = {"45201": "benzene", "43218": "1,3-butadiene"}
# Backtest-only outcomes where the record check never ran. Each maps to the contract status that says so, plus a
# reason shown next to it. A new backtest status fails the export until it is mapped here.
ABSTAIN = {"no_wind": ("search_incomplete", "No wind data for that day, so no upwind area could be drawn.")}
# Why a record check stopped short, from what the backtest row says (build.record_check needs both to claim absence).
INCOMPLETE_REASON = {False: "TCEQ's search for that week did not return every report, so absence cannot be claimed.",
                     True: "A report filed that day could not be placed on the map, so absence cannot be claimed."}
ROW_KEYS = ("night_id", "date", "hour_cst", "site_id", "site", "lat", "lon", "param", "compound", "value_ppb",
            "baseline_ppb", "ratio", "status", "reports_that_day")
# Present only when they have a value, to keep the file under budget.
OPTIONAL_KEYS = ("reason", "matched_incident", "report_url")


class SpikeExportError(ValueError):
    pass


def night_id(iso_date: str, param: str, site: str) -> str:
    """Id of the per-night replay file web/public/nights/<id>.json, opened in the app with ?night=<id>."""
    return f"{iso_date}_{param}_{site}"


def _num(v: object, where: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        raise SpikeExportError(f"{where}: expected a finite number >= 0, got {v!r}")
    return float(v)


def export_row(s: dict, i: int, coords: dict[str, tuple[float, float]]) -> dict:
    where = f"spikes[{i}]"
    try:
        day = datetime.strptime(s["day"], "%m/%d/%Y").date()
        site, param, hour, status = s["site_id"], s["param"], s["hour_cst"], s["status"]
    except (KeyError, TypeError, ValueError) as e:
        raise SpikeExportError(f"{where}: bad or missing day/site_id/param/hour_cst/status ({e!r})") from e
    if site not in backtest.SITE_NAMES:
        raise SpikeExportError(f"{where}: unknown site_id {site!r}; add it to backtest.SITE_NAMES first")
    if param not in COMPOUNDS:
        raise SpikeExportError(f"{where}: unknown param {param!r}; expected one of {sorted(COMPOUNDS)}")
    if not isinstance(hour, int) or isinstance(hour, bool) or not 0 <= hour <= 23:
        raise SpikeExportError(f"{where}: hour_cst must be an int 0..23, got {hour!r}")
    reason = None
    if status in ABSTAIN:
        status, reason = ABSTAIN[status]
    elif status == "search_incomplete":
        reason = INCOMPLETE_REASON[bool(s.get("search_complete"))]
    elif status not in STATUSES:
        raise SpikeExportError(f"{where}: status {status!r} is not in contract.STATUSES; map it in spikes.ABSTAIN "
                               "with a plain-language reason, or add it to the contract")
    value, base = _num(s["value"], f"{where}.value"), _num(s["baseline"], f"{where}.baseline")
    incident = s.get("matched_incident") if status == "reported" else None
    if status == "reported" and not incident:
        raise SpikeExportError(f"{where}: status 'reported' needs a matched_incident")
    lat, lon = coords[site]
    row = {
        "night_id": night_id(day.isoformat(), param, site), "date": day.isoformat(), "hour_cst": hour,
        "site_id": site, "site": backtest.SITE_NAMES[site],
        "lat": round(lat, 5), "lon": round(lon, 5), "param": param, "compound": COMPOUNDS[param], "value_ppb": value,
        "baseline_ppb": base, "ratio": round(value / base, 1) if base > 0 else None, "status": status,
        "reason": reason, "reports_that_day": int(s.get("day_reports") or 0), "matched_incident": incident,
        "report_url": build.STEERS_URL.format(incident) if incident else None,
    }
    return {k: v for k, v in row.items() if k in ROW_KEYS or v is not None}


def export(bt: dict, coords: dict[str, tuple[float, float]]) -> dict:
    if bt.get("schema") != SOURCE_SCHEMA:
        raise SpikeExportError(f"backtest schema is {bt.get('schema')!r}, expected {SOURCE_SCHEMA}; "
                               "re-run `uv run python -m pipeline.backtest`")
    spikes = bt.get("spikes")
    if not isinstance(spikes, list) or not spikes:
        raise SpikeExportError("backtest.json has no 'spikes' list; re-run `uv run python -m pipeline.backtest`")
    rows = [export_row(s, i, coords) for i, s in enumerate(spikes)]
    rows.sort(key=lambda r: (r["date"], r["hour_cst"], r["site_id"], r["param"]))
    ss = bt.get("spike_summary") or {}
    if ss.get("spikes") not in (None, len(rows)):
        raise SpikeExportError(f"spike_summary.spikes={ss.get('spikes')} but {len(rows)} rows; backtest.json is "
                               "inconsistent, re-run the backtest")
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    rules = bt.get("rules") or {}
    return {
        "schema": SCHEMA,
        "generated_by": "uv run python -m pipeline.spikes",
        "source": "data/build/backtest.json",
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


def main() -> None:
    try:
        bt = json.loads(SRC.read_text())
    except FileNotFoundError as e:
        raise SystemExit(f"{SRC} not found; run `uv run python -m pipeline.backtest` first") from e
    coords = {s: backtest.site_coords(s) for s in backtest.SITE_NAMES}
    out = export(bt, coords)
    text = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    size = len(text.encode())
    if size > MAX_BYTES:
        raise SystemExit(f"spikes.json would be {size} bytes, over the {MAX_BYTES} budget; drop fields or split it")
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out['rows'])} rows, {size} bytes")


if __name__ == "__main__":
    main()
