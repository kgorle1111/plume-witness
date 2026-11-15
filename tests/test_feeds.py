"""Watch feeds: well-formed RSS, no facility names, stable GUIDs, counts that match spikes.json."""

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from test_spikes import facility_names

from pipeline import feeds

ROOT = Path(__file__).resolve().parent.parent
SPIKES = ROOT / "web" / "public" / "spikes.json"
BT = ROOT / "data" / "build" / "backtest.json"
# Built from fragments so this file itself stays clean of the words it forbids.
_STEMS = ("ille" + "gal", "viol" + "ation", "un" + "reported", "cau" + "ght", "pollu" + "ter", "pro" + "ves")
BANNED = re.compile(r"\b(" + "|".join(_STEMS) + r")s?\b", re.IGNORECASE)
NO_REPORT = "No matching company report was found in a complete search. This is a question for the state, not a finding."


@pytest.fixture(scope="module")
def data() -> dict:
    return json.loads(SPIKES.read_text())


@pytest.fixture(scope="module")
def built(data):
    return feeds.build_all(data)


def _items(blob: bytes) -> list[ET.Element]:
    root = ET.fromstring(blob)  # raises ParseError if not well-formed
    assert root.tag == "rss" and root.get("version") == "2.0"
    return root.findall("./channel/item")


def test_every_feed_is_well_formed_rss_with_required_fields(built):
    files, _ = built
    for name, blob in files.items():
        for it in _items(blob):
            for tag in ("title", "link", "guid", "pubDate", "description"):
                assert (it.findtext(tag) or "").strip(), f"{name}: item missing {tag}"
            assert it.findtext("link").startswith((feeds.SITE + "?night=", feeds.SITE + "?view=spikes&site="))
            assert "?view=spikes&site=" in it.findtext("description")


def test_awkward_characters_are_escaped_not_dropped():
    row = {"night_id": "n", "date": "2025-01-02", "hour_cst": 3, "site_id": "s", "site": "A & B <Park>", "param": "45201",
           "compound": "benzene", "value_ppb": 1, "baseline_ppb": 0.5, "ratio": 2, "status": "reported"}
    blob = feeds.build_feed("t", "d", feeds.SITE, feeds.SITE + "feeds/x.xml", [row])
    assert _items(blob)[0].findtext("title").count("A & B <Park>") == 1


def test_a_row_without_a_night_file_links_to_its_monitor_not_a_404():
    row = {"night_id": None, "date": "2025-10-28", "hour_cst": 3, "site_id": "48_201_0057", "site": "Galena Park",
           "param": "45201", "compound": "benzene", "value_ppb": 2, "baseline_ppb": 0.5, "ratio": 4,
           "status": "search_incomplete", "reason": "No wind data for that day."}
    it = feeds.item_for(row)
    assert it["guid"] == "plume-witness:2025-10-28_45201_48_201_0057"
    assert "?night=" not in it["link"] + it["description"] and "?view=spikes&site=48_201_0057" in it["link"]


def test_counts_match_spikes_json(data, built):
    files, index = built
    by_site: dict[str, int] = {}
    for r in data["rows"]:
        by_site[r["site_id"]] = by_site.get(r["site_id"], 0) + 1
    for sid, n in by_site.items():
        assert len(_items(files[f"{sid}.xml"])) == n
    assert len(_items(files["all.xml"])) == min(feeds.ALL_N, len(data["rows"]))
    assert sum(by_site.values()) == data["summary"]["spikes"] == 468
    assert {f["id"]: f["items"] for f in index["feeds"]} == {"all": feeds.ALL_N, **by_site}


def test_all_feed_is_the_newest_n_in_order(data, built):
    files, _ = built
    dates = [it.findtext("guid") for it in _items(files["all.xml"])]
    newest = sorted(data["rows"], key=lambda r: (r["date"], r["hour_cst"], r["site_id"], r["param"]), reverse=True)
    assert dates == [f"plume-witness:{feeds.row_id(r)}" for r in newest[: feeds.ALL_N]]


def test_guids_are_stable_unique_and_clock_free(data, built):
    files, _ = built
    guids = [it.findtext("guid") for it in _items(files["all.xml"])]
    assert len(set(guids)) == len(guids)
    assert guids[0] == f"plume-witness:{feeds.row_id(feeds.newest_first(data['rows'])[0])}"
    again, _ = feeds.build_all(data)
    assert again == files, "rebuilding unchanged data must produce identical bytes (no timestamps)"


def test_no_item_names_a_facility(built):
    names = facility_names(json.loads(BT.read_text()))
    assert len(names) > 50, "ECHO facility list did not load; the name check would be vacuous"
    files, _ = built
    for name, blob in files.items():
        for it in _items(blob):
            text = " " + re.sub(r"[^a-z0-9]+", " ", ET.tostring(it, encoding="unicode").lower()) + " "
            hits = [n for n in names if f" {n} " in text]
            assert not hits, f"{name}: {it.findtext('guid')} names a facility: {hits}"


def test_no_report_wording_and_banned_words(built):
    files, index = built
    seen = 0
    for blob in files.values():
        for it in _items(blob):
            d = it.findtext("description")
            if "No matching company report" in d:
                seen += 1
                assert NO_REPORT in d
            assert not BANNED.search(ET.tostring(it, encoding="unicode"))
    assert seen > 0
    assert not BANNED.search(json.dumps(index))


def test_committed_feeds_are_current(data, built):
    files, _ = built
    for name, blob in files.items():
        assert (feeds.OUT / name).read_bytes() == blob, f"{name} is stale; run `uv run python -m pipeline.feeds`"
