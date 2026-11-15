"""Regions the pipeline can run on. Houston is the default everywhere; every other region is opt-in by key.

A region is data only (sites, county, where its raw files and outputs live). Detection, corridor and the record check
are the same code for every region. A region is backtested against its own county's company self-reports by
`uv run python -m pipeline.backtest --region <key>` (docs/backtest.md, "Other regions"); only then does it get
backtested=True and n_backtest (tests/test_regions.py checks both against that run's output).

The web app reads the region list from web/src/regions.generated.json, written from REGIONS below:
    uv run python -m pipeline.regions --write-web
tests/test_regions.py fails when the committed file and REGIONS disagree.
"""

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_PUBLIC = ROOT / "web" / "public"
WEB_REGISTRY = ROOT / "web" / "src" / "regions.generated.json"
# The key lands in ?region= and the folder name in a fetch URL; keep both to plain lowercase words.
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# Ship Channel AutoGC sites; coordinates are the TAMIS site records saved in data/raw/backtest/tamis_*.html.
HOUSTON_SITES = {
    "48_201_0069": "Houston Milby Park", "48_201_0307": "Manchester East Ave N", "48_201_0057": "Galena Park",
    "48_201_1614": "HRM-16 Deer Park", "48_201_1035": "Clinton", "48_201_1015": "Lynchburg Ferry",
    "48_201_0803": "HRM-3 Haden Road", "48_201_0026": "Channelview",
    # Added 2026-11-15: the other Harris County AutoGC sites whose own CAMS id carries met-form wind (names from TAMIS).
    "48_201_0036": "Channelview Drive Water Tower", "48_201_1039": "Houston Deer Park #2",
    "48_201_1049": "Pasadena Richey Elementary School", "48_201_6000": "Cesar Chavez",
}

# Per site, the CAMS ids the TCEQ met form lists for it; wind is on one of them (tried in order).
# kn: 48_201_0807 HRM-7 W Baytown and 48_201_0617 Wallisville Road are left out: no met-form wind at their own
# CAMS id. The AutoGC form's resultant wind (61103/61104) would cover them; fetch_met reads only MET_URL today.
HOUSTON_MET_SELECTS = {
    "48_201_0069": ["site|Houston Milby Park A169 |48_201_0069|169"],
    "48_201_0307": ["site|Manchester East Avenue N C1029 |48_201_0307|1029"],
    "48_201_0057": ["site|Galena Park A1667 |48_201_0057|167"],
    "48_201_1614": ["site|HRM-16 Deer Park C1614 |48_201_1614|1614"],
    "48_201_1035": ["site|Clinton C403/C304/AH113 |48_201_1035|403", "site|Clinton C403/C304/AH113 |48_201_1035|304",
                    "site|Clinton C403/C304/AH113 |48_201_1035|113"],
    "48_201_1015": ["site|Lynchburg Ferry C1015/A165 |48_201_1015|1015",
                    "site|Lynchburg Ferry C1015/A165 |48_201_1015|165"],
    "48_201_0803": ["site|HRM-3 Haden Road C603/A114 |48_201_0803|603",
                    "site|HRM-3 Haden Road C603/A114 |48_201_0803|114"],
    "48_201_0026": ["site|Channelview C15/AH115 |48_201_0026|15", "site|Channelview C15/AH115 |48_201_0026|115"],
    "48_201_0036": ["site|Channelview Drive Water Tower C1036 |48_201_0036|1036"],
    "48_201_1039": ["site|Hou.DeerPrk2 C35/235/1001/AFH139/FP239|48_201_1039|35",
                    "site|Hou.DeerPrk2 C35/235/1001/AFH139/FP239|48_201_1039|139",
                    "site|Hou.DeerPrk2 C35/235/1001/AFH139/FP239|48_201_1039|235",
                    "site|Hou.DeerPrk2 C35/235/1001/AFH139/FP239|48_201_1039|1001",
                    "site|Hou.DeerPrk2 C35/235/1001/AFH139/FP239|48_201_1039|3000"],
    "48_201_1049": ["site|Pasadena Richey Elementary School C1049|48_201_1049|1049"],
    "48_201_6000": ["site|Cesar Chavez C1020/175 |48_201_6000|175", "site|Cesar Chavez C1020/175 |48_201_6000|1020"],
}

# Jefferson County AutoGC sites: the TCEQ AutoGC yearly-summary form lists exactly these two under Beaumont-Port
# Arthur (saved as data/raw/region_beaumont/agc_form.html). Port Arthur itself has no AutoGC site on that list.
BEAUMONT_SITES = {"48_245_0009": "Beaumont-Downtown", "48_245_1035": "Nederland 17th Street"}

NOT_BACKTESTED_NOTE = "New region: no backtest yet; statuses use the same rules; no claims are made from it."
# One line in a backtested region's limits list (and its files' region block); the doc carries the numbers.
# The number sits in the parentheses so the web's Spanish table (format.ts cannotSayEs) matches the sentence itself.
BACKTESTED_NOTE = "Backtested against company-reported releases (n = {n}, 2024-2025)"


