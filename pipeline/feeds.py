"""Subscribable RSS 2.0 feeds built from the past-spikes log (web/public/spikes.json).

One feed of the newest spikes (all.xml) and one per monitor (<site_id>.xml), plus feeds/index.json. Items carry
the monitor, compound, value against baseline and the record-check status in plain words, never a facility name.
Output depends only on spikes.json (no clock), so a rebuild with unchanged data changes no bytes:

    uv run python -m pipeline.spikes && uv run python -m pipeline.feeds
"""

import json
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from pipeline.contract import STATUSES

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "public" / "spikes.json"
OUT = ROOT / "web" / "public" / "feeds"
SCHEMA = "plume-witness.feeds/v1"
SPIKES_SCHEMA = "plume-witness.spikes/v1"
SITE = "https://kgorle1111.github.io/plume-witness/"
ALL_N = 100
# Hourly readings are CST year-round (TCEQ publishes CST, no daylight saving).
CST = "-0600"
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
ATOM = "http://www.w3.org/2005/Atom"
# Plain-words status text. The no-report sentence is fixed wording; keep it exactly as is.
STATUS_TEXT = {
    "reported": "A company report from the upwind area lists this compound and starts near the spike hour.",
    "reported_late": "A company report from the upwind area is on the state record, dated after the reporting window.",
    "not_yet_reported": "The reporting deadline has not passed yet, so there is nothing to compare against.",
    "no_report_after_deadline": "No matching company report was found in a complete search. "
                                "This is a question for the state, not a finding.",
    "reported_mismatch": "A report exists for that day, but its compound, place or time does not line up with this spike.",
    "search_incomplete": "The record check could not finish, so this feed says nothing either way.",
}
assert set(STATUS_TEXT) == set(STATUSES), "STATUS_TEXT must cover every contract status"
CAVEAT = "Hourly readings are provisional TCEQ data and can change; a spike can also come from a non-industrial source or an instrument fault."

ET.register_namespace("atom", ATOM)


class FeedError(ValueError):
    pass


def pub_date(iso: str, hour: int) -> str:
    d = date.fromisoformat(iso)
    return f"{DAYS[d.weekday()]}, {d.day:02d} {MONTHS[d.month - 1]} {d.year} {hour:02d}:00:00 {CST}"


def hour_text(h: int) -> str:
    return f"{(h % 12) or 12}:00 {'a.m.' if h < 12 else 'p.m.'} CST"


def row_id(r: dict) -> str:
    """Same id as spikes.spike_id (not imported: that module pulls in the backtest). Stable when night_id is null."""
    return f"{r['date']}_{r['param']}_{r['site_id']}"


def night_link(night_id: str) -> str:
    return f"{SITE}?night={night_id}"


def monitor_link(site_id: str) -> str:
    return f"{SITE}?view=spikes&site={site_id}"


def item_for(r: dict) -> dict:
    status = r["status"]
    if status not in STATUS_TEXT:
        raise FeedError(f"row {row_id(r)!r}: status {status!r} has no feed text; add it to STATUS_TEXT")
    ratio = f" ({r['ratio']:g} times baseline)" if r.get("ratio") is not None else ""
    title = f"{r['compound'].capitalize()} spike at {r['site']}, {r['date']} {hour_text(r['hour_cst'])}"
    reading = (f"{r['compound'].capitalize()} read {r['value_ppb']} ppb against a baseline of {r['baseline_ppb']} ppb"
               f"{ratio} at {r['site']} on {r['date']} in the hour starting {hour_text(r['hour_cst'])}.")
    lines = [reading, f"Record check: {STATUS_TEXT[status]}"]
    if r.get("reason") and status == "search_incomplete":
        lines.append(f"Why: {r['reason']}")
    replay = night_link(r["night_id"]) if r.get("night_id") else None
    lines += ([f"Replay this night: {replay}"] if replay else [])
    lines += [f"All spikes at this monitor: {monitor_link(r['site_id'])}", CAVEAT]
    return {"guid": f"plume-witness:{row_id(r)}", "title": title, "link": replay or monitor_link(r["site_id"]),
            "pub": pub_date(r["date"], r["hour_cst"]), "description": "\n".join(lines)}


