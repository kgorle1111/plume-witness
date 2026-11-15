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


def _after(label: str, text: str, until: str) -> str:
    i = text.find(label)
    if i < 0:
        raise ValueError(f"STEERS page: '{label}' not found; the page format may have changed")
    rest = text[i + len(label):]
    j = rest.find(until)
    return rest[: j if j >= 0 else 120].strip(" :")


def steers_search(path: Path) -> dict:
    """Rows of a STEERS search results page plus the 'a-b of N Records' count (results cap at 50 per page)."""
    t = re.sub(r"\s+", " ", _text(path))
    m = re.search(r"(\d+)-(\d+) of (\d+) Records", t)
    if not m:
        if "No records" in t or "0 Records" in t or "No results were found" in t:
            return {"rows": [], "shown": 0, "total": 0}
        raise ValueError(f"{path.name}: no record count found; the STEERS results format may have changed")
    rows = [{"incident": inc, "rn": rn, "entity": name.strip(), "began": began}
            for inc, rn, name, began in re.findall(
                r"(\d{6}) (RN\d{9}) (.+?) (\d{2}/\d{2}/\d{4} \d{2}:\d{2} [AP]M)", t)]
    return {"rows": rows, "shown": int(m.group(2)) - int(m.group(1)) + 1, "total": int(m.group(3))}


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
        "final": "VERIFIED" in t or "FINAL" in t,
    }
