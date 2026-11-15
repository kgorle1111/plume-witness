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


# Each check below was added for a class of hallucination the guard-escape eval (evals/guard_escape)
# measured leaking; RESULTS.md there has the before/after catch rates.

# Inflections and close synonyms of the BANNED verdicts, matched on word starts so "improve" and
# "approved" stay clean. Bare "prove"/"demostrar" are left out: "Can the company prove..." is a fair
# follow-up question.
_BANNED_RE = re.compile(
    r"\bunlawful|\bguilty\b|\bcatch(?:es|ing)?\b|\bprov(?:ed|ing)\b"
    r"|\bviol(?:ó|aron|an?|ar|ando|ad[oa]s?)\b|\binfring|\bdemostr(?:ó|aron|ad[oa]s?)\b|\bcomprobad[oa]s?\b"
    r"|\bprueban que\b|\bculpables?\b|\batrapad[oa]s?\b|\bno\s+(?:\w+\s+){0,2}reportad[oa]s?\b"
    r"|\bno\s+report(?:ó|aron)\b")

# --- spelled-out numbers: rewritten to digits so the number, unit and hour checks see them ---
_EN_NUM = {w: i for i, w in enumerate((
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"))}
_EN_NUM |= {w: 10 * i for i, w in enumerate(
    ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"), 2)}
_ES_NUM = {w: i for i, w in enumerate((  # accent-folded, like the text they are matched against
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
    "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno",
    "veintidos", "veintitres", "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho",
    "veintinueve"))}
_ES_NUM |= {"un": 1, "una": 1, "veintiun": 21, "veintiuna": 21, "cien": 100, "ciento": 100}
_ES_NUM |= {w: 10 * i for i, w in enumerate(
    ("treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"), 3)}
_ES_NUM |= {f"{p}{s}": 100 * n for p, n in (("dos", 2), ("tres", 3), ("cuatro", 4), ("quin", 5), ("seis", 6),
                                            ("sete", 7), ("ocho", 8), ("nove", 9))
            for s in (("ientos", "ientas") if p == "quin" else ("cientos", "cientas"))}
_SCALE = {"hundred": 100, "thousand": 1000, "million": 10**6, "billion": 10**9, "mil": 1000, "millon": 10**6,
          "millones": 10**6}
_WORDS = {"en": (_EN_NUM, ("and",), ("point",)), "es": (_ES_NUM, ("y",), ("coma", "punto"))}
# A lone article/pronoun is not a number ("One of them", "un informe"); it still counts inside a phrase.
_NOT_ALONE = {"one", "un", "una", "uno"}
_WORD = re.compile(r"[^\W\d_]+")
_DIGIT_SCALE = re.compile(r"(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)\s+(thousand|million|billion|mil|"
                          r"mill[oó]n|millones)\b", re.IGNORECASE)
_UNIT_PHRASES = ((re.compile(r"\bparts per billion\b|\bpartes por mil millones\b", re.IGNORECASE), "ppb"),
                 (re.compile(r"\bmiles per hour\b|\bmillas por hora\b", re.IGNORECASE), "mph"))


def _fold(word: str) -> str:
    decomposed = unicodedata.normalize("NFD", word.casefold())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def _spelled_value(words: list[str], lang: str) -> Decimal | None:
    table, _, points = _WORDS[lang]
    total, current, decimals, in_decimals = 0, 0, "", False
    for w in words:
        if w in points:
            in_decimals = True
        elif in_decimals:
            if table.get(w, 10) > 9:
                return None
            decimals += str(table[w])
        elif w in table:
            current += table[w]
        elif w == "hundred":
            current = (current or 1) * 100
        elif w in _SCALE:
            total, current = total + (current or 1) * _SCALE[w], 0
    value = total + current
    return Decimal(f"{value}.{decimals}") if decimals else Decimal(value)


def normalize_numbers(text: str, lang: str) -> str:
    """'forty-seven' -> '47', 'siete mil seiscientos' -> '7600', '7.6 thousand' -> '7600',
    'parts per billion' -> 'ppb'. Lets the digit checks see numbers written in words."""
    for pat, unit in _UNIT_PHRASES:
        text = pat.sub(unit, text)

    def scaled(m: re.Match) -> str:
        tok = m[1] if re.fullmatch(r"\d{1,3}(?:,\d{3})+", m[1]) else m[1].replace(",", ".")
        return _canon(str(Decimal(tok.replace(",", "")) * _SCALE[_fold(m[2])]))

    text = _DIGIT_SCALE.sub(scaled, text)
    table, joiners, points = _WORDS[lang]
    toks = [(m.start(), m.end(), _fold(m[0])) for m in _WORD.finditer(text)]
    spans: list[tuple[int, int, str]] = []
    i = 0
    while i < len(toks):
        j = i
        if lang == "en" and toks[i][2] == "a" and i + 1 < len(toks) and toks[i + 1][2] in _SCALE:
            j = i + 1  # "a hundred"
        if toks[j][2] not in table and toks[j][2] not in _SCALE:
            i += 1
            continue
        words = ["one"] if j > i else []
        k = j
        while k < len(toks):
            w = toks[k][2]
            glued = k == j or re.fullmatch(r"[\s-]+", text[toks[k - 1][1]:toks[k][0]])
            if not glued:
                break
            nxt = toks[k + 1][2] if k + 1 < len(toks) else ""
            # "and"/"y"/"point" join only between number words: "forty and" alone is not a number
            joins = (w in joiners or w in points) and words and nxt in table
            if w in table or w in _SCALE or joins:
                words.append(w)
            else:
                break
            k += 1
        if not (len(words) == 1 and words[0] in _NOT_ALONE):
            value = _spelled_value([w for w in words if w not in joiners], lang)
            if value is not None:
                spans.append((toks[i][0], toks[k - 1][1], _canon(str(value))))
        i = k
    out, at = [], 0
    for start, end, digits in spans:
        out += [text[at:start], digits]
        at = end
    return "".join(out) + text[at:]


# --- units: a number must be one of the facts' values of the kind its unit measures ---
_QTY_NUM = r"(?<![\d.,:_])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d:_])"
_UNIT = {
    "concentration": r"ppbv|ppb(?:-v)?",
    "pounds": r"pounds?|lbs?|libras?",
    "degrees": r"degrees?|grados?|°(?![CF])",
    "mph": r"mph",
    "facility count": r"facilit(?:y|ies)|instalaci(?:ón|ones)|plants?|plantas?",
    "km": r"km|kilomet(?:er|re)s?|kilómetros?|kilometros?",
}
_QTY = re.compile(_QTY_NUM + r"((?:\s+[^\W\d_]+){0,3}?)\s*(?:(" + ")|(".join(_UNIT.values()) + r"))(?!\w)",
                  re.IGNORECASE)
_UNIT_KEYS = {"value": "concentration", "baseline": "concentration", "pounds": "pounds",
              "from_deg": "degrees", "speed_mph": "mph", "upwind_corridor_facility_count": "facility count",
              "distance_km": "km"}
# Units that never appear in a packet: a real number with one of these is a unit or scale swap.
_FOREIGN_UNIT = re.compile(r"\b(?:ppmv?|ppt|ppbc|kgs?|kilograms?|kilos?|kilogramos?|tons?|tonnes?|toneladas?|"
                           r"grams?|gramos?|km/h|kph|kmh|knots?|nudos?|celsius|fahrenheit|m/s)(?!\w)"
                           r"|[µu]g/m[3³]|mg/m[3³]|°\s?[CF]\b", re.IGNORECASE)


def _quantities(text: str) -> list[tuple[str, str]]:
    """(unit kind, canonical number) for every number followed within three words by a unit."""
    kinds = list(_UNIT)
    out = []
    for m in _QTY.finditer(text):
        kind = next(kinds[i] for i, g in enumerate(m.groups()[2:]) if g is not None)
        out.append((kind, _canon(m[1])))
    return out


def allowed_quantities(facts: dict[str, Any], strings: set[str]) -> dict[str, set[str]]:
    allowed: dict[str, set[str]] = {k: set() for k in _UNIT}

    def walk(obj: Any, key: str | None = None) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, k)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, key)
        elif isinstance(obj, int | float) and not isinstance(obj, bool) and key in _UNIT_KEYS:
            allowed[_UNIT_KEYS[key]].add(_canon(repr(obj)))

    walk(facts)
    if isinstance(facts.get("nearest_upwind_facilities"), list):
        allowed["facility count"].add(str(len(facts["nearest_upwind_facilities"])))
    for s in strings:
        for kind, num in _quantities(s):
            allowed[kind].add(num)
    return allowed


# --- dates and hours ---
_MONTHS_EN = ("january", "february", "march", "april", "may", "june", "july", "august", "september",
              "october", "november", "december")
_MONTHS_ES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
              "octubre", "noviembre", "diciembre")
_DATE_EN = re.compile(r"\b(" + "|".join(m.capitalize() for m in _MONTHS_EN) + r")\s+(\d{1,2})(?:st|nd|rd|th)?"
                      r"(?![\d:])(?:,?\s+(\d{4}))?")
_DATE_ES = re.compile(r"(?<![\d:.,])(\d{1,2})\s+de\s+(" + "|".join(_MONTHS_ES) + r"|setiembre)\b"
                      r"(?:\s+(?:de|del)\s+(\d{4}))?", re.IGNORECASE)
_DATE_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_AMPM = r"(a\.?\s?m\.?|p\.?\s?m\.?)(?!\w)"
_CLOCK_AMPM = re.compile(r"(?<![\d:])(\d{1,2}):(\d{2})\s*" + _AMPM, re.IGNORECASE)
# Bare hours: "10 a.m.", "9 CST", "hour 9" / "hora 9". An hour stated in CST, or as "hour N", is the
# monitor hour, so it must be the detection hour; any other bare hour must be the hour of a fact time.
_ZONE = r"(?:\s+(CST|CDT|CT)\b)?"
_BARE_HOUR = re.compile(r"(?<![\d:.,])(\d{1,2})\s*" + _AMPM + _ZONE
                        + r"|(?<![\d:.,])(\d{1,2})\s+(CST|CDT|CT)\b"
                        + r"|\b(?:hour|hora)\s+(?:de\s+las\s+)?(\d{1,2})(?![\d:.,])" + _ZONE, re.IGNORECASE)


def _dates(text: str) -> list[tuple[str, int | None, int, int]]:
    """(as written, year or None, month, day) for each date in the text."""
    out = [(m[0], int(m[3]) if m[3] else None, _MONTHS_EN.index(m[1].lower()) + 1, int(m[2]))
           for m in _DATE_EN.finditer(text)]
    for m in _DATE_ES.finditer(text):
        month = m[2].lower().replace("setiembre", "septiembre")
        out.append((m[0], int(m[3]) if m[3] else None, _MONTHS_ES.index(month) + 1, int(m[1])))
    out += [(m[0], int(m[1]), int(m[2]), int(m[3])) for m in _DATE_ISO.finditer(text)]
    return out


def _to24(h: int, marker: str) -> int:
    return h % 12 + (12 if marker.lower().startswith("p") else 0)


# --- names: capitalized runs must come from the facts ---
_CAP_WORD = re.compile(r"[^\W\d_][\w'’&-]*")
_SENTENCE_END = re.compile(r"[.?!:;][\s¿¡\"'“‘«(]*$|^[\s¿¡\"'“‘«(]*$")
# Proper nouns a faithful packet uses that the facts spell differently or not at all.
_NAME_OK = {_fold(w) for w in (
    "Texas", "Houston", "Harris", "County", "TCEQ", "EPA", "ECHO", "STEERS", "AQS", "AutoGC", "HRM", "CST",
    "CDT", "CT", "UTC", "AM", "PM", "I", "English", "Spanish", "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")}
_NAME_OK |= set(_MONTHS_EN) | set(_MONTHS_ES)


def _name_words(s: str) -> set[str]:
    return {_fold(w).removesuffix("'s").removesuffix("’s").rstrip("'’") for w in _CAP_WORD.findall(s)}


def unknown_names(text: str, fact_words: list[set[str]], lang: str) -> list[str]:
    """Capitalized word runs whose words do not all come from one fact string. The first word of a
    sentence is not judged on its own. In Spanish only runs of two or more words are judged, because
    translated place names are capitalized single words ("el Canal de Navegación")."""
    runs: list[list[re.Match]] = []
    for m in _CAP_WORD.finditer(text):
        if not m[0][0].isupper():
            continue
        if runs and re.fullmatch(r" +", text[runs[-1][-1].end():m.start()]):
            runs[-1].append(m)
        else:
            runs.append([m])
    bad = []
    for run in runs:
        if lang == "es" and len(run) < 2:
            continue
        start = run[0].start()  # a bounded look-back keeps this linear on an oversized draft
        judged = run[1:] if start < 16 or _SENTENCE_END.search(text[start - 16:start]) else run
        words = {w for m in judged for w in _name_words(m[0])} - _NAME_OK
        if words and not any(words <= fw for fw in fact_words):
            bad.append(" ".join(m[0] for m in run))
    return bad


def guard(drafts: dict[str, Any], facts: dict[str, Any]) -> list[str]:
    """Return the reasons to reject; empty means the drafts pass."""
    rejected: list[str] = []
    nums, strings = allowed_tokens(facts)
    times = allowed_times(facts, strings)
    ids = {tok for s in strings for tok in _ID.findall(s)}
    quantities = allowed_quantities(facts, strings)
    times24 = {(int(h), m) for s in strings for h, m in _TIME.findall(s)}
    times24 |= {(facts["detection"]["hour_cst"], "00")}
    hours24 = {h for h, _ in times24}
    fact_dates = {(y, mo, d) for s in strings for _, y, mo, d in _dates(s) if y}
    fact_words = [_name_words(s) for s in strings]
    fact_low = " ".join(strings).casefold()
    for field, lang in (("draft_en", "en"), ("draft_es", "es")):
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
        for m in _BANNED_RE.finditer(low):
            rejected.append(f"{field}: banned word '{m[0]}'")
        text = normalize_numbers(text, lang)
        for h, m, marker in _CLOCK_AMPM.findall(text):
            if (_to24(int(h), marker), m) not in times24:
                rejected.append(f"{field}: time '{h}:{m} {marker}' is not in the event facts")
        for h, m in _TIME.findall(text):
            if (int(h), m) not in times:
                rejected.append(f"{field}: time '{h}:{m}' is not in the event facts")
        untimed = _TIME.sub(" ", text)
        for h_ampm, marker, zone_a, h_zone, zone_b, h_word, zone_c in _BARE_HOUR.findall(untimed):
            zone = (zone_a or zone_b or zone_c).upper()
            pool = {facts["detection"]["hour_cst"]} if zone == "CST" or (h_word and not zone) else hours24
            h = int(h_ampm or h_zone or h_word)
            ok = _to24(h, marker) in pool if marker else h in pool or h in {(x % 12) or 12 for x in pool}
            if not ok:
                label = f"{h} {marker or zone}".strip()
                rejected.append(f"{field}: hour '{label}' is not in the event facts")
        # an hour already checked as an hour is not also a loose number: "11 p.m." is 23, not 11
        for tok in _NUM.findall(_BARE_HOUR.sub(" ", untimed)):
            if _canon(tok) not in nums:
                rejected.append(f"{field}: number '{tok}' is not in the event facts")
        for kind, num in _quantities(untimed):
            if num not in quantities[kind]:
                rejected.append(f"{field}: '{num}' is not a {kind} in the event facts")
        for m in _FOREIGN_UNIT.finditer(text):
            if m[0].casefold() not in fact_low:
                rejected.append(f"{field}: unit '{m[0]}' is not the event's unit")
        for written, y, mo, d in _dates(text):
            if (y, mo, d) not in fact_dates if y else (mo, d) not in {(fm, fd) for _, fm, fd in fact_dates}:
                rejected.append(f"{field}: date '{written}' is not in the event facts")
        for name in unknown_names(text, fact_words, lang):
            rejected.append(f"{field}: name '{name}' is not in the event facts")
        for tok in _ID.findall(text):
            if tok not in ids:
                rejected.append(f"{field}: id '{tok}' is not in the event facts")
    # kn: numbers are bound to their unit, not to their field: a real number moved within one unit
    # (the baseline stated as the peak, one monitor's reading given to another) passes, as do negation
    # flips, invented names built only from words of one real name, and one-word invented names in
    # Spanish. Upgrade path: claim-level slots (value/baseline/pounds per sentence) or a template the
    # model fills instead of free text; evals/guard_escape measures each of these leaks.
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
