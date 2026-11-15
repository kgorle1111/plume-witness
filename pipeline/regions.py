"""Regions the pipeline can run on. Houston is the default everywhere; every other region is opt-in by key.

A region is data only (sites, county, where its raw files and outputs live). Detection, corridor and the record check
are the same code for every region. Only Houston has a backtest against company self-reports.

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
    label_es: str  # Spanish label on the web region switch
    place_es: str  # Spanish of `place`: the web rebuilds the title as "Pico de <compuesto> <place_es>"
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
    # The web switch has always shown the English name here; the Spanish title phrase is translated.
    label_es="Houston Ship Channel", place_es="en el Canal de Navegación de Houston",
)

BEAUMONT = Region(
    key="beaumont", label="Beaumont-Port Arthur", county="JEFFERSON", sites=BEAUMONT_SITES,
    raw=ROOT / "data" / "raw" / "region_beaumont",
    spikes_out=ROOT / "web" / "public" / "regions" / "beaumont" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "regions" / "beaumont" / "nights", backtested=False,
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
