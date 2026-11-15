"""Guarded Gemini drafter for the evidence packet: deterministic facts -> one structured call -> guard.

The model only rewrites facts we hand it. A deterministic guard then rejects any draft that contains a
number or id not present in those facts, a banned verdict word, or an out-of-bounds length. On any
failure (no draft, API error, guard reject) it fails closed to the deterministic template packet that
the build already put in `event["packet"]`, with `guard.passed = False` and the reasons listed.
A person reviews and edits whatever this returns; nothing here is sent anywhere.

Usage:
  GEMINI_API_KEY=... uv run python -m pipeline.gemini_draft --event web/public/event.json \
      --out data/build/packet.gemini.json
"""

import argparse
import json
import logging
import os
import re
import sys
import time
import unicodedata
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from pipeline.contract import validate

log = logging.getLogger("pipeline.gemini_draft")

# Model and price verified 2026-11-14 against https://aistudio.google.com/docs/models/gemini-3.8-flash
# and https://aistudio.google.com/docs/pricing (ai.google.dev/gemini-api/docs/* now 301s there).
# kn: Flash picked per the build brief; gemini-3.5-flash-lite (~2.5x cheaper input) is the first
# candidate to try once there is an eval set of real events to compare drafts on.
MODEL = "gemini-3.8-flash"
TIMEOUT_MS = 30_000
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
RETRY_WAIT_S = 2.0
MAX_OUTPUT_TOKENS = 4096  # thinking tokens count against this; drafts themselves are ~500 tokens
MIN_CHARS, MAX_CHARS = 150, 1600  # the template drafts run ~700 chars
TOP_FACILITIES = 5

DRAFTED_BY_GEMINI = f"Gemini ({MODEL}), checked by the deterministic guard; a person must review"

# Substring stems on casefolded text with format characters stripped, so "Illegally" and "il​legal"
# both hit. Spanish stems cover the same verdicts for draft_es.
BANNED = (
    "illegal", "violat", "unreported", "polluter", "caught", "catches", "proves", "proven", "proof that",
    "ilegal", "violaci", "infracci", "contaminador", "no reportad", "demuestra", "comprueba", "prueba que",
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "draft_en": {"type": "string", "description": "Plain-language English packet summary."},
        "draft_es": {"type": "string", "description": "The same summary in plain-language Spanish."},
    },
    "required": ["draft_en", "draft_es"],
}

PROMPT = """You draft a short evidence summary for community advocates. A person will review and edit it
before anything is filed. Use ONLY the facts in the JSON below. Do not add any number, id, name, date,
time, or cause that is not in the facts.

Rules:
1. Hedge. Say readings are "consistent with" a release; never say a facility caused anything.
2. Never use these words or their forms: illegal, violation, unreported, caught, catches, proves,
   polluter. In Spanish never use: ilegal, violación, infracción, no reportado, contaminador, demuestra.
3. Plain language a 6th grader can follow. Short sentences. 90 to 180 words each.
4. Copy every number exactly as it appears in the facts, with digits, "." for decimals and "," for
   thousands, in BOTH languages (write 51.75 and 7,634 in Spanish too). Do not round, convert units,
   or spell numbers out. Monitor hours are CST; the company report times are local time. Say which.
5. Mention the monitor reading and its baseline, the wind, how many facilities are in the upwind
   corridor, and the record-check result. If a report was found, name the facility, the report number,
   and the reported pounds and times. End with one requested follow-up question.
6. Respect everything listed under cannot_say. Do not claim more than the facts show.
7. draft_en is English. draft_es is the same content in Spanish.

Facts:
"""


class MissingKeyError(RuntimeError):
    """Raised when no client is passed and GEMINI_API_KEY is not set."""


def facts_for(event: dict[str, Any]) -> dict[str, Any]:
    """The subset of the event the model sees. Every value comes straight from the event, except the
    corridor facility count, which is len(event['facilities'])."""
    det = event["detection"]
    h = det["hour_cst"]
    rc = event["record_check"]
    return {
        "title": event["title"],
        "date_local": event["date_local"],
        "time_note": event["time_note"],
        "compound": event["compound"]["name"],
        "units": event["compound"]["units"],
        "detection": {k: det[k] for k in ("site_id", "hour_cst", "value", "baseline", "rule")},
        "monitors_over_trigger_that_hour": [
            {"site_id": m["site_id"], "name": m["name"], "value": m["hourly"][h]["value"],
             "baseline": m["baseline"]}
            for m in event["monitors"] if m["triggered"]
        ],
        "wind_at_detection_hour": {**event["wind"]["hourly"][h], "site_id": event["wind"]["site_id"]},
        "upwind_corridor_facility_count": len(event["facilities"]),
        "nearest_upwind_facilities": [
            {k: f[k] for k in ("id", "name", "distance_km", "rank")} for f in event["facilities"][:TOP_FACILITIES]
        ],
        "record_check": {
            "status": rc["status"],
            "incident": rc.get("incident"),
            "matched_facility_id": rc["matched_facility_id"],
            "checks": rc["checks"],
            "reported": {k: v for k, v in (rc.get("reported") or {}).items()
                         if k in ("facility", "compound", "pounds", "start_local", "end_local", "tz")},
        },
        "cannot_say": event["cannot_say"],
    }


