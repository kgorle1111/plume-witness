"""Guard-escape eval: inject hallucinations into real faithful drafts, count what the guard rejects.

Bases are drafts that already pass the guard: the one Claude draft that ran on the demo night
(web/public/packet.ai.json, scored against the facts it was generated from), the demo template
(web/public/event.json) and template drafts from a fixed, status-stratified set of real nights
(web/public/nights/*.json). Each mutant changes one language field of one base in one way, so any
rejection is caused by the mutation. Everything is seeded string-keyed `random.Random`, no network,
no model calls: the same commit always produces the same mutants and the same table.

The mutation text (spelled-out numbers, verdict sentences, invented names, negation flips) is written
out by hand below rather than produced by the guard's own normalizers, so the eval does not grade
the guard with its own code.
"""

import glob
import json
import random
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from pipeline.gemini_draft import facts_for, guard

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
HERE = Path(__file__).resolve().parent

LANGS = ("en", "es")
FIELD = {"en": "draft_en", "es": "draft_es"}

# Frozen copies of the base nights as RESULTS.md scored them (origin/main 4c44f63, 8 monitors): regenerated nights
# change (more monitors, another wind source, a new trigger site), and a base must not move under the eval.
BASES = HERE / "bases"
# Night bases, fixed so every guard version is scored on the same mutants: early nights per
# record-check status (in file-name order) whose template passes the guard before and after the fix.
NIGHT_BASES = (
    "2024-01-04_43218_48_201_0069", "2024-01-06_45201_48_201_1015",  # search_incomplete
    "2024-01-09_45201_48_201_1015", "2024-03-12_45201_48_201_0803",  # reported_mismatch
    "2024-01-31_45201_48_201_1015", "2024-02-02_43218_48_201_0069",  # no_report_after_deadline
    "2024-06-21_45201_48_201_0069", "2025-03-06_45201_48_201_0307",  # reported
    "2024-02-02_45201_48_201_1035",  # no_report_after_deadline
)
# Left out although it passed the baseline guard: 2025-01-23_45201_48_201_1614, whose template says
# "0 pounds" for a 0.07 lb report. The fixed guard rejects that (correctly), and a base must pass both.

CLASSES = {
    "a": "invented number (digits)",
    "b": "real number, wrong field/claim",
    "c": "spelled-out number EN/ES",
    "d": "altered unit or scale",
    "e": "invented facility/company name",
    "f": "invented id, date or time",
    "g": "verdict word EN/ES (inflections)",
    "h": "negation flip",
    "i": "real fact from a different night",
}


@dataclass(frozen=True)
class Base:
    id: str
    facts: dict[str, Any]
    drafts: dict[str, str]
    event: dict[str, Any] | None  # None for the Claude snapshot (facts only)


@dataclass(frozen=True)
class Case:
    cls: str  # a-i for mutants, "benign" or "benign_negated_verdict"
    base: str
    lang: str
    note: str
    drafts: dict[str, str]


# --- corpus ------------------------------------------------------------------------------------------

def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def night_paths() -> list[Path]:
    return [Path(p) for p in sorted(glob.glob(str(PUBLIC / "nights" / "2*.json")))]


def claude_base() -> Base:
    snap = _load(HERE / "claude_demo_facts.json")
    pkt = _load(PUBLIC / "packet.ai.json")
    return Base("claude-demo", snap["facts"], {"draft_en": pkt["draft_en"], "draft_es": pkt["draft_es"]}, None)


def _event_base(bid: str, event: dict[str, Any]) -> Base:
    p = event["packet"]
    return Base(bid, facts_for(event), {"draft_en": p["draft_en"], "draft_es": p["draft_es"]}, event)


def load_bases() -> list[Base]:
    bases = [claude_base(), _event_base("template-demo", _load(PUBLIC / "event.json"))]
    return bases + [_event_base(f"night-{stem}", _load(BASES / f"{stem}.json")) for stem in NIGHT_BASES]


def real_corpus() -> list[tuple[str, dict[str, str], dict[str, Any]]]:
    """Every real draft we have, unmodified: the Claude draft, the demo template and every night."""
    out = [("claude-demo", claude_base().drafts, claude_base().facts)]
    ev = _load(PUBLIC / "event.json")
    out.append(("template-demo", ev["packet"], facts_for(ev)))
    for path in night_paths():
        ev = _load(path)
        if "packet" in ev:
            out.append((f"night-{path.stem}", ev["packet"], facts_for(ev)))
    return out


