"""Walk-back reader (J1): guard, fail-closed fallbacks, retries, budget stop, baselines and scorer. No network:
every API call goes to a fake client."""

import json
from types import SimpleNamespace

import pytest

from evals.walkback import __main__ as runner
from evals.walkback import report, score
from pipeline import walkback as wb

KEY = "test-sentinel-not-a-real-anthropic-key-0123456789"
INEOS = "steers_425347"
GOOD = {"kind": "revised_down", "compound": "Benzene", "old_value": "24,476", "new_value": "7,634",
        "unit": "pounds", "date_of_change": "2024-12-11",
        "quote": "The Basis Used to Determine Quantities field states 24,476 lbs. of vapor emissions and that "
                 "should also be 7,634 pounds."}


@pytest.fixture(scope="module")
def pages() -> dict[str, dict]:
    return {p.stem: wb.load_page(p) for p in wb.page_paths()}


@pytest.fixture()
def ineos(pages) -> dict:
    return pages[INEOS]


@pytest.fixture(autouse=True)
def fake_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)


def _resp(payload, stop="end_turn", model="claude-sonnet-5-5", out_tokens=200):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return SimpleNamespace(stop_reason=stop, model=model, _request_id="req_fake_1",
                           usage=SimpleNamespace(input_tokens=900, output_tokens=out_tokens,
                                                 cache_creation_input_tokens=0, cache_read_input_tokens=0),
                           content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)])


class FakeClient:
    """Answers both client.messages.create and client.beta.messages.create from one script.
    A script item is a response, an exception to raise, or a callable(kwargs) -> response."""

    def __init__(self, *script):
        self.script, self.calls = list(script), []
        self.messages = SimpleNamespace(create=lambda **kw: self._next("messages", kw))
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: self._next("beta", kw)))

    def _next(self, api, kw):
        self.calls.append((api, kw))
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, BaseException):
            raise item
        return item(kw) if callable(item) else item


class FakeStatusError(Exception):
    def __init__(self, status_code: int, msg: str = ""):
        super().__init__(msg)
        self.status_code, self.request_id, self.response = status_code, "req_err", None


# --- guard ---------------------------------------------------------------------------------------------------


def test_guard_passes_the_ineos_walk_back(ineos):
    assert wb.guard(GOOD, ineos) == []


def test_guard_rejects_a_quote_that_is_not_on_the_page(ineos):
    fake = GOOD | {"quote": "The company admits the release was 7,634 pounds."}
    assert any("verbatim" in r for r in wb.guard(fake, ineos))


def test_the_eval_goes_red_without_the_quote_check(ineos):
    # The deliberate break D9 asks for: with the substring check off, a fabricated quote is accepted. This is
    # the proof the check above is what catches it, not some other rule.
    fake = GOOD | {"quote": "The company admits the release was 7,634 pounds."}
    assert wb.guard(fake, ineos, check_quote=False) == []


def test_guard_accepts_reflowed_whitespace_but_not_edited_words(ineos):
    assert wb.guard(GOOD | {"quote": GOOD["quote"].replace(" ", "\n  ")}, ineos) == []
    assert wb.guard(GOOD | {"quote": GOOD["quote"].replace("should also", "must")}, ineos)


@pytest.mark.parametrize("field,value,reason", [
    ("old_value", "24,467", "does not appear"),  # transposed digits
    ("new_value", "seven thousand", "not a plain number"),
    ("compound", "1,3-butadiene", "does not appear"),
    ("compound", "enzen", "does not appear"),  # a fragment of "Benzene" is not a compound on the page
    ("date_of_change", "2024-12-12", "not a date the page writes"),
    ("kind", "walked_back", "closed enum"),
])
def test_guard_rejects_values_not_on_the_page(ineos, field, value, reason):
    assert any(reason in r for r in wb.guard(GOOD | {field: value}, ineos))


def test_guard_rejects_none_with_values_and_wrong_keys(ineos):
    assert wb.guard(GOOD | {"kind": "none"}, ineos)
    assert wb.guard({k: v for k, v in GOOD.items() if k != "unit"}, ineos)
    assert wb.guard({"kind": "none", "compound": None, "old_value": None, "new_value": None, "unit": None,
                     "date_of_change": None, "quote": ""}, ineos) == []


def test_table_mismatch_is_surfaced_not_resolved(ineos):
    rec = wb.llm_read(ineos, FakeClient(_resp(GOOD | {"new_value": "24,476", "old_value": "7,634"})))
    assert rec["status"] == "read"  # the guard passed: both numbers are on the page
    assert rec["table_check"] == {"status": "mismatch_with_table", "table_quantities": ["7634.0"]}
    assert wb.llm_read(ineos, FakeClient(_resp(GOOD)))["table_check"]["status"] == "matches_table"


