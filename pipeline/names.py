"""Display names for EPA/TCEQ names, which are registered in capitals ("INEOS AMERICAS PASADENA SITE").

A port of web/src/facilities.ts displayName, so a corridor name in a night reads the same as on its facility page.
str.title() turned "BASF" into "Basf" and "AES" into "Aes" (UI audit 3, S57). data/fixtures/display_names.json pins
both implementations to the same output: tests/test_names.py checks this one, web/test/facilities.test.ts the other.
Display only: facility files and citations keep the registered name.
"""

import re

# kn: acronym and brand lists cover the 2024-25 index (same lists as facilities.ts); a new acronym renders
# title-cased until it is added in both places.
KEEP_UPPER = frozenset({
    "LLC", "LP", "LTD", "USA", "US", "TX", "II", "III", "IV", "ACCP", "AES", "ASU", "BASF", "EGU", "EO", "EPOLP", "FC",
    "GC", "GCL", "GE", "HRM", "KMCC", "LBC", "LCY", "MB", "MCA", "NGL", "PCI", "PVA", "PVC", "PWE", "RST", "SI", "SJRR",
    "SMR", "TECO", "TM", "VCM", "WWTP",
})
SMALL = frozenset({"AND", "OF", "THE", "AT", "FOR", "IN", "ON"})
BRANDS = {"EXXONMOBIL": "ExxonMobil", "LYONDELLBASELL": "LyondellBasell", "TOTALENERGIES": "TotalEnergies",
          "INEOS": "INEOS", "INVISTA": "INVISTA"}

_ORDINAL = re.compile(r"[0-9]+(ST|ND|RD|TH)")  # ASCII digits, like JS \d
_MC = re.compile(r"MC[A-Z]{2,}")


def _cap(w: str) -> str:
    return w[:1] + w[1:].lower()


def _word(w: str, first: bool) -> str:
    if w in BRANDS:
        return BRANDS[w]
    if w in KEEP_UPPER or len(w) == 1:
        return w
    if not first and w in SMALL:
        return w.lower()
    if _ORDINAL.fullmatch(w):
        return w.lower()
    if re.search(r"[0-9]", w) or not re.search(r"[A-Z]", w):
        return w
    if _MC.fullmatch(w):
        return "Mc" + _cap(w[2:])
    return _cap(w)


def display_name(name: str) -> str:
    """"INEOS AMERICAS PASADENA SITE" -> "INEOS Americas Pasadena Site". Names that are not all capitals pass through."""
    if re.search(r"[a-z]", name):
        return name
    return " ".join("-".join(_word(p, i == 0) for p in w.split("-")) for i, w in enumerate(name.split(" ")))
