"""Replay any night: one contract-valid event.json for every spike night in the backtest scan.

Same code path as the demo night: backtest.traced_spikes runs build.trace, build.assemble_event writes the
document, contract.validate gates it. Nothing here re-implements detection, corridor or the record check.

Usage: uv run python -m pipeline.nights   (reads data/raw/backtest; writes web/public/nights/*.json + index.json)
       uv run python -m pipeline.nights --region beaumont   (data/raw/region_beaumont -> web/public/regions/beaumont/nights)
Re-run it whenever detection, the record check or the status rules change: the files are derived data.
"""

import json
import shutil
import sys
from pathlib import Path

from pipeline import backtest, build, regions, triangulate
from pipeline.contract import validate

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "nights"
BT = backtest.BT
MAX_TOTAL_BYTES = 25_000_000


def night_id(day: str, param: str, site: str) -> str:
    """YYYY-MM-DD_<aqs param>_<site>; one (day, compound) spike has exactly one triggering site."""
    mm, dd, yyyy = day.split("/")
    return f"{yyyy}-{mm}-{dd}_{param}_{site}"


def _prov_index(raw: Path = BT) -> dict[str, dict]:
    return {e["file"]: e for e in json.loads((raw / "provenance.json").read_text())}


def provenance_for(sp: dict, wind: dict, rows_by_day: dict, prov: dict[str, dict],
                   ledger_dir: str = "backtest") -> list[dict]:
    """Provenance entries (url, sha256, fetch time) for the cached files this night was built from."""
    day, param, year = sp["day"], sp["param"], sp["day"][-4:]
    files = [f"agc_{year}_{m['site_id']}_{param}.html" for m in sp["monitors"]]
    files += [f"tamis_{m['site_id']}.html" for m in sp["monitors"]]
    files += build.wind_files(wind["site_id"], year, wind.get("source", "met"))
    files.append(f"echo_{sp['det']['site_id']}_10mi.json")
    files += sorted({r["search_file"] for r in rows_by_day.get(day, [])} | {
        r["search_file"] for rs in rows_by_day.values() for r in rs if r["incident"] in sp["details"]})
    files += [f"steers_{i}.html" for i in sorted(sp["details"])]
    open_ids = {d["incident"] for d in sp["trace"].get("record_check", {}).get("ongoing_incidents", [])}
    files += sorted({r["search_file"] for rs in rows_by_day.values() for r in rs if r["incident"] in open_ids})
    files += [f"steers_{i}.html" for i in sorted(open_ids)]
    missing = [f for f in files if f"{ledger_dir}/{f}" not in prov]
    if missing:
        raise ValueError(f"{day} {param}: no provenance entry for {missing}; re-fetch or fix provenance.json")
    return [prov[f"{ledger_dir}/{f}"] for f in files]


def load_context(raw: Path = BT, site_ids=backtest.SITE_NAMES) -> dict:
    sites = {s: backtest.site_coords(s, raw) for s in site_ids}
    universe, incomplete = backtest.load_universe(raw)
    echo_site, echo_rows = backtest.load_echo(raw)
    rows_by_day: dict[str, list[dict]] = {}
    for r in universe:
        rows_by_day.setdefault(r["began"][:10], []).append(r)
    return {"sites": sites, "rows_by_day": rows_by_day, "echo_site": echo_site, "echo_rows": echo_rows,
            "incomplete": incomplete, "prov": _prov_index(raw)}


def generate(raw: Path | None = None, region: regions.Region = regions.HOUSTON) -> tuple[list[tuple[dict, dict]], list[dict]]:
    """(event, index row) for every spike that can be drawn, and the spikes skipped with the reason.

    Houston (the default) is built exactly as before; another region's events carry its place, county and the
    not-backtested label."""
    raw = raw or region.raw
    ctx = load_context(raw, region.sites)
    labeled = None if region is regions.HOUSTON else region
    nights, skipped = [], []
    for sp in backtest.traced_spikes(ctx["sites"], ctx["rows_by_day"], ctx["echo_site"], ctx["echo_rows"],
                                     ctx["incomplete"], raw, full=True, county=region.county_title):
        t, det = sp["trace"], sp["det"]
        nid = night_id(sp["day"], sp["param"], det["site_id"])
        if "record_check" not in t:
            skipped.append({"id": nid, "reason": "no wind for the detection hours; cannot draw a corridor"})
            continue
        prov = provenance_for(sp, t["wind"], ctx["rows_by_day"], ctx["prov"], raw.name)
        ev = build.assemble_event(t, sp["monitors"], sp["det_day"], sp["param"], nid, prov, labeled)
        ev["triangulation"] = triangulate.triangulate(t, sp["monitors"])
        extra = triangulate.wind_files(ev["triangulation"], sp["day"][-4:], t["wind"]["site_id"], t["winds"])
        missing = [f for f in extra if f"{raw.name}/{f}" not in ctx["prov"]]
        if missing:
            raise ValueError(f"{nid}: no provenance entry for triangulation wind {missing}")
        ev["provenance"] += [ctx["prov"][f"{raw.name}/{f}"] for f in extra]
        errs = validate(ev)
        if errs:
            raise ValueError(f"{nid} failed the contract:\n- " + "\n- ".join(errs))
        rc = ev["record_check"]
        index_row = {"id": nid, "date": ev["date_local"], "site": det["site_id"],
                     "site_name": t["trig"]["name"], "compound": ev["compound"]["name"],
                     "value": det["value"], "hour_cst": det["hour_cst"], "status": rc["status"],
                     "search_complete": sp["complete"]}
        nights.append((ev, index_row))
    nights.sort(key=lambda p: (p[1]["date"], p[1]["compound"], p[1]["site"]))
    return nights, skipped


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def write(nights: list[tuple[dict, dict]], out: Path = OUT, cap: int = MAX_TOTAL_BYTES) -> dict:
    """Write every night, or the top N by value if the total would pass `cap` bytes (reported, never silent)."""
    blobs = [(dumps(ev), row) for ev, row in nights]
    total = sum(len(b.encode()) for b, _ in blobs)
    dropped = 0
    if total > cap:
        blobs.sort(key=lambda p: -p[1]["value"])
        kept, size = [], 0
        for b, row in blobs:
            if size + len(b.encode()) > cap:
                break
            kept.append((b, row))
            size += len(b.encode())
        dropped, blobs, total = len(blobs) - len(kept), sorted(kept, key=lambda p: (p[1]["date"], p[1]["id"])), size
    if out.exists():
        shutil.rmtree(out)  # stale nights from an earlier run must not linger next to the new index
    out.mkdir(parents=True)
    for b, row in blobs:
        (out / f"{row['id']}.json").write_text(b)
    index = [row for _, row in blobs]
    (out / "index.json").write_text(dumps(index))
    return {"written": len(blobs), "dropped_over_cap": dropped, "bytes": total}


if __name__ == "__main__":
    region = regions.get(sys.argv[2]) if sys.argv[1:2] == ["--region"] else regions.HOUSTON
    nights, skipped = generate(region=region)
    stats = write(nights, region.nights_out)
    by_status: dict[str, int] = {}
    for _, row in nights:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    print(json.dumps({"nights": stats, "by_status": by_status, "skipped": skipped}, indent=1))
    sys.exit(0)
