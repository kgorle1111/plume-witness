"""Gemini drafter: guard behavior and fail-closed fallback, with a fake client (no network)."""

import json
import logging
from pathlib import Path

import pytest

from pipeline import gemini_draft as gd

ROOT = Path(__file__).resolve().parent.parent
KEY = "test-sentinel-not-a-real-key-0123456789"


@pytest.fixture(scope="module")
def event() -> dict:
    return json.loads((ROOT / "web" / "public" / "event.json").read_text())


@pytest.fixture(autouse=True)
def fake_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", KEY)


class _Resp:
    def __init__(self, text: str):
        self.text = text


class FakeClient:
    """Mimics client.models.generate_content; each item in `script` is a dict to return or an exception."""

    def __init__(self, *script):
        self.script, self.calls = list(script), []
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return _Resp(json.dumps(item, ensure_ascii=False))


class FakeAPIError(Exception):
    def __init__(self, code: int, msg: str = ""):
        super().__init__(f"{code} {msg}")
        self.code = code


def faithful(event: dict) -> dict:
    """A reworded draft that uses only event facts, including a 12-hour local time and a CST hour."""
    en = ("On June 21, 2024, the state air monitor at Houston Milby Park measured 51.75 ppb of benzene "
          "in the 9:00 a.m. CST hour. Its usual level that week was 0.21 ppb. Manchester East Ave N measured "
          "21.4 ppb in the same hour. The wind came from 77 degrees at 6.8 mph. There are 40 large permitted "
          "facilities in the upwind corridor. Ineos Americas Pasadena Site filed report 425347 for 7,634 "
          "pounds of benzene from 9:38 to 10:42 a.m. local time. These readings are consistent with that "
          "release reaching the monitors. Were nearby residents told?")
    es = ("El 21 de junio de 2024, el monitor estatal de Houston Milby Park midió 51.75 ppb de benceno en la "
          "hora de las 9:00 a. m. CST. Su nivel normal esa semana fue 0.21 ppb. Manchester East Ave N midió "
          "21.4 ppb en la misma hora. El viento venía de 77 grados a 6.8 mph. Hay 40 instalaciones grandes "
          "en el corredor. Ineos Americas Pasadena Site presentó el informe 425347 por 7,634 libras de "
          "benceno de 09:38 a 10:42, hora local. Estas lecturas son consistentes con esa emisión. ¿Se avisó "
          "a los residentes?")
    return {"draft_en": en, "draft_es": es}


def _no_sleep(_s: float) -> None:
    return None


def test_faithful_draft_passes(event):
    client = FakeClient(faithful(event))
    pkt = gd.draft(event, client=client, sleep=_no_sleep)
    assert pkt["guard"] == {"passed": True, "rejected": []}
    assert pkt["draft_en"] == faithful(event)["draft_en"]
    assert "Gemini" in pkt["drafted_by"] and gd.MODEL in pkt["drafted_by"]
    assert len(client.calls) == 1 and client.calls[0]["model"] == gd.MODEL
    assert client.calls[0]["config"].response_mime_type == "application/json"


def test_template_packet_itself_passes_guard(event):
    assert gd.guard(event["packet"], gd.facts_for(event)) == []