@dataclass(frozen=True)
class Region:
    key: str
    label: str
    county: str  # as STEERS spells it in the county search field
    sites: dict[str, str]
    raw: Path
    spikes_out: Path
    nights_out: Path
    backtested: bool
    place: str  # used in the event title: "<compound> spike <place>"
    label_es: str  # Spanish label on the web region switch
    place_es: str  # Spanish of `place`: the web rebuilds the title as "Pico de <compuesto> <place_es>"
    met_selects: dict[str, list[str]] = field(default_factory=dict)
    # Candidate releases in the region's backtest (summary.candidates); None until it is backtested.
    n_backtest: int | None = None

    def __post_init__(self) -> None:
        if self.backtested != (self.n_backtest is not None):
            raise ValueError(f"region {self.key}: backtested and n_backtest must be set together")

    @property
    def county_title(self) -> str:
        return self.county.title()

    @property
    def note(self) -> str | None:
        """Houston: None (its files never carried one). Another region: its backtest line, or the not-backtested one."""
        if self.key == "houston":
            return None
        return BACKTESTED_NOTE.format(n=self.n_backtest) if self.backtested else NOT_BACKTESTED_NOTE


HOUSTON = Region(
    key="houston", label="Houston Ship Channel", county="HARRIS", sites=HOUSTON_SITES,
    raw=ROOT / "data" / "raw" / "backtest", spikes_out=ROOT / "web" / "public" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "nights", backtested=True, place="on the Houston Ship Channel",
    # The web switch has always shown the English name here; the Spanish title phrase is translated.
    label_es="Houston Ship Channel", place_es="en el Canal de Navegación de Houston",
    met_selects=HOUSTON_MET_SELECTS, n_backtest=77,
)

BEAUMONT = Region(
    key="beaumont", label="Beaumont-Port Arthur", county="JEFFERSON", sites=BEAUMONT_SITES,
    raw=ROOT / "data" / "raw" / "region_beaumont",
    spikes_out=ROOT / "web" / "public" / "regions" / "beaumont" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "regions" / "beaumont" / "nights", backtested=True, n_backtest=81,
    place="in Beaumont-Port Arthur", label_es="Beaumont-Port Arthur", place_es="en Beaumont-Port Arthur",
    # CAMS ids the TCEQ met form lists for each site; wind is on one of them (tried in order).
    met_selects={
        "48_245_0009": ["site|Beaumont-Downtown C2/A112/C2002 |48_245_0009|2",
                        "site|Beaumont-Downtown C2/A112/C2002 |48_245_0009|112",
                        "site|Beaumont-Downtown C2/A112/C2002 |48_245_0009|2002"],
        "48_245_1035": ["site|Nederland 17th Street C1035|48_245_1035|1035"],
    },
)

REGIONS = {r.key: r for r in (HOUSTON, BEAUMONT)}
ALL_SITE_NAMES = {s: n for r in REGIONS.values() for s, n in r.sites.items()}


def get(key: str) -> Region:
    if key not in REGIONS:
        raise SystemExit(f"unknown region {key!r}; expected one of {sorted(REGIONS)}")
    return REGIONS[key]


def web_dir(r: Region) -> str:
    """Folder under web/public holding the region's spikes.json and nights/ ('' is the root: Houston's files)."""
    rel = r.spikes_out.parent.relative_to(WEB_PUBLIC).as_posix()
    d = "" if rel == "." else f"{rel}/"
    if r.spikes_out.name != "spikes.json" or r.nights_out != r.spikes_out.parent / "nights":
        raise ValueError(f"region {r.key}: the web reads <dir>spikes.json and <dir>nights/; got {r.spikes_out}, "
                         f"{r.nights_out}. Put both under web/public/regions/{r.key}/.")
    if d not in ("", f"regions/{r.key}/"):
        raise ValueError(f"region {r.key}: outputs must live in web/public/regions/{r.key}/, not {d!r}")
    return d


def web_registry(regions: dict[str, Region] = REGIONS) -> list[dict]:
    """The fields the web needs, Houston first (the web's default region)."""
    rows = []
    for r in regions.values():
        if not KEY_RE.match(r.key):
            raise ValueError(f"region key {r.key!r} must match {KEY_RE.pattern}")
        rows.append({
            "key": r.key, "label": r.label, "label_es": r.label_es, "place": r.place, "place_es": r.place_es,
            "dir": web_dir(r), "backtested": r.backtested, "n_sites": len(r.sites), "county": r.county,
        })
    if not rows or rows[0]["key"] != "houston":
        raise ValueError("Houston must be the first region: the web falls back to it")
    return rows


def web_registry_text(regions: dict[str, Region] = REGIONS) -> str:
    return json.dumps(web_registry(regions), indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    if sys.argv[1:] != ["--write-web"]:
        raise SystemExit("usage: uv run python -m pipeline.regions --write-web")
    WEB_REGISTRY.write_text(web_registry_text(), encoding="utf-8")
    print(f"wrote {WEB_REGISTRY.relative_to(ROOT)} ({len(REGIONS)} regions)")