def build_prompt(facts: dict[str, Any]) -> str:
    return PROMPT + json.dumps(facts, ensure_ascii=False, indent=1)


# --- deterministic guard -----------------------------------------------------------------------------

# A thousands-grouped number, or a plain integer/decimal. "1,3-butadiene" stays two tokens (1 and 3).
_NUM = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
# Ids that must match character for character: AQS site ids, TCEQ RNs, and long digit runs
# (STEERS incident numbers are 6 digits, EPA registry ids 12).
_ID = re.compile(r"\b\d{2}_\d{3}_\d{4}\b|\bRN\d{6,}\b|(?<![\d.,])\d{6,}(?![\d])")


# Clock times are checked as times, not as two loose integers: "9:00 a.m." must be a detection hour,
# "09:38" or "9:38" must be a time in the facts (12-hour forms of each are allowed too).
_TIME = re.compile(r"(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])")


def _canon(token: str) -> str:
    """'7,634' and 7634.0 -> '7634'; '06' -> '6'; '51.750' -> '51.75'."""
    try:
        d = Decimal(token.replace(",", ""))
    except InvalidOperation:
        return token
    if d == d.to_integral_value():
        return str(int(d))
    return format(d.normalize(), "f")


def _walk(obj: Any) -> list[Any]:
    if isinstance(obj, dict):
        return [x for v in obj.values() for x in _walk(v)]
    if isinstance(obj, list):
        return [x for v in obj for x in _walk(v)]
    return [obj]


def allowed_times(facts: dict[str, Any], strings: set[str]) -> set[tuple[int, str]]:
    times = {(int(h), m) for s in strings for h, m in _TIME.findall(s)}
    times |= {(facts["detection"]["hour_cst"], "00")}
    return times | {((h % 12) or 12, m) for h, m in times}


def allowed_tokens(facts: dict[str, Any]) -> tuple[set[str], set[str]]:
    """(canonical numbers, verbatim strings) present anywhere in the facts."""
    nums: set[str] = set()
    strings: list[str] = []
    for leaf in _walk(facts):
        if isinstance(leaf, bool) or leaf is None:
            continue
        if isinstance(leaf, int | float):
            nums.add(_canon(repr(leaf)))
            strings.append(repr(leaf))
        else:
            strings.append(str(leaf))
            nums.update(_canon(t) for t in _NUM.findall(str(leaf)))
    return nums, set(strings)


def _clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


def guard(drafts: dict[str, Any], facts: dict[str, Any]) -> list[str]:
    """Return the reasons to reject; empty means the drafts pass."""
    rejected: list[str] = []
    nums, strings = allowed_tokens(facts)
    times = allowed_times(facts, strings)
    ids = {tok for s in strings for tok in _ID.findall(s)}
    for field in ("draft_en", "draft_es"):
        text = drafts.get(field)
        if not isinstance(text, str):
            rejected.append(f"{field}: missing or not a string")
            continue
        text = _clean(text)
        if not MIN_CHARS <= len(text) <= MAX_CHARS:
            rejected.append(f"{field}: length {len(text)} outside {MIN_CHARS}-{MAX_CHARS} chars")
        low = text.casefold()
        for stem in BANNED:
            if stem in low:
                rejected.append(f"{field}: banned word '{stem}'")
        for h, m in _TIME.findall(text):
            if (int(h), m) not in times:
                rejected.append(f"{field}: time '{h}:{m}' is not in the event facts")
        for tok in _NUM.findall(_TIME.sub(" ", text)):
            if _canon(tok) not in nums:
                rejected.append(f"{field}: number '{tok}' is not in the event facts")
        for tok in _ID.findall(text):
            if tok not in ids:
                rejected.append(f"{field}: id '{tok}' is not in the event facts")
    # kn: the number check is set membership, so a wrong number that exists elsewhere in the facts
    # (an hour 0-23, a rank) passes, and spelled-out numbers and invented names are not checked.
    # Upgrade path: bind each number to its field (value, pounds, hour) and check names against facts.
    return rejected


# --- the call ----------------------------------------------------------------------------------------

