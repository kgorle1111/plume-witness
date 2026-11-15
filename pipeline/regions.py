"""Regions the pipeline can run on. Houston is the default everywhere; every other region is opt-in by key.

A region is data only (sites, county, where its raw files and outputs live). Detection, corridor and the record check
are the same code for every region. Only Houston has a backtest against company self-reports.
"""

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Ship Channel AutoGC sites; coordinates are the TAMIS site records saved in data/raw/backtest/tamis_*.html.
HOUSTON_SITES = {
    "48_201_0069": "Houston Milby Park", "48_201_0307": "Manchester East Ave N", "48_201_0057": "Galena Park",
    "48_201_1614": "HRM-16 Deer Park", "48_201_1035": "Clinton", "48_201_1015": "Lynchburg Ferry",
    "48_201_0803": "HRM-3 Haden Road", "48_201_0026": "Channelview",
}

# Jefferson County AutoGC sites: the TCEQ AutoGC yearly-summary form lists exactly these two under Beaumont-Port
# Arthur (saved as data/raw/region_beaumont/agc_form.html). Port Arthur itself has no AutoGC site on that list.
BEAUMONT_SITES = {"48_245_0009": "Beaumont-Downtown", "48_245_1035": "Nederland 17th Street"}

NOT_BACKTESTED_NOTE = "New region: no backtest yet; statuses use the same rules; no claims are made from it."


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
    met_selects: dict[str, list[str]] = field(default_factory=dict)

    @property
    def county_title(self) -> str:
        return self.county.title()

    @property
    def note(self) -> str | None:
        return None if self.backtested else NOT_BACKTESTED_NOTE


HOUSTON = Region(
    key="houston", label="Houston Ship Channel", county="HARRIS", sites=HOUSTON_SITES,
    raw=ROOT / "data" / "raw" / "backtest", spikes_out=ROOT / "web" / "public" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "nights", backtested=True, place="on the Houston Ship Channel",
)

BEAUMONT = Region(
    key="beaumont", label="Beaumont-Port Arthur", county="JEFFERSON", sites=BEAUMONT_SITES,
    raw=ROOT / "data" / "raw" / "region_beaumont",
    spikes_out=ROOT / "web" / "public" / "regions" / "beaumont" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "regions" / "beaumont" / "nights", backtested=False,
    place="in Beaumont-Port Arthur",
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
