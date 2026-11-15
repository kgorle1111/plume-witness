"""Parse the raw TCEQ pages saved by fetch_tceq into plain Python values.

TCEQ yearly summaries are HTML pages wrapping comma-separated rows: `MM/DD/YYYY,<24 hourly values>`
in CST. Non-numeric cells are QA or calibration flags (ST, BL, LST, AQI, ...) and become None.
"""

import html
import re
from datetime import datetime
from decimal import Decimal
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


# One contaminant row of a STEERS detail page: the name cell, then its quantity cell in POUNDS. `_text` turns every
# tag into a line break, so the name starts its line and is the whole cell (never spans a line break).
CELL_RE = re.compile(r"^[ \t]*(\S[^\n]*?)\s+(\d[\d,]*\.?\d*)\s+POUNDS", re.MULTILINE)
# Whole-cell names of each monitored compound (AQS parameter code). Whole cell, so "Tetramethyl benzene", "Ethyl
# Benzene", "1,2-butadiene" or "2-Methyl-1,3 butadiene" are other compounds and never count as the monitored one.
# A bare "Butadiene" is 1,3-butadiene: the trade name, and how 419486 and 444761 list it (419486's own cause text
# says 1,3-Butadiene); reports that mean the 1,2 isomer write "1,2-butadiene".
COMPOUND_NAMES = {
    "45201": re.compile(r"benzene", re.IGNORECASE),
    "43218": re.compile(r"(?:1,3|1-3)[- ]?butadiene|butadiene(?:,? ?(?:1,3|1-3)-?|-1,3)?|buta-1,3-diene",
                        re.IGNORECASE),
}
# A lumped row that names benzene as one of its parts, "BTEX - benzene, toluene, ethylbenzene, xylene" (426454) or
# "Benzene/Toluene", lists benzene. Not when the row excludes it ("C5+ (not including benzene)") or is one compound's
# index name ("Benzene, (2-methylpropyl)-" is isobutylbenzene: a part that is a locant or substituent, starting with
# a digit or ending in "-", means the commas belong to a single name). Benzene only: 1,3-butadiene's own
# comma makes a lumped butadiene row unreadable this way, and none is in the 2024-25 pages.
LUMPED_SPLIT = re.compile(r"\s+-\s+|[,/;&:()]|\s+and\s+", re.IGNORECASE)
LUMPED_EXCLUDES = re.compile(r"\b(?:not|excluding|excludes|except|without|other than|less|non)\b", re.IGNORECASE)


def cell_param(cell: str) -> tuple[str, str] | None:
    """(AQS parameter, "named" | "lumped") for a contaminant name cell that lists a monitored compound, else None."""
    name = " ".join(cell.split())
    for param, rx in COMPOUND_NAMES.items():
        if rx.fullmatch(name):
            return param, "named"
    if LUMPED_EXCLUDES.search(name):
        return None
    parts = [p.strip() for p in LUMPED_SPLIT.split(name) if p.strip()]
    if len(parts) < 2 or any(p[0].isdigit() or p.endswith("-") for p in parts):
        return None
    return ("45201", "lumped") if any(COMPOUND_NAMES["45201"].fullmatch(p) for p in parts) else None


def contaminant_rows(text: str) -> list[tuple[str, str, str, Decimal]]:
    """(cell, AQS parameter, "named" | "lumped", pounds) for every row that lists a monitored compound."""
    out = []
    for cell, qty in CELL_RE.findall(text):
        hit = cell_param(cell)
        if hit:
            out.append((" ".join(cell.split()), *hit, Decimal(qty.replace(",", ""))))
    return out


def lbs_by_param(text: str) -> dict[str, float]:
    """Total reported pounds of each monitored compound named on its own row, across every emission point.

    `text` is `_text(path)` before whitespace is collapsed: the line breaks are the cell boundaries. The printed
    decimals are summed exactly, never rounded: a report listing 0.00001 lb of 1,3-butadiene lists it (415589).
    A lumped row's pounds are the mixture's, so they are never counted as the compound's (see lumped_by_param)."""
    rows = contaminant_rows(text)
    return {p: float(sum((q for _, rp, how, q in rows if rp == p and how == "named"), Decimal(0)))
            for p in COMPOUND_NAMES}


def lumped_by_param(text: str) -> dict[str, list[dict]]:
    """Lumped rows that name a monitored compound, per parameter: [{"cell", "pounds"}] (the mixture's pounds)."""
    out: dict[str, list[dict]] = {}
    for cell, p, how, q in contaminant_rows(text):
        if how == "lumped":
            out.setdefault(p, []).append({"cell": cell, "pounds": float(q)})
    return out


def lists_param(inc: dict, param: str) -> bool:
    """Does a parsed report (steers_incident) list a release of the compound: a positive amount on its own row, of
    any size, or a lumped row that names it? A row of 0 pounds is a listed zero, not a release."""
    return inc.get("lbs_by_param", {}).get(param, 0) > 0 or any(
        r["pounds"] > 0 for r in inc.get("lumped_by_param", {}).get(param, []))


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
        # An empty week counts only on a real results page that echoes its search criteria: an error or
        # maintenance page that happens to say "No results" must not read as a complete, empty week.
        real = "Search Results" in t and re.search(r"Search Criteria Event Start Date Range: \d{2}/\d{2}/\d{4} to", t)
        if real and ("No records" in t or "0 Records" in t or "No results were found" in t):
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


def _address(t: str) -> str:
    m = re.search(r"Physical Location: (.+?) County:", t)
    return m.group(1).strip() if m else ""


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
        "address": _address(t),
        "entity": _after("Regulated Entity Name", t, "RN:"),
        "start_local": datetime.strptime(started, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "end_local": datetime.strptime(ended, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "notified_local": datetime.strptime(notified, "%m/%d/%Y %I:%M %p").isoformat(timespec="minutes"),
        "compound": m.group(1).strip() if m else None,
        "pounds": float(m.group(2).replace(",", "")) if m else None,
        "cause": _after("Reason for Scheduled Activity", t, ".") if "Reason for Scheduled Activity" in t else None,
        "lbs_by_param": lbs_by_param(_text(path)),
        "lumped_by_param": lumped_by_param(_text(path)),
        # The page's own report fields. "FINAL" appears in the text of every page, so it is never searched for.
        "report_type": _after("Report Type:", t, "Report Date") if "Report Type:" in t else None,
        "report_date": _report_date(t),
        "revisions": steers_revisions(t),
    }