def newest_first(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r["date"], r["hour_cst"], r["site_id"], r["param"]), reverse=True)


def build_feed(title: str, description: str, link: str, self_url: str, rows: list[dict]) -> bytes:
    rss = ET.Element("rss", {"version": "2.0"})
    ch = ET.SubElement(rss, "channel")
    ET.SubElement(ch, "title").text = title
    ET.SubElement(ch, "link").text = link
    ET.SubElement(ch, "description").text = description
    ET.SubElement(ch, "language").text = "en-us"
    ET.SubElement(ch, f"{{{ATOM}}}link", {"href": self_url, "rel": "self", "type": "application/rss+xml"})
    if rows:
        ET.SubElement(ch, "lastBuildDate").text = item_for(rows[0])["pub"]
    for r in rows:
        it = item_for(r)
        el = ET.SubElement(ch, "item")
        ET.SubElement(el, "title").text = it["title"]
        ET.SubElement(el, "link").text = it["link"]
        ET.SubElement(el, "guid", {"isPermaLink": "false"}).text = it["guid"]
        ET.SubElement(el, "pubDate").text = it["pub"]
        ET.SubElement(el, "description").text = it["description"]
    ET.indent(rss)
    return ET.tostring(rss, encoding="utf-8", xml_declaration=True) + b"\n"


def build_all(data: dict) -> tuple[dict[str, bytes], dict]:
    """Returns ({file name: feed bytes}, index dict)."""
    if data.get("schema") != SPIKES_SCHEMA or not isinstance(data.get("rows"), list) or not data["rows"]:
        raise FeedError(f"spikes.json is not a non-empty {SPIKES_SCHEMA}; run `uv run python -m pipeline.spikes`")
    rows = newest_first(data["rows"])
    files: dict[str, bytes] = {}
    index_feeds = []

    def add(fid: str, title: str, desc: str, link: str, subset: list[dict], total: int) -> None:
        url = f"{SITE}feeds/{fid}.xml"
        files[f"{fid}.xml"] = build_feed(title, desc, link, url, subset)
        index_feeds.append({"id": fid, "title": title, "url": url, "items": len(subset), "spikes_at_source": total})

    add("all", "Plume Witness: newest spikes", f"The {ALL_N} newest benzene and 1,3-butadiene spikes at Houston Ship "
        "Channel air monitors, each with what the state record shows. Hourly provisional data.",
        f"{SITE}?view=spikes", rows[:ALL_N], len(rows))
    sites: dict[str, str] = {}
    for r in rows:
        sites.setdefault(r["site_id"], r["site"])
    for sid in sorted(sites):
        mine = [r for r in rows if r["site_id"] == sid]
        add(sid, f"Plume Witness: spikes at {sites[sid]}", f"Benzene and 1,3-butadiene spikes at the {sites[sid]} "
            "air monitor, newest first, each with what the state record shows. Hourly provisional data.",
            monitor_link(sid), mine, len(mine))
    index = {"schema": SCHEMA, "generated_by": "uv run python -m pipeline.feeds", "source": "web/public/spikes.json",
             "all_feed_limit": ALL_N, "feeds": index_feeds}
    return files, index


def main() -> None:
    try:
        data = json.loads(SRC.read_text())
    except FileNotFoundError as e:
        raise SystemExit(f"{SRC} not found; run `uv run python -m pipeline.spikes` first") from e
    files, index = build_all(data)
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.xml"):
        if stale.name not in files:
            stale.unlink()
    for name, blob in files.items():
        (OUT / name).write_bytes(blob)
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"wrote {len(files)} feeds to {OUT.relative_to(ROOT)}: " + ", ".join(f"{f['id']}={f['items']}" for f in index["feeds"]))


if __name__ == "__main__":
    main()
