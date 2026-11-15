"""Pollution rose (conditional probability function, CPF) per Ship Channel monitor, 2024-2025.

Per site with both AutoGC and its own wind, per compound: hours with a valid reading, a valid wind direction and
speed >= 3 mph, binned into 12 sectors of 30 degrees by the direction the wind blows FROM. Per sector:
  share_of_hours = sector hours / all analysed hours (how often the wind blows from there);
  cpf[p] = P(value >= the site's p-th percentile | wind from the sector), with the counts behind it;
  share_of_high[p] = sector high hours / all high hours (where the high readings arrive from).
Percentiles are taken over the same analysed hours, so a direction with no link to high readings has a CPF of
about 0.10 (p90) or 0.01 (p99). A site without its own wind is skipped and listed, never given a borrowed wind:
a rose drawn from another site's wind would point at the wrong place.

This shows the direction chronic high readings arrive from. It does not name a source.

Usage: uv run python -m pipeline.rose   (reads data/raw/backtest, writes web/public/rose.json)
"""

import json
import statistics
from pathlib import Path

from pipeline.backtest import BT, SITE_NAMES, YEARS
from pipeline.build import COMPOUNDS, TRIGGER_FLOOR_PPB
from pipeline.parse import hourly_table

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "rose.json"
SECTOR_DEG = 30
N_SECTORS = 360 // SECTOR_DEG
MIN_SPEED_MPH = 3.0  # below this, hourly direction is unreliable (light, meandering night winds)
PERCENTILES = (90, 99)
# kn: a sector with fewer hours than this gets its CPF reported but flagged; 1 high hour in 3 is noise, not a
# direction. Raise it, or add a bootstrap interval, if the rose is ever used for more than "where to look".
MIN_SECTOR_HOURS = 30


