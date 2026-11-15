"""Parse the raw TCEQ pages saved by fetch_tceq into plain Python values.

TCEQ yearly summaries are HTML pages wrapping comma-separated rows: `MM/DD/YYYY,<24 hourly values>`
in CST. Non-numeric cells are QA or calibration flags (ST, BL, LST, AQI, ...) and become None.
"""

import html
import re
from datetime import datetime
from pathlib import Path


def _text(path: Path) -> str:
    raw = path.read_text(encoding="latin-1")
    raw = re.sub(r"<(script|style).*?</\1>", "", raw, flags=re.DOTALL | re.IGNORECASE)
    return html.unescape(re.sub(r"<[^>]+>", "\n", raw))


def _num(cell: str) -> float | None:
    try:
        return float(cell)
    except ValueError:
        return None


def hourly_table(path: Path) -> dict[str, list[float | None]]:
    """Map 'MM/DD/YYYY' -> 24 hourly values (CST); flags become None."""
    rows: dict[str, list[float | None]] = {}
    for line in _text(path).splitlines():
        parts = [p.strip() for p in line.strip().split(",")]
        if len(parts) >= 25 and re.fullmatch(r"\d{2}/\d{2}/\d{4}", parts[0]):
            rows[parts[0]] = [_num(c) for c in parts[1:25]]
    if not rows:
        raise ValueError(f"{path.name}: no hourly rows found; the TCEQ page format may have changed")
    return rows


def hourly_flags(path: Path, day: str) -> list[str | None]:
    """The raw cell text for one day, so flagged hours can be labeled in the UI."""
    for line in _text(path).splitlines():
        parts = [p.strip() for p in line.strip().split(",")]
        if parts and parts[0] == day and len(parts) >= 25:
            return [None if _num(c) is not None else c for c in parts[1:25]]
    raise ValueError(f"{path.name}: day {day} not found")


# Reported pounds per AQS parameter code. The lookbehind stops "methylbenzene" or "1,2-butadiene"-style names
# from counting as the monitored compound.
COMPOUND_RE = {
    "45201": re.compile(r"(?<![A-Za-z-])benzene (\d[\d,]*\.?\d*) POUNDS", re.IGNORECASE),
    "43218": re.compile(r"(?<![A-Za-z-])(?:1,3[- ]?butadiene|butadiene, ?1-3) (\d[\d,]*\.?\d*) POUNDS",
                        re.IGNORECASE),
}


def lbs_by_param(text: str) -> dict[str, float]:
    """Total reported pounds per monitored compound across every emission point on a STEERS detail page."""
    return {p: round(sum(float(x.replace(",", "")) for x in rx.findall(text)), 3) for p, rx in COMPOUND_RE.items()}


def _after(label: str, text: str, until: str) -> str:
    i = text.find(label)
    if i < 0:
        raise ValueError(f"STEERS page: '{label}' not found; the page format may have changed")
    rest = text[i + len(label):]
    j = rest.find(until)
    return rest[: j if j >= 0 else 120].strip(" :")


def steers_search(path: Path) -> dict:
    """Rows of a STEERS search results page plus the 'a-b of N Records' count (results cap at 50 per page).

    `ended` is the page's own Ended column (local time), or None when the row has none.
    """
    t = re.sub(r"\s+", " ", _text(path))
    m = re.search(r"(\d+)-(\d+) of (\d+) Records", t)
    if not m:
        if "No records" in t or "0 Records" in t or "No results were found" in t:
            return {"rows": [], "shown": 0, "total": 0}
        raise ValueError(f"{path.name}: no record count found; the STEERS results format may have changed")
    stamp = r"\d{2}/\d{2}/\d{4} \d{2}:\d{2} [AP]M"
    rows = [{"incident": inc, "rn": rn, "entity": name.strip(), "began": began, "ended": ended or None}
            for inc, rn, name, began, ended in re.findall(
                rf"(\d{{6}}) (RN\d{{9}}) (.+?) ({stamp})(?: ({stamp}))?", t)]
    return {"rows": rows, "shown": int(m.group(2)) - int(m.group(1)) + 1, "total": int(m.group(3))}


def _report_date(t: str) -> str | None:
    m = re.search(r"Report Date: (\d{2}/\d{2}/\d{4})", t)
    return datetime.strptime(m.group(1), "%m/%d/%Y").date().isoformat() if m else None


# Only the quoted email form is parsed: the quote marks give a hard end to the company's words. The page's other
# update form, "UPDATE (5/30/2024): free text", runs on into the next field with nothing to cut it at, so it is skipped.
REVISION_RE = re.compile(r'UPDATE VIA EMAIL ON (\d{2}/\d{2}/\d{4}): ["\u201c](.{1,120}?)["\u201d](?= |$)')


def steers_revisions(t: str) -> list[dict]:
    """Dated, quoted revision lines on a STEERS detail page (whitespace-collapsed text): [{date ISO, text <= 120}]."""
    out = []
    for d, quote in REVISION_RE.findall(t):
        try:
            iso = datetime.strptime(d, "%m/%d/%Y").date().isoformat()
        except ValueError:
            continue
        out.append({"date": iso, "text": quote.strip()})
    return out


def steers_incident(path: Path) -> dict:
    """Key facts from a STEERS emissions-event detail page (times are local, as published)."""
    t = re.sub(r"\s+", " ", _text(path))
    started = _after("Event Discovered or Scheduled Activity Start", t, "Date and Time Event")
    ended = _after("Event or Scheduled Activity Ended", t, "Event Duration")
    notified = _after("Initial Notification Date/Time", t, "Method")
    m = re.search(r"Authorization (\w[\w ,-]*?) (\d[\d,.]*) POUNDS", t)
    return {
        "incident": path.stem.split("_")[-1],
        "rn": _after("RN:", t, "Physical Location"),
        "entity": _after("Regulated Entity Name", t, "RN:"),
        "start_local": datetime.strptime(started, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "end_local": datetime.strptime(ended, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "notified_local": datetime.strptime(notified, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "compound": m.group(1).strip() if m else None,
        "pounds": float(m.group(2).replace(",", "")) if m else None,
        "cause": _after("Reason for Scheduled Activity", t, ".") if "Reason for Scheduled Activity" in t else None,
        "lbs_by_param": lbs_by_param(t),
        # The page's own report fields. "FINAL" appears in the text of every page, so it is never searched for.
        "report_type": _after("Report Type:", t, "Report Date") if "Report Type:" in t else None,
        "report_date": _report_date(t),
        "revisions": steers_revisions(t),
    }
