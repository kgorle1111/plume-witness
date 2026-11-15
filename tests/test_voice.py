"""Read-aloud audio: speech normalization, and drift between the shipped recordings and the current drafts.

No Kokoro here (CI has none): the manifest hashes are the tripwire that fails the build when a draft changes
without `python -m pipeline.voice` being re-run.
"""

import json

import pytest

from pipeline import voice

AUDIO = voice.AUDIO_DIR


def test_units_and_numbers_en():
    out = voice.speech_text("51.75 ppb at 6.8 mph, 9:00 a.m. CST, 7,634 pounds, 09:38 to 10:42, 77.0 degrees", "en")
    assert out == ("51.75 parts per billion at 6.8 miles per hour, 9 a.m. Central Standard Time, "
                   "7,634 pounds, 9:38 to 10:42, 77 degrees")


def test_brand_in_capitals_is_spoken_as_a_word():
    # S57 made the filer "INEOS Americas Pasadena Site"; Kokoro's EN G2P read the capitals as letters.
    assert voice.speech_text("One of them, INEOS Americas Pasadena Site, filed", "en") == (
        "One of them, Ineos Americas Pasadena Site, filed")
    assert "INEOS" in voice.speech_text("Una de ellas, INEOS Americas Pasadena Site", "es")


def test_units_and_numbers_es():
    out = voice.speech_text("51.75 ppb a 6.8 mph, 9:00 a. m. CST, 7,634 libras, 09:38", "es")
    assert out == ("51 coma 75 partes por mil millones a 6 coma 8 millas por hora, 9 de la mañana hora estándar "
                   "central, 7634 libras, 9:38")


def test_ppb_v_is_not_split_by_ppb_rule():
    assert voice.speech_text("0.21 ppb-v", "en") == "0.21 parts per billion by volume"


def test_ids_dates_monitors_and_initialisms():
    out = voice.speech_text("TCEQ incident 425347, monitor 48_201_0069, 2024-06-21", "en")
    assert out == "T C E Q incident 4 2 5, 3 4 7, monitor 4 8, 2 0 1, 0 0 6 9, June 21, 2024"
    assert voice.speech_text("2024-06-21", "es") == "21 de junio de 2024"


def test_unsupported_language_fails_loud():
    with pytest.raises(ValueError):
        voice.speech_text("x", "fr")


def test_manifest_matches_current_drafts():
    manifest = json.loads((AUDIO / "manifest.json").read_text(encoding="utf-8"))
    drafts = voice.demo_drafts()
    assert set(manifest) == set(drafts)
    stale = [k for k, text in drafts.items() if manifest[k]["sha256"] != voice.sha256(text)]
    assert not stale, f"draft changed without regenerating audio: run `python -m pipeline.voice` ({stale})"


def test_manifest_spoken_text_and_files():
    manifest = json.loads((AUDIO / "manifest.json").read_text(encoding="utf-8"))
    for key, text in voice.demo_drafts().items():
        entry = manifest[key]
        assert entry["spoken_sha256"] == voice.sha256(voice.speech_text(text, key.rsplit("_", 1)[1])), \
            f"{key}: speech normalization changed; regenerate audio"
        assert (AUDIO / entry["file"]).stat().st_size > 10_000
        assert entry["seconds"] > 0 and entry["voice"]