def sector(from_deg: float) -> int:
    """Sector index 0..11; sector i covers [30i, 30i + 30). 360 is north, the same as 0."""
    if not 0 <= from_deg <= 360:
        raise ValueError(f"wind direction {from_deg} is outside 0-360 degrees")
    return int(from_deg % 360 // SECTOR_DEG)


def percentile(values: list[float], p: int) -> float:
    """The p-th percentile, linear interpolation between closest ranks (numpy's default)."""
    if len(values) < 2:
        raise ValueError(f"need at least 2 values for a percentile, got {len(values)}")
    return statistics.quantiles(values, n=100, method="inclusive")[p - 1]


def paired_hours(values: dict[str, list[float | None]], wdir: dict[str, list[float | None]],
                 wspd: dict[str, list[float | None]]) -> tuple[list[tuple[float, float, str]], dict[str, int]]:
    """(value, from_deg, day) for every hour with all three present and speed >= MIN_SPEED_MPH, plus why hours dropped."""
    pairs, dropped = [], {"no_reading": 0, "no_wind": 0, "calm": 0}
    for day, vals in values.items():
        dirs, spds = wdir.get(day, [None] * 24), wspd.get(day, [None] * 24)
        for v, d, s in zip(vals, dirs, spds, strict=True):
            if v is None:
                dropped["no_reading"] += 1
            elif d is None or s is None:
                dropped["no_wind"] += 1
            elif s < MIN_SPEED_MPH:
                dropped["calm"] += 1
            else:
                pairs.append((v, d, day))
    return pairs, dropped


def cpf(pairs: list[tuple[float, float, str]]) -> dict:
    """Thresholds, and per sector the hour counts, high counts and CPF for each percentile."""
    if len(pairs) < 2:
        raise ValueError(f"only {len(pairs)} analysed hours; too few for a rose")
    vals = [v for v, _, _ in pairs]
    thresholds = {p: round(percentile(vals, p), 3) for p in PERCENTILES}
    n_all = len(pairs)
    hours = [0] * N_SECTORS
    high = {p: [0] * N_SECTORS for p in PERCENTILES}
    days: dict[int, list[set[str]]] = {p: [set() for _ in range(N_SECTORS)] for p in PERCENTILES}
    for v, d, day in pairs:
        i = sector(d)
        hours[i] += 1
        for p in PERCENTILES:
            if v >= thresholds[p]:
                high[p][i] += 1
                days[p][i].add(day)
    n_high = {p: sum(high[p]) for p in PERCENTILES}
    sectors = []
    for i in range(N_SECTORS):
        sectors.append({
            "from_deg": i * SECTOR_DEG, "to_deg": (i + 1) * SECTOR_DEG, "hours": hours[i],
            "share_of_hours": round(hours[i] / n_all, 4), "sparse": hours[i] < MIN_SECTOR_HOURS,
            **{f"p{p}": {"high_hours": high[p][i], "high_days": len(days[p][i]),
                         "cpf": round(high[p][i] / hours[i], 4) if hours[i] else None,
                         "share_of_high": round(high[p][i] / n_high[p], 4) if n_high[p] else None}
               for p in PERCENTILES},
        })
    return {"n_hours": n_all, "thresholds_ppb": {f"p{p}": thresholds[p] for p in PERCENTILES},
            "high_hours": {f"p{p}": n_high[p] for p in PERCENTILES}, "sectors": sectors}


def headline(rose: dict, p: int = 99) -> dict | None:
    """The sector holding the largest share of high hours (ties: higher CPF), among non-sparse sectors.

    None when every sector is sparse: then there is no direction worth a sentence.
    """
    k = f"p{p}"
    ok = [s for s in rose["sectors"] if not s["sparse"] and s[k]["share_of_high"] is not None]
    if not ok:
        return None
    top = max(ok, key=lambda s: (s[k]["share_of_high"], s[k]["cpf"]))
    return {"percentile": p, "from_deg": top["from_deg"], "to_deg": top["to_deg"],
            "share_of_high": top[k]["share_of_high"], "cpf": top[k]["cpf"], "share_of_hours": top["share_of_hours"],
            "high_hours": top[k]["high_hours"], "high_days": top[k]["high_days"],
            "threshold_ppb": rose["thresholds_ppb"][k]}


def _merge(tables: list[dict[str, list[float | None]]]) -> dict[str, list[float | None]]:
    out: dict[str, list[float | None]] = {}
    for t in tables:
        out |= t
    return out


def site_rose(site: str, raw: Path = BT, years: tuple[str, ...] = YEARS) -> dict:
    """Roses for one site, or {'skipped': reason} when its own wind or readings are missing."""
    met = [raw / f"met_{y}_{site}_{c}.html" for y in years for c in ("61102", "61101")]
    missing = [p.name for p in met if not p.exists()]
    if missing:
        return {"skipped": f"no wind measured at this site (missing {', '.join(missing)})"}
    wdir = _merge([hourly_table(raw / f"met_{y}_{site}_61102.html") for y in years])
    wspd = _merge([hourly_table(raw / f"met_{y}_{site}_61101.html") for y in years])
    if not any(d is not None for row in wdir.values() for d in row):
        return {"skipped": "wind direction files hold no valid hours"}
    compounds, skipped = {}, {}
    for param, (name, _) in COMPOUNDS.items():
        files = [raw / f"agc_{y}_{site}_{param}.html" for y in years]
        if not all(f.exists() for f in files):
            skipped[param] = f"no {name} readings for every year"
            continue
        pairs, dropped = paired_hours(_merge([hourly_table(f) for f in files]), wdir, wspd)
        try:
            rose = cpf(pairs)
        except ValueError as e:
            skipped[param] = str(e)
            continue
        compounds[param] = {"name": name, **rose, "dropped_hours": dropped, "headline": headline(rose)}
    return {"compounds": compounds, "skipped_compounds": skipped}


def run(raw: Path = BT, sites: dict[str, str] = SITE_NAMES) -> dict:
    out_sites, skipped = {}, []
    for site, name in sites.items():
        r = site_rose(site, raw)
        if "skipped" in r:
            skipped.append({"site_id": site, "name": name, "reason": r["skipped"]})
        else:
            out_sites[site] = {"name": name, **r}
    return {
        "method": {
            "name": "conditional probability function (CPF)", "years": list(YEARS), "time": "hourly, CST",
            "min_speed_mph": MIN_SPEED_MPH, "sector_deg": SECTOR_DEG, "percentiles": list(PERCENTILES),
            "min_sector_hours": MIN_SECTOR_HOURS,
            "threshold_population": "the site's own analysed hours (reading, direction and speed >= 3 mph)",
            "direction": "degrees the wind blows from; sector i covers [30i, 30i + 30)",
            "high": "value >= threshold", "units": "ppb-v", "trigger_floor_ppb": TRIGGER_FLOOR_PPB,
            "source": "TCEQ AutoGC and met hourly summaries (data/raw/backtest)",
        },
        "caveat": "This shows the direction chronic high readings arrive from. It does not name a source.",
        "sites": out_sites, "skipped_sites": skipped,
    }


def main() -> None:
    result = run()
    OUT.write_text(json.dumps(result, indent=1) + "\n")
    for s in result["sites"].values():
        for c in s["compounds"].values():
            h = c["headline"]
            if h is None:
                print(f"{s['name']:24} {c['name']:14} n={c['n_hours']:5}  every sector sparse; no headline")
                continue
            print(f"{s['name']:24} {c['name']:14} n={c['n_hours']:5}  p99={h['threshold_ppb']} ppb  "
                  f"{h['from_deg']}-{h['to_deg']} deg: {h['share_of_high']:.0%} of top-1% hours, "
                  f"CPF {h['cpf']:.2f}, {h['share_of_hours']:.0%} of hours, {h['high_hours']} h on {h['high_days']} days")
    for s in result["skipped_sites"]:
        print(f"skipped {s['name']}: {s['reason']}")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