# --- the call: fallbacks, retries, request shape -------------------------------------------------------------


def test_good_answer_is_read_and_shown_quote_only(ineos):
    client = FakeClient(_resp(GOOD))
    rec = wb.llm_read(ineos, client, "sonnet")
    assert rec["status"] == "read" and rec["kind"] == "revised_down" and rec["request_id"] == "req_fake_1"
    assert rec["cost_usd"] == pytest.approx((900 * 2 + 200 * 10) / 1e6)
    assert wb.display_line(rec) == f'The report says: "{GOOD["quote"]}"'
    api, kw = client.calls[0]
    assert api == "beta" and kw["model"] == "claude-sonnet-5-5" and kw["fallbacks"] == "default"
    assert kw["output_config"]["effort"] == "low" and "thinking" not in kw
    assert kw["output_config"]["format"]["schema"]["properties"]["kind"]["enum"] == list(wb.KINDS)
    assert kw["output_config"]["format"]["schema"]["additionalProperties"] is False


def test_haiku_has_no_server_side_fallback(ineos):
    client = FakeClient(_resp(GOOD, model="claude-haiku-5-5"))
    wb.llm_read(ineos, client, "haiku")
    api, kw = client.calls[0]
    assert api == "messages" and "fallbacks" not in kw and "betas" not in kw and kw["model"] == "claude-haiku-5-5"


@pytest.mark.parametrize("resp,reason", [
    (_resp("", stop="refusal"), "refusal"),
    (_resp('{"kind": "revised_do', stop="max_tokens"), "max_tokens"),
    (_resp("not json"), "unparseable"),
    (_resp(GOOD | {"quote": "The company admits the release was 7,634 pounds."}), "verbatim"),
])
def test_every_failure_falls_back_to_not_read(ineos, resp, reason):
    rec = wb.llm_read(ineos, FakeClient(resp))
    assert rec["status"] == "flagged_by_rule_not_read" and rec["kind"] is None
    assert any(reason in r for r in rec["rejected"])
    assert wb.display_line(rec) is None and not wb.is_material(rec)


def test_retries_429_and_5xx_with_backoff_then_succeeds(ineos):
    waits = []
    client = FakeClient(FakeStatusError(429), FakeStatusError(529), _resp(GOOD))
    rec = wb.llm_read(ineos, client, sleep=waits.append)
    assert rec["status"] == "read" and len(client.calls) == 3 and waits == [2.0, 4.0]


@pytest.mark.parametrize("exc", [FakeStatusError(400), TimeoutError("read timed out")])
def test_does_not_retry_4xx_or_timeouts(ineos, exc):
    waits = []
    client = FakeClient(exc, _resp(GOOD))
    rec = wb.llm_read(ineos, client, sleep=waits.append)
    assert rec["status"] == "flagged_by_rule_not_read" and len(client.calls) == 1 and waits == []


def test_gives_up_after_max_attempts(ineos):
    client = FakeClient(FakeStatusError(503))
    rec = wb.llm_read(ineos, client, sleep=lambda s: None)
    assert len(client.calls) == wb.MAX_ATTEMPTS and "status 503" in rec["rejected"][0]


def test_key_is_redacted_from_answers_and_never_sent_in_errors(ineos):
    echo = _resp(GOOD | {"compound": f"Benzene {KEY}"})
    rec = wb.llm_read(ineos, FakeClient(echo))
    assert KEY not in json.dumps(rec)
    rec = wb.llm_read(ineos, FakeClient(FakeStatusError(401, f"bad key {KEY}")))
    assert KEY not in json.dumps(rec)


# --- runner: refusals, budget stop, partial results ----------------------------------------------------------


def test_runner_needs_yes_and_a_key(tmp_path, monkeypatch, capsys):
    client = FakeClient(_resp(GOOD))
    assert runner.main(["--limit", "2"], client=client, out_dir=tmp_path) == 2
    assert client.calls == [] and "Re-run with --yes" in capsys.readouterr().err
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert runner.main(["--limit", "2", "--yes"], out_dir=tmp_path) == 2
    assert "ANTHROPIC_API_KEY is not set" in capsys.readouterr().err
    assert runner.main(["--dry-run"], out_dir=tmp_path) == 0
    assert list(tmp_path.iterdir()) == []


