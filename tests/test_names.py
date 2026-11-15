"""pipeline/names.py display_name: the Python port of web/src/facilities.ts displayName (UI audit 3, S57)."""

import json
from pathlib import Path

from pipeline.names import display_name

ROOT = Path(__file__).resolve().parent.parent


def test_acronyms_and_brands_keep_their_capitals():
    assert display_name("BASF TOTAL PETROCHEMICALS") == "BASF Total Petrochemicals"
    assert display_name("AES DEEPWATER COGENERATION PLANT") == "AES Deepwater Cogeneration Plant"
    assert display_name("INEOS AMERICAS PASADENA SITE") == "INEOS Americas Pasadena Site"
    assert display_name("DEER PARK VCM PLANT") == "Deer Park VCM Plant"
    assert display_name("AFTON LUBE AND FUEL ADDITIVES PLANT") == "Afton Lube and Fuel Additives Plant"
    assert display_name("Already Mixed Case") == "Already Mixed Case"


def test_matches_the_shared_fixture_the_web_test_also_checks():
    cases = json.loads((ROOT / "data" / "fixtures" / "display_names.json").read_text())["cases"]
    assert len(cases) > 200
    wrong = [(raw, want, display_name(raw)) for raw, want in cases if display_name(raw) != want]
    assert wrong == []
