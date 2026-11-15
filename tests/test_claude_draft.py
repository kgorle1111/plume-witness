"""Claude drafter: same guard and fail-closed fallback as Gemini, with a fake client (no network)."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import claude_draft as cd
from tests.test_gemini_draft import faithful

ROOT = Path(__file__).resolve().parent.parent
KEY = "sk-ant-test-sentinel-not-a-real-key-0123456789"


@pytest.fixture(scope="module")
def event() -> dict:
    return json.loads((ROOT / "web" / "public" / "event.json").read_text())


@pytest.fixture(autouse=True)
def fake_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)


def _msg(payload, stop="end_turn"):
    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return SimpleNamespace(stop_reason=stop, model=cd.MODEL,
                           content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)])


class FakeClient:
    """Mimics client.beta.messages.create; each script item is a response to return or an exception."""

    def __init__(self, *script):
        self.script, self.calls = list(script), []
        self.beta = SimpleNamespace(messages=self)

    def create(self, **kw):
        self.calls.append(kw)
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


class FakeStatusError(Exception):
    def __init__(self, status_code: int, msg: str = ""):
        super().__init__(msg)
        self.status_code = status_code


def test_faithful_draft_passes_and_request_is_structured(event):
    client = FakeClient(_msg(faithful(event)))
    packet = cd.draft(event, client=client)
    assert packet["guard"] == {"passed": True, "rejected": []}
    assert packet["drafted_by"].startswith(f"Claude ({cd.MODEL})")
    kw = client.calls[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert kw["output_config"]["effort"] == "low"
    assert kw["fallbacks"] == "default" and kw["betas"] == [cd.FALLBACK_BETA]
    assert "thinking" not in kw  # Opus 5.5 rejects disabled thinking; effort is the control


def test_invented_number_falls_back_to_template(event):
    bad = faithful(event)
    bad["draft_en"] = bad["draft_en"].replace("7,634", "9,999")
    packet = cd.draft(event, client=FakeClient(_msg(bad)))
    assert packet["guard"]["passed"] is False
    assert packet["draft_en"] == event["packet"]["draft_en"]
    assert packet["drafted_by"].endswith("Claude draft not used")


def test_refusal_and_cutoff_fall_back(event):
    for stop in ("refusal", "max_tokens"):
        packet = cd.draft(event, client=FakeClient(_msg(faithful(event), stop=stop)))
        assert packet["guard"]["passed"] is False
        assert stop in packet["guard"]["rejected"][0]


def test_api_error_falls_back_and_never_leaks_the_key(event):
    packet = cd.draft(event, client=FakeClient(FakeStatusError(401, f"bad key {KEY}")))
    assert packet["guard"]["passed"] is False
    assert "status 401" in packet["guard"]["rejected"][0]
    assert KEY not in json.dumps(packet)


def test_non_json_falls_back(event):
    packet = cd.draft(event, client=FakeClient(_msg("not json")))
    assert packet["guard"]["passed"] is False


def test_missing_key_exits_2_and_writes_nothing(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = tmp_path / "p.json"
    assert cd.main(["--event", str(ROOT / "web" / "public" / "event.json"), "--out", str(out)]) == 2
    assert not out.exists()