def test_runner_writes_rows_and_a_report_without_the_key(tmp_path, capsys):
    client = FakeClient(_resp({"kind": "none", "compound": None, "old_value": None, "new_value": None,
                               "unit": None, "date_of_change": None, "quote": ""}))
    assert runner.main(["--limit", "3", "--yes"], client=client, out_dir=tmp_path) == 0
    (run,) = tmp_path.glob("run-sonnet-*.jsonl")
    rows = report.load_run(run)
    assert len(rows) == 3 and all(r["llm"]["status"] == "read" and r["url"].startswith("https://") for r in rows)
    rep = run.with_suffix(".report.md").read_text()
    assert rep.startswith(f"# {report.TITLE}") and "not an accuracy measurement" in rep
    blob = run.read_text() + rep + "".join(capsys.readouterr())
    assert KEY not in blob


def test_runner_stops_cleanly_at_the_budget_cap(tmp_path, capsys):
    # Each fake page costs 900*2 + 5000*10 = $0.0518 at Sonnet prices; the next page's worst case is priced
    # at Opus rates (fallback tier), ~$0.16. A $0.20 cap leaves room for exactly one page.
    client = FakeClient(_resp(GOOD, out_tokens=5000))
    assert runner.main(["--limit", "5", "--yes", "--max-usd", "0.20"], client=client, out_dir=tmp_path) == 3
    (run,) = tmp_path.glob("run-sonnet-*.jsonl")
    assert len(report.load_run(run)) == 1 and len(client.calls) == 1
    assert "budget stop" in capsys.readouterr().err


def test_runner_refuses_when_the_estimate_is_over_the_cap(tmp_path):
    client = FakeClient(_resp(GOOD))
    assert runner.main(["--yes", "--max-usd", "0.01"], client=client, out_dir=tmp_path) == 2
    assert client.calls == []


# --- baselines on the real cached pages ----------------------------------------------------------------------


def test_parser_baseline_reads_only_the_ineos_page(pages):
    hits = [pid for pid, p in pages.items() if wb.parser_read(p)["material"]]
    assert hits == [INEOS]
    assert wb.parser_read(pages[INEOS])["date_of_change"] == "2024-12-11"


def test_regex_flagger_flags_the_known_cases_and_quotes_verbatim(pages):
    flagged = {pid for pid, p in pages.items() if wb.regex_flagged(p)}
    assert {INEOS, "steers_423359", "steers_443937", "steers_424639"} <= flagged  # D9's real changes
    assert {"steers_423552", "steers_425367"} <= flagged  # "piping was revised", "incorrectly assumed": noise
    for pid in flagged:
        q = wb.regex_read(pages[pid])["quote"]
        assert any(wb.norm(q) in wb.norm(v) for v in pages[pid]["fields"].values())
    assert 35 <= len(flagged) <= 50  # D9 counted 39 with its own pattern; this one gives 43


def test_every_page_parses_its_fields_and_table(pages):
    assert len(pages) == 317  # 315 before the 2026-11-15 Harris expansion fetched 2 more detail pages
    assert all(p["fields"]["cause"] for p in pages.values())
    assert pages[INEOS]["table"] == [{"compound": "Benzene", "quantity": "7634.0", "unit": "POUNDS"}]


# --- scorer --------------------------------------------------------------------------------------------------


def test_wilson_interval():
    lo, hi = score.wilson(14, 15)
    assert 0.68 < lo < 0.72 and 0.98 < hi < 0.995


def test_always_none_fails_and_perfect_passes(pages):
    gold = {INEOS: {"kind": "revised_down", "old_value": "24,476", "new_value": "7,634"},
            "steers_424639": {"kind": "declared_not_reportable_or_retracted", "old_value": None, "new_value": None},
            "steers_423042": {"kind": "none", "old_value": None, "new_value": None}}
    none = {pid: {"status": "read", "kind": "none"} for pid in gold}
    assert not score.score(none, gold, pages, set())["passes"]
    perfect = {INEOS: wb.llm_read(pages[INEOS], FakeClient(_resp(GOOD))),
               "steers_424639": {"status": "read", "kind": "declared_not_reportable_or_retracted",
                                 "quote": "THE EMISSIONS WERE ZEROED OUT TO REFLECT THAT THE EVENT WAS NOT REPORTABLE."},
               "steers_423042": {"status": "read", "kind": "none"}}
    s = score.score(perfect, gold, pages, {"steers_423042"})
    assert s["passes"] and s["precision"] == s["recall"] == s["exact_pairs"] == s["verbatim"] == 1.0
    halluc = perfect | {"steers_423042": perfect["steers_424639"]}
    assert score.score(halluc, gold, pages, {"steers_423042"})["hallucinated_unflagged"] == 1