def _status(exc: BaseException) -> int | None:
    code = getattr(exc, "code", None)
    if code is None:
        code = getattr(exc, "status_code", None)
    return code if isinstance(code, int) else None


def make_client(timeout_ms: int = TIMEOUT_MS):
    """Real google-genai client, key from GEMINI_API_KEY only. SDK retries are off; `draft` owns retry."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise MissingKeyError("GEMINI_API_KEY is not set; export it to draft with Gemini, or keep the "
                              "template packet the build already wrote.")
    from google import genai
    from google.genai import types

    return genai.Client(api_key=key, http_options=types.HttpOptions(
        timeout=timeout_ms, retry_options=types.HttpRetryOptions(attempts=1)))


def _config():
    from google.genai import types

    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_json_schema=RESPONSE_SCHEMA,
        temperature=0.2,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
    )


def _redact(text: str) -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    return text.replace(key, "[REDACTED]") if key else text


def _call(client, model: str, prompt: str, sleep: Callable[[float], None]) -> dict[str, Any]:
    """One structured call; a single retry only on 429/5xx. Raises on anything else."""
    for attempt in (1, 2):
        t0 = time.monotonic()
        try:
            resp = client.models.generate_content(model=model, contents=prompt, config=_config())
        except Exception as exc:
            code = _status(exc)
            log.warning("gemini call failed model=%s attempt=%d status=%s type=%s after %.1fs",
                        model, attempt, code, type(exc).__name__, time.monotonic() - t0)
            if attempt == 1 and code in RETRY_STATUS:
                sleep(RETRY_WAIT_S)
                continue
            raise
        log.info("gemini call ok model=%s attempt=%d in %.1fs", model, attempt, time.monotonic() - t0)
        text = getattr(resp, "text", None)
        if not text:
            raise ValueError("Gemini returned no text (blocked, or max_output_tokens spent on thinking)")
        out = json.loads(text)
        if not isinstance(out, dict):
            raise TypeError("Gemini output is not a JSON object")
        return out
    raise AssertionError("unreachable")


def _fallback(event: dict[str, Any], rejected: list[str]) -> dict[str, Any]:
    base = event["packet"]
    return {"draft_en": base["draft_en"], "draft_es": base["draft_es"],
            "drafted_by": f"{base['drafted_by']}; Gemini draft not used",
            "guard": {"passed": False, "rejected": [_redact(r) for r in rejected]}}


def draft(event: dict[str, Any], client=None, model: str = MODEL,
          sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    """Return a contract `packet`. `event['packet']` must hold the deterministic template draft; it is
    the fail-closed fallback. Raises MissingKeyError if no client is given and the key is unset."""
    errs = validate(event)
    if errs:
        raise ValueError("event failed the contract, refusing to draft:\n- " + "\n- ".join(errs))
    if not str(event["packet"].get("drafted_by", "")).startswith("template"):
        raise ValueError("event['packet'] must be the deterministic template draft (it is the fallback); "
                         f"got drafted_by={event['packet'].get('drafted_by')!r}")
    if client is None:
        client = make_client()
    facts = facts_for(event)
    try:
        drafts = _call(client, model, build_prompt(facts), sleep)
    except Exception as exc:  # noqa: BLE001 -- fail closed on anything the SDK or the parse throws
        reason = f"gemini call failed: {type(exc).__name__} (status {_status(exc)})"
        log.warning("falling back to template: %s", reason)
        return _fallback(event, [reason])
    drafts = {k: _redact(v) if isinstance(v, str) else v for k, v in drafts.items()}
    rejected = guard(drafts, facts)
    if rejected:
        log.warning("guard rejected the Gemini draft: %s", _redact("; ".join(rejected)))
        return _fallback(event, rejected)
    return {"draft_en": _clean(drafts["draft_en"]), "draft_es": _clean(drafts["draft_es"]),
            "drafted_by": DRAFTED_BY_GEMINI.replace(MODEL, model), "guard": {"passed": True, "rejected": []}}


MAX_EVENT_BYTES = 5_000_000


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--event", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.event.stat().st_size > MAX_EVENT_BYTES:
        print(f"{args.event} is over {MAX_EVENT_BYTES} bytes; refusing to read it", file=sys.stderr)
        return 2
    event = json.loads(args.event.read_text())
    try:
        packet = draft(event, model=args.model)
    except (MissingKeyError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(packet, ensure_ascii=False, indent=1))
    g = packet["guard"]
    print(f"wrote {args.out}: drafted_by={packet['drafted_by']!r} guard.passed={g['passed']}")
    for r in g["rejected"]:
        print(f"  rejected: {r}")
    return 0 if g["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
