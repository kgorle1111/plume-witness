"""The event.json contract between the pipeline and the web app (schema plume-witness.event/v1).

The web app renders only what this file says. Every number shown must come from here, and every
field the demo calls "real" must trace to `provenance`. `validate` is the gate the build runs.
"""

from typing import Any

SCHEMA = "plume-witness.event/v1"
STATUSES = ("reported", "not_yet_reported", "no_report_after_deadline", "reported_mismatch", "search_incomplete")
LABELS = ("real", "fixture")

REQUIRED_TOP = ("schema", "label", "event_id", "title", "date_local", "time_note", "compound", "monitors",
                "wind", "detection", "facilities", "record_check", "packet", "cannot_say", "provenance")


def _need(obj: dict, keys: tuple[str, ...], where: str, errors: list[str]) -> None:
    for k in keys:
        if k not in obj:
            errors.append(f"{where}: missing '{k}'")


def validate(ev: dict[str, Any]) -> list[str]:
    """Return a list of contract violations; empty means valid."""
    errors: list[str] = []
    _need(ev, REQUIRED_TOP, "event", errors)
    if errors:
        return errors
    if ev["schema"] != SCHEMA:
        errors.append(f"schema must be {SCHEMA}")
    if ev["label"] not in LABELS:
        errors.append(f"label must be one of {LABELS}")
    for i, m in enumerate(ev["monitors"]):
        _need(m, ("site_id", "name", "lat", "lon", "hourly", "baseline", "peak", "triggered"), f"monitors[{i}]", errors)
        if len(m.get("hourly", [])) != 24:
            errors.append(f"monitors[{i}].hourly must have 24 hours (CST)")
    if len(ev["wind"].get("hourly", [])) != 24:
        errors.append("wind.hourly must have 24 hours (CST)")
    _need(ev["detection"], ("site_id", "hour_cst", "value", "baseline", "rule"), "detection", errors)
    ranks = [f.get("rank") for f in ev["facilities"]]
    if ranks != sorted(ranks):
        errors.append("facilities must be sorted by rank")
    for i, f in enumerate(ev["facilities"]):
        _need(f, ("id", "name", "lat", "lon", "distance_km", "bearing_deg", "alignment", "rank", "in_corridor", "source"),
              f"facilities[{i}]", errors)
    rc = ev["record_check"]
    _need(rc, ("status", "checks", "source_url", "matched_facility_id", "search_scope"), "record_check", errors)
    if rc.get("status") not in STATUSES:
        errors.append(f"record_check.status must be one of {STATUSES}")
    for c in rc.get("checks", []):
        if c.get("status") not in STATUSES:
            errors.append(f"record_check.checks status '{c.get('status')}' not allowed")
    banned = ("illegal", "violation", "unreported", "polluter", "caught")
    text = " ".join(str(v) for v in (ev["packet"].get("draft_en", ""), ev["packet"].get("draft_es", ""), ev["title"]))
    for word in banned:
        if word in text.lower():
            errors.append(f"banned word in user-facing text: '{word}'")
    if not ev["cannot_say"]:
        errors.append("cannot_say must list what the tool cannot claim")
    if ev["label"] == "real" and not ev["provenance"]:
        errors.append("a real event needs provenance")
    return errors
