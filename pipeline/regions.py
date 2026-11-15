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
    # STEERS counties searched for the record check when not all of a multi-county region's counties are: only the
    # counties whose monitors had a spike (a county with none needs no record check). Empty means every county.
    steers_counties: tuple[str, ...] = ()
    # Outside Texas (Los Angeles): the zone and wording the replay uses instead of Texas's. Empty means Texas.
    tz: str = "America/Chicago"
    tz_std: str = "CST"
    time_note: str = ""  # with {tz}: the report's local zone that day
    monitor_en: str = "the Texas state monitor"
    monitor_es: str = "el monitor estatal de Texas"
    records_en: str = "state emissions-event"
    records_es: str = "estatales de eventos de emisiones"
    cannot_say: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.backtested != (self.n_backtest is not None):
            raise ValueError(f"region {self.key}: backtested and n_backtest must be set together")

    @property
    def county_title(self) -> str:
        return self.county.title()

    @property
    def counties(self) -> tuple[str, ...]:
        """`county` is one STEERS county name, or several joined by ", " for a region that spans counties."""
        return tuple(c.strip() for c in self.county.split(","))

    @property
    def search_counties(self) -> tuple[str, ...]:
        return self.steers_counties or self.counties

    @property
    def search_county_title(self) -> str:
        """The searched counties as the record-check text names them ("Harris"; "Ector, Midland")."""
        return ", ".join(c.title() for c in self.search_counties)

    @property
    def note(self) -> str | None:
        """Houston: None (its files never carried one). Another region: its backtest line if it has one, else None;
        no public file says a region is not backtested."""
        if self.key == "houston" or not self.backtested:
            return None
        return BACKTESTED_NOTE.format(n=self.n_backtest)


