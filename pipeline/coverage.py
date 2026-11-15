"""Every Texas AutoGC monitor and every Los Angeles Rule 1180 station, and what the site has for each:
web/public/coverage.json.

The monitor list is the TCEQ AutoGC yearly-summary form (data/raw/texas_coverage/agc_form.html, 45 sites). Each site
is in one region (pipeline.regions) or in NO_DATA_SITES; a form site in neither fails the build, so a monitor TCEQ adds
cannot drop out of the page unseen. Spike counts are read back from each region's published spikes.json.
Los Angeles (area "los_angeles") is the South Coast AQMD Rule 1180 stations (pipeline.la1180): counted with the same
build.detect, listed with no region (nothing there is replayed) and no wind (the public files carry none).

    uv run python -m pipeline.coverage   (after pipeline.spikes for every region)
"""

import html
import json
import re
from datetime import date
from pathlib import Path

from pipeline import backtest, build, la1180, regions
from pipeline.parse import hourly_table

OUT = regions.WEB_PUBLIC / "coverage.json"
FORM = regions.COVERAGE_RAW / "agc_form.html"
TRIGGER = (f"value >= max({build.TRIGGER_RATIO:g} x {build.BASELINE_DAYS}-day median, "
           f"{build.TRIGGER_FLOOR_PPB:g} ppb)")
YEARS = tuple(int(y) for y in backtest.YEARS)
PARAMS = {"45201": "max_benzene_ppb", "43218": "max_butadiene_ppb"}


def form_sites(path: Path = FORM) -> dict[str, str]:
    """AQS id -> name as the AutoGC form lists it, without its bracketed map codes ("Oyster Creek [29]")."""
    t = path.read_text(encoding="latin-1")
    out = {}
    for site, label in re.findall(r"value='(48_\d{3}_\d{4})'\s*>([^<]+)", t):
        out[site] = re.sub(r"\s*\[[^\]]*\]", "", html.unescape(label)).replace("\xa0", " ").strip()
    if not out:
        raise ValueError(f"{path.name}: no AutoGC sites found; the TCEQ form layout may have changed")
    return out


def region_of(site: str) -> regions.Region | None:
    return next((r for r in regions.REGIONS.values() if site in r.sites), None)


def _table(path: Path) -> dict[str, list[float | None]]:
    try:
        return hourly_table(path)
    except (FileNotFoundError, ValueError):  # no file or a "no data found" page: no hourly values
        return {}


def _values(raw: Path, site: str, year: int, param: str) -> list[float]:
    return [v for vals in _table(raw / f"agc_{year}_{site}_{param}.html").values() for v in vals if v is not None]


def _has_wind(raw: Path, site: str, source: str) -> bool:
    for year in YEARS:
        speed, direction = (_table(raw / f) for f in build.wind_files(site, str(year), source))
        if any(v is not None for vals in direction.values() for v in vals) and speed:
            return True
    return False


def wind_source(region: regions.Region, site: str) -> str | None:
    """Where the site's corridor wind comes from, by the pipeline's order (build.own_wind, backtest.load_winds):
    met form, else the AutoGC form's resultant wind, else borrowed from the nearest region site that has its own."""
    for source in build.WIND_SOURCES:
        if _has_wind(region.raw, site, source):
            return source
    others = [s for s in region.sites if s != site and any(_has_wind(region.raw, s, w) for w in build.WIND_SOURCES)]
    return "borrowed" if others else None


def _spike_rows(region: regions.Region) -> list[dict]:
    return json.loads(region.spikes_out.read_text())["rows"]


def build_coverage(today: str | None = None) -> dict:
    listed = form_sites()
    known = set(regions.ALL_SITE_NAMES) | set(regions.NO_DATA_SITES)
    if set(listed) != known:
        raise ValueError(f"AutoGC form sites and pipeline.regions disagree: only on the form "
                         f"{sorted(set(listed) - known)}, only in regions {sorted(known - set(listed))}")
    rows_by_region = {k: _spike_rows(r) for k, r in regions.REGIONS.items()}
    sites = []
    for site in sorted(listed):
        region = region_of(site)
        raw = region.raw if region else regions.COVERAGE_RAW
        lat, lon = backtest.site_coords(site, raw)
        maxima, years = {}, set()
        for param, key in PARAMS.items():
            vals = []
            for year in YEARS:
                v = _values(raw, site, year, param)
                years |= {year} if v else set()
                vals += v
            maxima[key] = max(vals) if vals else None
        has_data = bool(years)
        if has_data != (region is not None):
            raise ValueError(f"{site}: has_data={has_data} but region={region and region.key}; move it between a "
                             "region and regions.NO_DATA_SITES")
        rows = [r for r in rows_by_region[region.key] if r["site_id"] == site] if region else []
        by_status: dict[str, int] = {}
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        sites.append({
            "site_id": site, "name": region.sites[site] if region else regions.NO_DATA_SITES[site],
            "county": regions.site_county(site).title(), "region_key": region.key if region else None,
            "lat": round(lat, 6), "lon": round(lon, 6), "has_data": has_data,
            "wind_source": wind_source(region, site) if region else None, "years": sorted(years),
            **maxima, "spikes": len(rows), "by_status": dict(sorted(by_status.items())), "area": "texas",
        })
    return {"generated": today or date.today().isoformat(), "trigger": TRIGGER, "sites": sites + la_sites()}


def la_sites() -> list[dict]:
    """The Rule 1180 stations, in file-code order, with their rows of the Los Angeles spike log (pipeline.la_replay).
    Wind is "borrowed" where an airport weather station lies within the borrow cap (the replay's only wind)."""
    from pipeline import la_replay  # imported here: la_replay builds on regions and spikes

    places, summary = la1180.stations(), la1180.summary()
    airports = la_replay.read_asos()
    rows = _spike_rows(regions.LOS_ANGELES)
    out = []
    for code, (name, lat, lon) in places.items():
        s = summary[code]
        mine = [r for r in rows if r["site_id"] == code]
        if len(mine) != len(s["spikes"]):
            raise ValueError(f"{code}: {len(s['spikes'])} spikes in la1180 but {len(mine)} in the spike log; rerun "
                             "`uv run python -m pipeline.la_replay`")
        by_status: dict[str, int] = {}
        for r in mine:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        near = min(build.haversine_km((lat, lon), (a["lat"], a["lon"])) for a in airports.values())
        out.append({
            "site_id": f"r1180_{code}", "name": name, "county": la1180.COUNTY, "region_key": regions.LOS_ANGELES.key,
            "lat": round(lat, 6), "lon": round(lon, 6), "has_data": bool(s["years"]),
            "wind_source": "borrowed" if near <= backtest.BORROW_MAX_KM else None,
            "years": s["years"], "max_benzene_ppb": s["max"]["45201"], "max_butadiene_ppb": s["max"]["43218"],
            "spikes": len(mine), "by_status": dict(sorted(by_status.items())), "area": "los_angeles",
        })
    return out


def dumps(cov: dict) -> str:
    return json.dumps(cov, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    cov = build_coverage()
    OUT.write_text(dumps(cov), encoding="utf-8")
    n = len(cov["sites"])
    print(f"wrote {OUT.relative_to(regions.ROOT)}: {n} sites, {sum(s['has_data'] for s in cov['sites'])} with data, "
          f"{sum(s['spikes'] for s in cov['sites'])} spikes")