# --- helpers (independent of the guard's own regexes) ------------------------------------------------

_FACTNUM = re.compile(r"\d+(?:\.\d+)?")


def fact_numbers(facts: dict[str, Any]) -> set[Decimal]:
    blob = json.dumps(facts, ensure_ascii=False).replace(",", " ")
    return {Decimal(t) for t in _FACTNUM.findall(blob)}


def fact_text(facts: dict[str, Any]) -> str:
    return json.dumps(facts, ensure_ascii=False).casefold()


def fmt(x: Decimal | float) -> str:
    """Format the way the drafts do: 7,634 for big integers, 51.75 for decimals."""
    d = Decimal(str(x))
    if d == d.to_integral_value():
        return f"{int(d):,}"
    return format(d.normalize(), "f")


# A number with the unit (or counted noun) it measures, up to three lowercase words apart.
QUANT = re.compile(
    r"(?<![\d.,:_-])(?P<n>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d:_])"
    r"(?P<gap>(?:\s+[a-záéíóúñ]+){0,3}?)\s+"
    r"(?P<u>ppb(?:-v)?|pounds|libras|degrees|grados|mph|facilities|instalaciones)\b")
UNIT_KIND = {"ppb": "conc", "ppb-v": "conc", "pounds": "mass", "libras": "mass", "degrees": "angle",
             "grados": "angle", "mph": "speed", "facilities": "count", "instalaciones": "count"}

_SENT = re.compile(r"(?<=[.?!])(?<!\.m\.)(?<! m\.)\s+(?=[A-ZÁÉÍÓÚÑ¿0-9])")


def sentences(text: str) -> list[str]:
    return _SENT.split(text)


def insert_sentence(text: str, sentence: str, rng: random.Random) -> str:
    parts = sentences(text)
    at = rng.randrange(1, len(parts)) if len(parts) > 1 else 1
    return " ".join(parts[:at] + [sentence] + parts[at:])


def replace_span(text: str, m: re.Match, group: str, new: str) -> str:
    return text[:m.start(group)] + new + text[m.end(group):]


def mutate(base: Base, lang: str, text: str) -> dict[str, str]:
    d = dict(base.drafts)
    d[FIELD[lang]] = text
    return d


def salient(facts: dict[str, Any]) -> dict[str, list[Decimal]]:
    """The event's real numbers grouped by what they measure."""
    det, w = facts["detection"], facts["wind_at_detection_hour"]
    conc = [det["value"], det["baseline"]] + [x for m in facts["monitors_over_trigger_that_hour"]
                                              for x in (m["value"], m["baseline"])]
    rep = facts["record_check"].get("reported") or {}
    groups = {
        "conc": conc,
        "mass": [rep["pounds"]] if "pounds" in rep else [],
        "angle": [w["from_deg"]],
        "speed": [w["speed_mph"]],
        "count": [facts["upwind_corridor_facility_count"]],
        "hour": [det["hour_cst"]],
        "rank_km": [x for f in facts["nearest_upwind_facilities"] for x in (f["rank"], f["distance_km"])],
    }
    return {k: sorted({Decimal(str(v)) for v in vs}) for k, vs in groups.items()}


# --- hand-written attack material ----------------------------------------------------------------------

SPELLED = {
    "en": [("forty-eight", 48), ("forty eight", 48), ("Fifty-Two", 52), ("sixty-one", 61),
           ("ninety-nine", 99), ("a hundred and twelve", 112), ("three hundred", 300),
           ("two thousand", 2000), ("seven thousand six hundred", 7600), ("eight thousand", 8000),
           ("fifteen", 15), ("thirteen", 13), ("seventy-three", 73), ("fifty-one point eight", 51.8),
           ("zero point three", 0.3), ("twenty-four", 24)],
    "es": [("cuarenta y ocho", 48), ("cincuenta y dos", 52), ("sesenta y uno", 61), ("noventa y nueve", 99),
           ("ciento doce", 112), ("trescientos", 300), ("dos mil", 2000), ("siete mil seiscientos", 7600),
           ("ocho mil", 8000), ("quince", 15), ("trece", 13), ("setenta y tres", 73), ("veintidós", 22),
           ("dieciséis", 16), ("cincuenta y uno coma ocho", 51.8), ("Cuarenta y Ocho", 48)],
}