def test_invented_number_falls_back(event):
    bad = faithful(event)
    bad["draft_en"] = bad["draft_en"].replace("7,634 pounds", "9,999 lb")
    pkt = gd.draft(event, client=FakeClient(bad), sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False
    assert any("'9,999'" in r and r.startswith("draft_en") for r in pkt["guard"]["rejected"])
    assert pkt["draft_en"] == event["packet"]["draft_en"]  # fail closed to the template text
    assert pkt["drafted_by"].startswith("template")


@pytest.mark.parametrize("field,old,new", [
    ("draft_en", "report 425347", "report 425348"),  # invented incident id
    ("draft_en", "110000462623", "110000462624"),
    ("draft_es", "09:38", "11:15"),  # invented time
    ("draft_en", "51.75 ppb", "57.15 ppb"),
])
def test_invented_ids_and_times_rejected(event, field, old, new):
    bad = faithful(event)
    if old not in bad[field]:
        bad[field] += f" Registry {old}."
        assert gd.guard(bad, gd.facts_for(event)) == []  # the real id passes ...
    bad[field] = bad[field].replace(old, new)
    assert gd.guard(bad, gd.facts_for(event)) != []  # ... the one-digit-off id does not


def test_id_check_is_exact_not_substring(event):
    facts = gd.facts_for(event)
    ok = faithful(event)
    ok["draft_en"] += " Registry 110000462623."
    assert gd.guard(ok, facts) == []
    sliced = ok | {"draft_en": ok["draft_en"].replace("110000462623", "462623")}  # tail of a real id
    assert any("id '462623'" in r for r in gd.guard(sliced, facts))


@pytest.mark.parametrize("field,word", [
    ("draft_en", "illegal"), ("draft_en", "Unreported"), ("draft_en", "il\u200blegal"),
    ("draft_en", "proves"), ("draft_es", "ilegal"), ("draft_es", "violación"),
])
def test_banned_word_falls_back(event, field, word):
    bad = faithful(event)
    bad[field] = bad[field] + f" This is {word}."
    pkt = gd.draft(event, client=FakeClient(bad), sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False
    assert any("banned word" in r for r in pkt["guard"]["rejected"])
    assert pkt[field] == event["packet"][field]


def test_length_bounds(event):
    short = faithful(event) | {"draft_es": "Benceno."}
    assert any("length" in r for r in gd.guard(short, gd.facts_for(event)))
    long = faithful(event) | {"draft_en": faithful(event)["draft_en"] * 4}
    assert any("length" in r for r in gd.guard(long, gd.facts_for(event)))
    missing = {"draft_en": faithful(event)["draft_en"]}
    assert any("draft_es: missing" in r for r in gd.guard(missing, gd.facts_for(event)))


def test_client_raises_falls_back(event):
    pkt = gd.draft(event, client=FakeClient(RuntimeError("connection reset")), sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False
    assert pkt["guard"]["rejected"] == ["gemini call failed: RuntimeError (status None)"]
    assert pkt["draft_es"] == event["packet"]["draft_es"]


def test_non_json_output_falls_back(event):
    client = FakeClient(faithful(event))
    client.generate_content = lambda model, contents, config: _Resp("not json")
    pkt = gd.draft(event, client=client, sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False and "JSONDecodeError" in pkt["guard"]["rejected"][0]


def test_one_retry_on_5xx_then_success(event):
    waits: list[float] = []
    client = FakeClient(FakeAPIError(503), faithful(event))
    pkt = gd.draft(event, client=client, sleep=waits.append)
    assert pkt["guard"]["passed"] is True and len(client.calls) == 2 and waits == [gd.RETRY_WAIT_S]


def test_retry_only_once_on_429(event):
    client = FakeClient(FakeAPIError(429), FakeAPIError(429), faithful(event))
    pkt = gd.draft(event, client=client, sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False and len(client.calls) == 2
    assert "status 429" in pkt["guard"]["rejected"][0]


def test_no_retry_on_4xx(event):
    client = FakeClient(FakeAPIError(400), faithful(event))
    pkt = gd.draft(event, client=client, sleep=_no_sleep)
    assert pkt["guard"]["passed"] is False and len(client.calls) == 1


def test_key_never_in_output(event, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    leaky = FakeAPIError(500, f"upstream echoed key={KEY}")
    pkts = [
        gd.draft(event, client=FakeClient(leaky, leaky), sleep=_no_sleep),
        gd.draft(event, client=FakeClient(faithful(event) | {"draft_en": f"key {KEY} illegal"}), sleep=_no_sleep),
        gd.draft(event, client=FakeClient(faithful(event)), sleep=_no_sleep),
    ]
    out = capsys.readouterr()
    for blob in [json.dumps(p) for p in pkts] + [caplog.text, out.out, out.err]:
        assert KEY not in blob


def test_cli_writes_packet_without_key(event, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(gd, "make_client", lambda: FakeClient(faithful(event)))
    out = tmp_path / "packet.gemini.json"
    assert gd.main(["--event", str(ROOT / "web" / "public" / "event.json"), "--out", str(out)]) == 0
    text = out.read_text()
    assert json.loads(text)["guard"]["passed"] is True and KEY not in text
    assert KEY not in capsys.readouterr().out


def test_prompt_has_facts_not_provenance(event):
    prompt = gd.build_prompt(gd.facts_for(event))
    assert "425347" in prompt and "cannot_say" in prompt
    assert "sha256" not in prompt and KEY not in prompt and event["packet"]["draft_en"] not in prompt


def test_missing_key_is_loud(event, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    with pytest.raises(gd.MissingKeyError, match="GEMINI_API_KEY"):
        gd.draft(event)


def test_refuses_non_template_fallback(event):
    ev = event | {"packet": event["packet"] | {"drafted_by": "Gemini"}}
    with pytest.raises(ValueError, match="template"):
        gd.draft(ev, client=FakeClient(faithful(event)))