HOUSTON = Region(
    key="houston", label="Houston Ship Channel", county="HARRIS", sites=HOUSTON_SITES,
    raw=ROOT / "data" / "raw" / "backtest", spikes_out=ROOT / "web" / "public" / "spikes.json",
    nights_out=ROOT / "web" / "public" / "nights", backtested=True, place="on the Houston Ship Channel",
    # The web switch has always shown the English name here; the Spanish title phrase is translated.
    label_es="Houston Ship Channel", place_es="en el Canal de Navegación de Houston",
    met_selects=HOUSTON_MET_SELECTS, n_backtest=82,
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


# Every other Texas AutoGC site with 2024-2025 hourly data, grouped by the county STEERS is searched by. Sites,
# names and counties are the TCEQ AutoGC yearly-summary form's list (data/raw/texas_coverage/agc_form.html); the
# CAMS ids are the met form's options for each site.
# The AQS id's middle part is the county FIPS code, which is how coverage.json and the tests check each site's county.
TX_COUNTY_FIPS = {
    "029": "BEXAR", "039": "BRAZORIA", "091": "COMAL", "113": "DALLAS", "121": "DENTON", "135": "ECTOR",
    "141": "EL PASO", "201": "HARRIS", "245": "JEFFERSON", "251": "JOHNSON", "255": "KARNES", "329": "MIDLAND",
    "355": "NUECES", "439": "TARRANT", "493": "WILSON", "497": "WISE",
}


def site_county(site: str) -> str:
    return TX_COUNTY_FIPS[site.split("_")[1]]


# AutoGC sites on the form with no hourly benzene or 1,3-butadiene for 2024 or 2025 (TAMIS lists them inactive, except
# Odessa Hays). They are in no region; data/raw/texas_coverage/ holds the empty AutoGC pages that show it.
NO_DATA_SITES = {
    "48_355_0035": "Oak Park", "48_355_0041": "Solar Estates", "48_135_0003": "Odessa Hays",
    "48_141_1011": "El Paso Delta",
}
COVERAGE_RAW = ROOT / "data" / "raw" / "texas_coverage"


def _sel(site: str, label: str, *cams: str) -> list[str]:
    return [f"site|{label}|{site}|{c}" for c in cams]


def _new_region(key: str, label: str, label_es: str, place: str, place_es: str, county: str,
                selects: dict[str, tuple[str, list[str]]], steers_counties: tuple[str, ...] = ()) -> Region:
    """A region with the usual layout: data/raw/region_<key>/ in, web/public/regions/<key>/ out. Labels are plain
    place names. Not backtested: STEERS is searched only where the record check needs it (`steers_counties`)."""
    return Region(
        key=key, label=label, county=county, sites={s: n for s, (n, _) in selects.items()},
        raw=ROOT / "data" / "raw" / f"region_{key}", spikes_out=WEB_PUBLIC / "regions" / key / "spikes.json",
        nights_out=WEB_PUBLIC / "regions" / key / "nights", backtested=False, place=place, label_es=label_es,
        place_es=place_es, met_selects={s: sel for s, (_, sel) in selects.items()},
        steers_counties=steers_counties,
    )


# The two Harris County AutoGC sites Houston leaves out (no met-form wind at their own CAMS id; they use the AutoGC
# form's resultant wind). A region of their own so Houston's backtested numbers stay exactly as published.
BAYTOWN = _new_region(
    "baytown", "Baytown", "Baytown", "near Baytown", "cerca de Baytown", "HARRIS", {
        "48_201_0807": ("HRM-7 W Baytown", _sel("48_201_0807", "HRM-7 W Baytown C607 ", "607")),
        "48_201_0617": ("Wallisville Road", _sel("48_201_0617", "Wallisville Road C617 ", "617")),
    })

BRAZORIA = _new_region(
    "brazoria", "Brazoria County", "Condado de Brazoria", "in Brazoria County", "en el condado de Brazoria",
    "BRAZORIA", {"48_039_1607": ("Oyster Creek", _sel("48_039_1607", "Oyster Creek C1607 ", "1607"))})

# Victoria County has no AutoGC site on the form; Oak Park and Solar Estates (Nueces) have no 2024-2025 data.
CORPUS_CHRISTI = _new_region(
    "corpus_christi", "Corpus Christi", "Corpus Christi", "in Corpus Christi", "en Corpus Christi", "NUECES",
    {"48_355_0083": ("Corpus Christi Palm", _sel("48_355_0083", "Corpus Christi Palm C83 ", "83"))})

KARNES = _new_region(
    "karnes", "Karnes County", "Condado de Karnes", "in Karnes County", "en el condado de Karnes", "KARNES",
    {"48_255_1070": ("Karnes County Courthouse",
                     _sel("48_255_1070", "Karnes County Courthouse C1070 ", "1070"))})

SAN_ANTONIO = _new_region(
    "san_antonio", "San Antonio area", "Área de San Antonio", "in the San Antonio area", "en el área de San Antonio",
    "BEXAR, COMAL, WILSON", {
        "48_029_0052": ("Camp Bullis", _sel("48_029_0052", "Camp Bullis C58 ", "58")),
        "48_091_0505": ("AACOG City of Garden Ridge",
                        _sel("48_091_0505", "AACOG City of Garden Ridge C505 ", "505")),
        "48_493_1038": ("Floresville Hospital Blvd", _sel("48_493_1038", "Floresville Hospital Blvd C1038 ", "1038")),
    })

DALLAS_FORT_WORTH = _new_region(
    "dallas_fort_worth", "Dallas-Fort Worth", "Dallas-Fort Worth", "in Dallas-Fort Worth", "en Dallas-Fort Worth",
    "DALLAS, DENTON, JOHNSON, TARRANT, WISE", {
        "48_113_0069": ("Dallas Hinton St.", _sel("48_113_0069", "Dallas Hinton St. C401/C60/AH161 ", "60", "161",
                                                  "401", "3002")),
        "48_113_1505": ("Dallas Elm Fork", _sel("48_113_1505", "Dallas Elm Fork C1505 ", "1505")),
        "48_121_1007": ("Flower Mound Shiloh", _sel("48_121_1007", "Flower Mound Shiloh C1007 ", "1007")),
        "48_121_1013": ("Dish Airfield", _sel("48_121_1013", "Dish Airfield C1013 ", "1013")),
        "48_251_1063": ("Mansfield Flying L Lane", _sel("48_251_1063", "Mansfield Flying L Lane C1063 ", "1063")),
        "48_251_1501": ("Godley FM2331", _sel("48_251_1501", "Godley FM2331 C1501 ", "1501")),
        "48_439_0075": ("Eagle Mountain Lake", _sel("48_439_0075", "Eagle Mountain Lake C75 ", "75")),
        "48_439_1002": ("Fort Worth Northwest (Meacham)", _sel("48_439_1002", "Ft. Worth Northwest C13/AH302 ", "13")),
        "48_439_1009": ("Everman Johnson Park", _sel("48_439_1009", "Everman Johnson Park C1009 ", "1009")),
        "48_439_1018": ("Arlington UT Campus", _sel("48_439_1018", "Arlington UT Campus C1018 ", "1018")),
        "48_439_1062": ("Kennedale Treepoint Dr", _sel("48_439_1062", "Kennedale Treepoint Dr C1062 ", "1062")),
        "48_439_1065": ("Fort Worth Joe B Rushing Road",
                        _sel("48_439_1065", "Fort Worth Joe B Rushing Road C1065 ", "1065")),
        "48_439_1503": ("Fort Worth Benbrook Lake", _sel("48_439_1503", "Fort Worth Benbrook Lake C1503 ", "1503")),
        "48_497_0088": ("Decatur Thompson", _sel("48_497_0088", "Decatur Thompson C88 ", "88")),
        "48_497_1064": ("Rhome Seven Hills Road", _sel("48_497_1064", "Rhome Seven Hills Road C1064 ", "1064")),
    }, steers_counties=("DALLAS",))  # only the Dallas County monitors (Hinton St., Elm Fork) had a spike

MIDLAND_ODESSA = _new_region(
    "midland_odessa", "Midland-Odessa", "Midland-Odessa", "in Midland-Odessa", "en Midland-Odessa", "ECTOR, MIDLAND", {
        "48_135_1092": ("Odessa Westmark Street", _sel("48_135_1092", "Odessa Westmark Street C1092 ", "1092")),
        "48_135_1093": ("Goldsmith Street", _sel("48_135_1093", "Goldsmith Street C1093 ", "1093")),
        "48_329_1095": ("Midland Avalon Drive", _sel("48_329_1095", "Midland Avalon Drive C1095 ", "1095")),
    })

EL_PASO = _new_region(
    "el_paso", "El Paso", "El Paso", "in El Paso", "en El Paso", "EL PASO",
    {"48_141_0044": ("Chamizal", _sel("48_141_0044", "Chamizal C41/AH126 ", "41", "126", "3001"))})

REGIONS = {r.key: r for r in (HOUSTON, BEAUMONT, BAYTOWN, BRAZORIA, CORPUS_CHRISTI, KARNES, SAN_ANTONIO,
                              DALLAS_FORT_WORTH, MIDLAND_ODESSA, EL_PASO)}
ALL_SITE_NAMES = {s: n for r in REGIONS.values() for s, n in r.sites.items()}

# Outside Texas. Not in REGIONS: everything keyed on REGIONS is the Texas TCEQ/STEERS pipeline (coverage form, STEERS
# fetch, backtest). Los Angeles is built by pipeline.la_replay; the web lists it with the Texas regions.
LA_STATION_NAMES = {
    "HDSN": "Hudson Air Monitoring Station", "IPRT": "Inner Port Air Monitoring Station",
    "SLKE": "St Luke Air Monitoring Station", "JUDS": "Judson Air Monitoring Station",
    "UMCW": "First Methodist Air Monitoring Station", "MHAN": "Manhattan Beach Air Monitoring Station",
    "ELSG": "El Segundo Air Monitoring Station", "ANTH": "St Anthony Air Monitoring Station",
    "GUEN": "Guenser Park Air Monitoring Station", "ELMA": "Elm Avenue Air Monitoring Station",
}
LOS_ANGELES = Region(
    key="los_angeles", label="Los Angeles", county="LOS ANGELES", sites=LA_STATION_NAMES,
    raw=ROOT / "data" / "raw" / "region_los_angeles",
    spikes_out=WEB_PUBLIC / "regions" / "los_angeles" / "spikes.json",
    nights_out=WEB_PUBLIC / "regions" / "los_angeles" / "nights", backtested=False, place="in Los Angeles",
    label_es="Los Ángeles", place_es="en Los Ángeles",
    tz="America/Los_Angeles", tz_std="PST",
    time_note=("Monitor hours are PST as South Coast AQMD publishes them; the reports use local time ({tz}). "
               "South Coast AQMD's public hourly history for these stations ends in December 2022."),
    monitor_en="the South Coast AQMD community monitor", monitor_es="el monitor comunitario de South Coast AQMD",
    records_en="Cal OES spill", records_es="de derrames de Cal OES",
    cannot_say=(
        "A matching report is not proof the facility caused every reading; other sources can add to a spike.",
        ("Los Angeles County has no public list of every emissions event: Cal OES spill reports and National Response "
         "Center reports are phone reports with a start time and no end time, so a missing match cannot be claimed."),
        ("The upwind corridor comes from wind direction at one airport weather station (geometry only), not a "
         "dispersion model; it cannot tell facilities along the same bearing apart."),
        "Facility coordinates are as published by EPA ECHO and may be approximate.",
        ("Hours when all seven compounds the analyzer reports read 5 ppb or more at once are the analyzer's check gas "
         "and are not counted."),
        "Only South Coast AQMD's Rule 1180 community monitors are used, never low-cost sensors.",
    ),
)
OTHER_REGIONS = {LOS_ANGELES.key: LOS_ANGELES}
WEB_REGIONS = REGIONS | OTHER_REGIONS


def get(key: str) -> Region:
    if key not in WEB_REGIONS:
        raise SystemExit(f"unknown region {key!r}; expected one of {sorted(WEB_REGIONS)}")
    return WEB_REGIONS[key]


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


def web_registry(regions: dict[str, Region] = WEB_REGIONS) -> list[dict]:
    """The fields the web needs, Houston first (the web's default region)."""
    rows = []
    for r in regions.values():
        if not KEY_RE.match(r.key):
            raise ValueError(f"region key {r.key!r} must match {KEY_RE.pattern}")
        rows.append({
            "key": r.key, "label": r.label, "label_es": r.label_es, "place": r.place, "place_es": r.place_es,
            "dir": web_dir(r), "backtested": r.backtested, "n_sites": len(r.sites), "county": r.county,
        } | ({} if r.tz_std == "CST" else {"tz": r.tz_std}))
    if not rows or rows[0]["key"] != "houston":
        raise ValueError("Houston must be the first region: the web falls back to it")
    return rows


def web_registry_text(regions: dict[str, Region] = WEB_REGIONS) -> str:
    return json.dumps(web_registry(regions), indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    if sys.argv[1:] != ["--write-web"]:
        raise SystemExit("usage: uv run python -m pipeline.regions --write-web")
    WEB_REGISTRY.write_text(web_registry_text(), encoding="utf-8")
    print(f"wrote {WEB_REGISTRY.relative_to(ROOT)} ({len(WEB_REGIONS)} regions)")