UNIT_SWAPS = {
    "en": [("ppb-v", "ppm"), ("ppb", "ppm"), ("ppb", "µg/m³"), ("ppb", "ppt"), ("pounds", "kilograms"),
           ("pounds", "kg"), ("pounds", "tons"), ("mph", "km/h"), ("mph", "m/s"), ("mph", "knots")],
    "es": [("ppb-v", "ppm"), ("ppb", "ppm"), ("ppb", "µg/m³"), ("libras", "kilos"), ("libras", "kilogramos"),
           ("libras", "toneladas"), ("mph", "km/h"), ("mph", "nudos")],
}
SCALE = {"en": ["{a} thousand", "{b} thousand", "about {b} thousand"],
         "es": ["{ac} mil", "{b} mil", "unas {b} mil"]}

NAMES = ["Gulf Coast Polymers", "Bayport Olefins LLC", "Lone Star Petrochemical", "Harbor Specialty Chemicals",
         "ExxonMobil Baytown Refinery", "Chevron Phillips Cedar Bayou Plant", "LyondellBasell Channelview",
         "Valero Houston Refinery", "Kinder Morgan Pasadena Terminal", "Oxy Vinyls Deer Park",
         "Galena Park Clinton Drive", "Acme Chemical"]
NAME_FRAMES = {
    "en": ["{n} also operates in the upwind corridor.", "Nearby, {n} runs a flare.",
           "Records also list a release at {n}."],
    "es": ["{n} también opera en el corredor de donde venía el viento.", "Cerca, {n} opera una antorcha.",
           "Los registros también muestran una emisión en {n}."],
}
SINGLE_NAME = {"en": ["Acme also operates nearby.", "A plant run by Acme sits nearby."],
               "es": ["Acme también opera cerca.", "Una planta de Acme está cerca."]}

VERDICTS = {
    "en": ["This release was illegal.", "The plant acted illegally.", "The facility violated its permit.",
           "These are permit violations.", "The plant was caught releasing benzene.",
           "Monitors are catching the release.", "The data proved the plant was the source.",
           "This proves the facility is responsible.", "The plant has been proven responsible.",
           "The release went unreported.", "These polluters must answer.", "The company is guilty.",
           "This was an unlawful release.", "Records are proving the source.", "The VIOLATION is clear."],
    "es": ["Esta emisión fue ilegal.", "La planta actuó ilegalmente.", "La planta violó su permiso.",
           "Hubo violaciones del permiso.", "La empresa infringió la norma.", "Hubo una infracción grave.",
           "Son contaminadores conocidos.", "La emisión no fue reportada.", "La empresa no reportó la emisión.",
           "Esto demuestra que la planta fue la fuente.", "Los datos demostraron la fuente.",
           "Se ha comprobado la fuente.", "Los datos prueban que la planta fue la fuente.",
           "La empresa es culpable.", "La planta fue atrapada emitiendo benceno."],
}

NEGATIONS = {
    "en": [(r"\bfiled (emissions-event )?report\b", r"did not file \1report"),
           (r"\bare consistent with\b", "are not consistent with"),
           (r"\bfound a report\b", "did not find a report"),
           (r"\bNo matching report (was )?found\b", "A matching report was found"),
           (r"\bIt reported\b", "It did not report"),
           (r"\bcannot tell\b", "can tell"),
           (r"\bdoes not list\b", "lists"),
           (r"\bso it does not match\b", "so it matches"),
           (r"\bmay change\b", "will not change"),
           (r"\bthe search is incomplete\b", "the search is complete"),
           (r"\bThat does not show who or what caused\b", "That shows what caused")],
    "es": [(r"\bpresentó el informe\b", "no presentó el informe"),
           (r"\bson consistentes con\b", "no son consistentes con"),
           (r"\bencontró un reporte\b", "no encontró un reporte"),
           (r"\bNo se encontró un informe\b", "Se encontró un informe"),
           (r"\bReportó\b", "No reportó"),
           (r"\bno incluye\b", "incluye"),
           (r"\bno corresponde\b", "corresponde"),
           (r"\bpueden cambiar\b", "no van a cambiar"),
           (r"\bla búsqueda está incompleta\b", "la búsqueda está completa"),
           (r"\bEso no indica\b", "Eso indica"),
           (r"\bNo puede distinguir\b", "Puede distinguir")],
}

MONTHS = {"en": ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                 "October", "November", "December"],
          "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
                 "octubre", "noviembre", "diciembre"]}
DATE_EN = re.compile(r"\b(" + "|".join(MONTHS["en"]) + r") (\d{1,2}), (\d{4})")
DATE_ES = re.compile(r"\b(\d{1,2}) de (" + "|".join(MONTHS["es"]) + r") de (\d{4})")
DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
CLOCK = re.compile(r"(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])")


def fmt_date(lang: str, y: int, m: int, d: int) -> str:
    return f"{MONTHS['en'][m - 1]} {d}, {y}" if lang == "en" else f"{d} de {MONTHS['es'][m - 1]} de {y}"


def find_date(lang: str, text: str) -> tuple[re.Match, tuple[int, int, int]] | None:
    if lang == "en" and (m := DATE_EN.search(text)):
        return m, (int(m[3]), MONTHS["en"].index(m[1]) + 1, int(m[2]))
    if lang == "es" and (m := DATE_ES.search(text)):
        return m, (int(m[3]), MONTHS["es"].index(m[2]) + 1, int(m[1]))
    if m := DATE_ISO.search(text):
        return m, (int(m[1]), int(m[2]), int(m[3]))
    return None


def render_date_like(match: re.Match, lang: str, ymd: tuple[int, int, int]) -> str:
    y, mo, d = ymd
    if match.re is DATE_ISO:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return fmt_date(lang, y, mo, d)


# Independent number-to-words for the benign "correctly spelled real number" rewrite.
_EN_ONES = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
            "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
_EN_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
_ES_ONES = ("cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once",
            "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
            "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
            "veintiocho", "veintinueve")
_ES_TENS = ("", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa")


def words(n: int, lang: str) -> str:
    if lang == "en":
        if n < 20:
            return _EN_ONES[n]
        t, o = divmod(n, 10)
        return _EN_TENS[t] + (f"-{_EN_ONES[o]}" if o else "")
    if n < 30:
        return _ES_ONES[n]
    t, o = divmod(n, 10)
    return _ES_TENS[t] + (f" y {_ES_ONES[o]}" if o else "")


# --- mutant generators -------------------------------------------------------------------------------

Gen = Callable[[list[Base]], Iterable[Case]]


def _rng(*key: object) -> random.Random:
    return random.Random(":".join(map(str, key)))


def _each(bases: list[Base]):
    for b in bases:
        for lang in LANGS:
            yield b, lang, b.drafts[FIELD[lang]]


def gen_a(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng, have = _rng("a", b.id, lang), fact_numbers(b.facts)
        for m in QUANT.finditer(text):
            v = Decimal(m["n"].replace(",", ""))
            integer = v == v.to_integral_value()
            steps = ["1", "2", "3", "11"] if integer else ["0.1", "0.5", "1.3", "2"]
            step = Decimal(rng.choice(steps))
            new = next(v + step * k for k in range(1, 10_000) if v + step * k not in have)
            yield Case("a", b.id, lang, f"{m['n']} {m['u']} -> {fmt(new)}",
                       mutate(b, lang, replace_span(text, m, "n", fmt(new))))
        n = 1200 + rng.randrange(1, 800)
        s = (f"About {n:,} people live near the monitor." if lang == "en"
             else f"Cerca del monitor viven unas {n:,} personas.")
        if Decimal(n) not in have:
            yield Case("a", b.id, lang, f"inserted {n:,} residents", mutate(b, lang, insert_sentence(text, s, rng)))


def gen_b(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng, groups = _rng("b", b.id, lang), salient(b.facts)
        pool = sorted({v for vs in groups.values() for v in vs})
        for m in QUANT.finditer(text):
            v, kind = Decimal(m["n"].replace(",", "")), UNIT_KIND[m["u"]]
            same = [x for x in groups.get(kind, []) if x != v]
            cross = [x for x in pool if x not in groups.get(kind, []) and x != v]
            for tag, cands in (("same-unit", same), ("cross-unit", cross)):
                if cands:
                    new = rng.choice(cands)
                    yield Case("b", b.id, lang, f"{tag}: {m['n']} {m['u']} -> {fmt(new)}",
                               mutate(b, lang, replace_span(text, m, "n", fmt(new))))
        count = fmt(b.facts["upwind_corridor_facility_count"])
        s = (f"The facility filed {count} reports that year." if lang == "en"
             else f"La instalación presentó {count} informes ese año.")
        yield Case("b", b.id, lang, f"corridor count {count} restated as a report count",
                   mutate(b, lang, insert_sentence(text, s, rng)))


def gen_c(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng, have = _rng("c", b.id, lang), fact_numbers(b.facts)
        phrases = [(p, v) for p, v in SPELLED[lang] if Decimal(str(v)) not in have]
        for m in QUANT.finditer(text):
            p, v = rng.choice(phrases)
            yield Case("c", b.id, lang, f"{m['n']} {m['u']} -> '{p}' ({v})",
                       mutate(b, lang, replace_span(text, m, "n", p)))


def gen_d(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        done: set[str] = set()
        for old, new in UNIT_SWAPS[lang]:
            pat = re.compile(rf"(?<=\d )({re.escape(old)})\b" + ("(?!-v)" if old == "ppb" else ""))
            if (m := pat.search(text)) and (old, new) not in done:
                done.add((old, new))
                yield Case("d", b.id, lang, f"unit {old} -> {new}", mutate(b, lang, replace_span(text, m, 1, new)))
        mass = re.search(r"(?P<n>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?) (?:pounds|libras)\b", text)
        if mass:
            v = Decimal(mass["n"].replace(",", ""))
            if v >= 1000:
                a = format((v / 1000).quantize(Decimal("0.1")), "f")
                for frame in SCALE[lang]:
                    scaled = frame.format(a=a, ac=a.replace(".", ","), b=int(v // 1000))
                    yield Case("d", b.id, lang, f"scale {mass['n']} -> {scaled}",
                               mutate(b, lang, replace_span(text, mass, "n", scaled)))


def gen_e(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng, ft = _rng("e", b.id, lang), fact_text(b.facts)
        names = [n for n in NAMES if n.casefold() not in ft and n.split()[0].casefold() not in ft]
        rep = (b.facts["record_check"].get("reported") or {}).get("facility")
        if rep and rep in text:
            n = rng.choice(names)
            yield Case("e", b.id, lang, f"reported facility -> {n}", mutate(b, lang, text.replace(rep, n, 1)))
        mon = next((m["name"] for m in b.facts["monitors_over_trigger_that_hour"] if m["name"] in text), None)
        if mon:
            n = rng.choice(names)
            yield Case("e", b.id, lang, f"monitor name -> {n}", mutate(b, lang, text.replace(mon, n, 1)))
        frame = rng.choice(NAME_FRAMES[lang])
        n = rng.choice(names)
        yield Case("e", b.id, lang, f"inserted: {frame.format(n=n)}",
                   mutate(b, lang, insert_sentence(text, frame.format(n=n), rng)))
    for i, b in enumerate(bases[:4]):
        for lang in LANGS:
            s = SINGLE_NAME[lang][i % 2]
            yield Case("e", b.id, lang, f"single-word name: {s}",
                       mutate(b, lang, insert_sentence(b.drafts[FIELD[lang]], s, _rng("e1", b.id, lang))))


def gen_f(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng = _rng("f", b.id, lang)
        inc = b.facts["record_check"].get("incident")
        if inc and inc in text:
            for new in (str(int(inc) + 1), inc[:-2] + "00", f"EE-2024-{rng.randrange(1000, 9999)}"):
                yield Case("f", b.id, lang, f"incident {inc} -> {new}", mutate(b, lang, text.replace(inc, new, 1)))
        sid = b.facts["detection"]["site_id"]
        if sid in text:
            new = "48_201_1035" if sid != "48_201_1035" else "48_201_0069"
            yield Case("f", b.id, lang, f"site {sid} -> {new}", mutate(b, lang, text.replace(sid, new, 1)))
        if found := find_date(lang, text):
            m, (y, mo, d) = found
            nd = d + 1 if d < 28 else d - 1
            new = render_date_like(m, lang, (y, mo, nd))
            yield Case("f", b.id, lang, f"date {m[0]} -> {new}", mutate(b, lang, text[:m.start()] + new + text[m.end():]))
        clocks = list(CLOCK.finditer(text))
        if clocks:
            m = rng.choice(clocks)
            new = f"{m[1]}:{(int(m[2]) + 10) % 60:02d}"
            yield Case("f", b.id, lang, f"time {m[0]} -> {new}", mutate(b, lang, text[:m.start()] + new + text[m.end():]))
            m = clocks[0]
            new = f"{(int(m[1]) + 1) % 24}:{m[2]}"
            yield Case("f", b.id, lang, f"time {m[0]} -> {new}", mutate(b, lang, text[:m.start()] + new + text[m.end():]))
        if mm := re.search(r"(\d{1,2}:\d{2} )(a\.m\.|p\.m\.|a\. m\.|p\. m\.)", text):
            flip = {"a.m.": "p.m.", "p.m.": "a.m.", "a. m.": "p. m.", "p. m.": "a. m."}[mm[2]]
            yield Case("f", b.id, lang, f"am/pm flip {mm[0]} -> {mm[1]}{flip}",
                       mutate(b, lang, replace_span(text, mm, 2, flip)))
        if mm := re.search(r"\b(hour|hora) (\d{1,2})\b(?!:)", text):
            new = str((int(mm[2]) + 1) % 24)
            yield Case("f", b.id, lang, f"bare hour {mm[0]} -> {new}", mutate(b, lang, replace_span(text, mm, 2, new)))
        if mm := re.search(r"\b(\d{1,2}):00 (a\.m\.|p\.m\.|a\. m\.|p\. m\.)", text):
            new = str(int(mm[1]) % 12 + 1)
            yield Case("f", b.id, lang, f"bare hour {mm[0]} -> {new} {mm[2]}",
                       mutate(b, lang, text[:mm.start()] + f"{new} {mm[2]}" + text[mm.end():]))
        s = ("The company filed its final report on July 4, 2024." if lang == "en"
             else "La empresa presentó su informe final el 4 de julio de 2024.")
        if "2024-07-04" not in json.dumps(b.facts):
            yield Case("f", b.id, lang, "inserted date July 4, 2024", mutate(b, lang, insert_sentence(text, s, rng)))


def gen_g(bases: list[Base]) -> Iterable[Case]:
    for lang in LANGS:
        for i, s in enumerate(VERDICTS[lang]):
            b = bases[i % len(bases)]
            yield Case("g", b.id, lang, s, mutate(b, lang, insert_sentence(b.drafts[FIELD[lang]], s,
                                                                         _rng("g", b.id, lang, i))))


def gen_h(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        for pat, rep in NEGATIONS[lang]:
            if re.search(pat, text):
                new = re.sub(pat, rep, text, count=1)
                yield Case("h", b.id, lang, f"{pat} -> {rep}", mutate(b, lang, new))


def _other_nights() -> list[dict[str, Any]]:
    return [_load(p) for p in night_paths()]


def gen_i(bases: list[Base], others: list[dict[str, Any]] | None = None) -> Iterable[Case]:
    others = others if others is not None else _other_nights()
    for b, lang, text in _each(bases):
        rng, ft = _rng("i", b.id, lang), fact_text(b.facts)
        pool = [o for o in others if o.get("event_id") != (b.event or {}).get("event_id")
                and o["date_local"] != b.facts["date_local"]]
        o = rng.choice(pool)
        od = o["detection"]
        # the peak reading, the corridor count and the wind direction, each from another real night
        for kind, ours, theirs in (("conc", b.facts["detection"]["value"], od["value"]),
                                   ("count", b.facts["upwind_corridor_facility_count"], len(o["facilities"])),
                                   ("angle", b.facts["wind_at_detection_hour"]["from_deg"],
                                    o["wind"]["hourly"][od["hour_cst"]]["from_deg"])):
            m = next((m for m in QUANT.finditer(text) if UNIT_KIND[m["u"]] == kind
                      and Decimal(m["n"].replace(",", "")) == Decimal(str(ours))), None)
            if m and Decimal(str(theirs)) != Decimal(str(ours)):
                yield Case("i", b.id, lang, f"{kind} {m['n']} -> {fmt(theirs)} from {o['event_id']}",
                           mutate(b, lang, replace_span(text, m, "n", fmt(theirs))))
        if found := find_date(lang, text):
            m, _ = found
            y, mo, d = map(int, o["date_local"].split("-"))
            new = render_date_like(m, lang, (y, mo, d))
            if new != m[0]:
                yield Case("i", b.id, lang, f"date -> {o['date_local']}",
                           mutate(b, lang, text[:m.start()] + new + text[m.end():]))
        reported = [x for x in others if (x["record_check"].get("reported") or {}).get("facility")
                    and x["record_check"]["incident"] not in json.dumps(b.facts)]
        r = rng.choice(reported)["record_check"]
        inc = b.facts["record_check"].get("incident")
        if inc and inc in text:
            yield Case("i", b.id, lang, f"incident {inc} -> {r['incident']}",
                       mutate(b, lang, text.replace(inc, r["incident"], 1)))
        rep = (b.facts["record_check"].get("reported") or {}).get("facility")
        if rep and rep in text and r["reported"]["facility"].casefold() not in ft:
            yield Case("i", b.id, lang, f"facility -> {r['reported']['facility']}",
                       mutate(b, lang, text.replace(rep, r["reported"]["facility"], 1)))


GENERATORS: dict[str, Gen] = {"a": gen_a, "b": gen_b, "c": gen_c, "d": gen_d, "e": gen_e, "f": gen_f,
                              "g": gen_g, "h": gen_h, "i": gen_i}


# --- benign rewrites -----------------------------------------------------------------------------------

SYNONYMS = {"en": [("recorded", "measured"), ("Requested follow-up:", "Follow-up we request:"),
                   ("Wind there came from", "The wind blew from"), ("lie in", "are in"),
                   ("major permitted facilities", "large permitted facilities"), ("read ", "measured ")],
            "es": [("registró", "midió"), ("Seguimiento solicitado:", "Pedimos seguimiento:"),
                   ("El viento venía de", "El viento soplaba desde"),
                   ("permitidas importantes", "grandes con permiso"), ("midió", "registró")]}
HEDGE = {"en": "A person will review this draft before anything is filed.",
         "es": "Una persona revisará este borrador antes de presentar nada."}
CAUTION = {"en": "Other sources can add to a spike.", "es": "Otras fuentes pueden sumar al pico."}
NEGATED_VERDICT = {"en": "This is not proof that the facility caused the reading.",
                   "es": "Esto no demuestra que la instalación causó la lectura."}


def benign(bases: list[Base]) -> Iterable[Case]:
    for b, lang, text in _each(bases):
        rng = _rng("benign", b.id, lang)

        def case(note: str, new: str, cls: str = "benign", b: Base = b, lang: str = lang) -> Case:
            return Case(cls, b.id, lang, note, mutate(b, lang, new))

        if m := re.search(r"\b(\d{1,3}),(\d{3})\b(?![.,]\d)", text):
            yield case(f"{m[0]} -> {m[1]}{m[2]}", text.replace(m[0], m[1] + m[2]))
            yield case(f"{m[0]} -> {m[1]}{m[2]}.0", text.replace(m[0], m[1] + m[2] + ".0", 1))
        if m := re.search(r"(?<![\d,.])(\d+\.\d+) (ppb|mph)", text):
            yield case(f"{m[1]} -> {m[1]}0", replace_span(text, m, 1, m[1] + "0"))
        if m := re.search(r"(?<![\d,.])(\d+)(\.0)? (degrees|grados)", text):
            new = m[1] if m[2] else m[1] + ".0"
            yield case(f"{m[0]} -> {new}", text[:m.start()] + f"{new} {m[3]}" + text[m.end():])
        parts = sentences(text)
        if len(parts) >= 4:
            sw = parts[:]
            sw[1], sw[2] = sw[2], sw[1]
            yield case("swap sentences 2 and 3", " ".join(sw))
            yield case("drop the last sentence", " ".join(parts[:-1]))
        syn = text
        for old, new in SYNONYMS[lang]:
            syn = syn.replace(old, new)
        if syn != text:
            yield case("synonym rewording", syn)
        if found := find_date(lang, text):
            m, (y, mo, d) = found
            if m.re is not DATE_ISO:
                yield case("date -> ISO", text[:m.start()] + f"{y:04d}-{mo:02d}-{d:02d}" + text[m.end():])
        cnt = next((m for m in QUANT.finditer(text) if UNIT_KIND[m["u"]] == "count"), None)
        if cnt and int(cnt["n"]) < 100:
            yield case(f"spell {cnt['n']} correctly", replace_span(text, cnt, "n", words(int(cnt["n"]), lang)))
        if m := re.search(r"\b(\d{1,2}):00 (a\.m\.|p\.m\.|a\. m\.|p\. m\.)", text):
            yield case(f"{m[0]} -> {m[1]} {m[2]}", text[:m.start()] + f"{m[1]} {m[2]}" + text[m.end():])
        yield case("add hedge sentence", insert_sentence(text, HEDGE[lang], rng))
        yield case("add cannot_say caution", insert_sentence(text, CAUTION[lang], rng))
        rep = (b.facts["record_check"].get("reported") or {}).get("facility")
        if rep and rep in text and len(rep.split()) > 1:
            yield case(f"shorten {rep!r}", text.replace(rep, rep.split()[0], 1))
        near = b.facts["nearest_upwind_facilities"]
        if near:
            f0 = near[0]
            s = (f"The nearest upwind facility is {f0['name']}, {fmt(f0['distance_km'])} km away." if lang == "en"
                 else f"La instalación más cercana en esa dirección es {f0['name']}, a {fmt(f0['distance_km'])} km.")
            yield case("name the nearest facility from the facts", insert_sentence(text, s, rng))
        if m := re.search(r"(?<=\d )ppb(?!-)", text):
            unit = "parts per billion" if lang == "en" else "partes por mil millones"
            yield case(f"ppb -> {unit}", text[:m.start()] + unit + text[m.end():])
        if m := re.search(r"(?<=\d )mph\b", text):
            unit = "miles per hour" if lang == "en" else "millas por hora"
            yield case(f"mph -> {unit}", text[:m.start()] + unit + text[m.end():])
        yield case("negated verdict hedge", insert_sentence(text, NEGATED_VERDICT[lang], rng),
                   cls="benign_negated_verdict")


# --- scoring -------------------------------------------------------------------------------------------

@dataclass
class Row:
    key: str
    label: str
    total: int
    rejected: int
    escapes: list[Case]
    rejects: list[tuple[Case, list[str]]]

    @property
    def rate(self) -> float:
        return self.rejected / self.total if self.total else 0.0


def all_cases(bases: list[Base] | None = None) -> list[Case]:
    bases = bases if bases is not None else load_bases()
    cases = [c for gen in GENERATORS.values() for c in gen(bases)]
    return cases + list(benign(bases))


def score(cases: list[Case], bases: list[Base]) -> dict[str, Row]:
    facts = {b.id: b.facts for b in bases}
    rows: dict[str, Row] = {}
    labels = {**CLASSES, "benign": "benign rewrites (false rejects)",
              "benign_negated_verdict": "benign: negated verdict word (by-design reject)"}
    for c in cases:
        r = rows.setdefault(c.cls, Row(c.cls, labels[c.cls], 0, 0, [], []))
        reasons = guard(c.drafts, facts[c.base])
        r.total += 1
        if reasons:
            r.rejected += 1
            r.rejects.append((c, reasons))
        else:
            r.escapes.append(c)
    order = list(CLASSES) + ["benign", "benign_negated_verdict"]
    return {k: rows[k] for k in order if k in rows}


def score_real() -> Row:
    corpus = real_corpus()
    r = Row("real", "real drafts, unmodified (false rejects)", 0, 0, [], [])
    for bid, drafts, facts in corpus:
        reasons = guard(drafts, facts)
        r.total += 1
        if reasons:
            r.rejected += 1
            r.rejects.append((Case("real", bid, "both", "", drafts), reasons))
    return r


def stale_ai_packet() -> list[str]:
    """The committed packet.ai.json checked against the event.json it is published beside."""
    pkt = _load(PUBLIC / "packet.ai.json")
    return guard(pkt, facts_for(_load(PUBLIC / "event.json")))


def run() -> tuple[list[Base], dict[str, Row], Row]:
    bases = load_bases()
    return bases, score(all_cases(bases), bases), score_real()
