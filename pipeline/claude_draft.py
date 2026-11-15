"""Draft the EN/ES packet with Claude, behind the same number guard as the Gemini drafter.

Facts, prompt and guard come from `pipeline.gemini_draft` unchanged, so both providers face the same check:
any number, id or time not in the event facts, or any banned verdict word, rejects the draft and the
deterministic template packet is returned instead. A person still reviews and files every packet.

Usage: ANTHROPIC_API_KEY=... uv run python -m pipeline.claude_draft --event web/public/event.json \
           --out data/build/packet.claude.json
Exit: 0 Claude draft passed the guard; 1 file written with the template fallback; 2 missing key or bad event.
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

from pipeline.contract import validate
from pipeline.gemini_draft import MAX_EVENT_BYTES, MissingKeyError, _clean, build_prompt, facts_for, guard

log = logging.getLogger("pipeline.claude_draft")

# Model chosen by the builder (2026-11-14). Opus 5.5 thinking cannot be disabled; effort is the only
# control, and a ~180-word constrained summary needs little of it.
MODEL = "claude-opus-5-5"
EFFORT = "low"
MAX_TOKENS = 16_000  # thinking counts against this; drafts themselves are ~600 tokens
TIMEOUT_S = 60.0
MAX_RETRIES = 1  # the SDK retries 408/409/429/5xx and connection errors itself
FALLBACK_BETA = "server-side-fallback-2026-07-01"

DRAFTED_BY = "Claude ({model}), checked by the deterministic guard; a person must review"

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "draft_en": {"type": "string", "description": "Plain-language English packet summary."},
        "draft_es": {"type": "string", "description": "The same summary in plain-language Spanish."},
    },
    "required": ["draft_en", "draft_es"],
    "additionalProperties": False,
}


def _key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def _redact(text: str) -> str:
    key = _key()
    return text.replace(key, "[REDACTED]") if key else text


def make_client():
    """Real Anthropic client, key from ANTHROPIC_API_KEY only (no .env, no profile lookup)."""
    if not _key():
        raise MissingKeyError("ANTHROPIC_API_KEY is not set; export it to draft with Claude, or keep the "
                              "template packet the build already wrote.")
    import anthropic

    return anthropic.Anthropic(api_key=_key(), timeout=TIMEOUT_S, max_retries=MAX_RETRIES)


def _call(client, model: str, prompt: str) -> dict[str, Any]:
    """One structured call. Raises on a refusal, a cut-off answer or non-JSON, so `draft` fails closed."""
    t0 = time.monotonic()
    resp = client.beta.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        betas=[FALLBACK_BETA],
        fallbacks="default",  # on a policy decline the API re-runs on its default fallback model
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    log.info("claude call ok model=%s served_by=%s stop=%s in %.1fs", model, getattr(resp, "model", None),
             resp.stop_reason, time.monotonic() - t0)
    if resp.stop_reason == "refusal":
        raise ValueError("Claude declined the request (stop_reason=refusal)")
    if resp.stop_reason == "max_tokens":
        raise ValueError(f"Claude hit max_tokens={MAX_TOKENS} before finishing the draft")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise ValueError("Claude returned no text block")
    out = json.loads(text)
    if not isinstance(out, dict):
        raise TypeError("Claude output is not a JSON object")
    return out


def _reason(exc: BaseException) -> str:
    return f"claude call failed: {type(exc).__name__} (status {getattr(exc, 'status_code', None)})"


def _fallback(event: dict[str, Any], rejected: list[str]) -> dict[str, Any]:
    base = event["packet"]
    return {"draft_en": base["draft_en"], "draft_es": base["draft_es"],
            "drafted_by": f"{base['drafted_by']}; Claude draft not used",
            "guard": {"passed": False, "rejected": [_redact(r) for r in rejected]}}


def draft(event: dict[str, Any], client=None, model: str = MODEL) -> dict[str, Any]:
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
        drafts = _call(client, model, build_prompt(facts))
    except Exception as exc:  # noqa: BLE001 -- fail closed on anything the SDK or the parse throws
        reason = _reason(exc) if getattr(exc, "status_code", None) else f"claude draft unusable: {exc}"
        log.warning("falling back to template: %s", _redact(reason))
        return _fallback(event, [reason])
    drafts = {k: _redact(v) if isinstance(v, str) else v for k, v in drafts.items()}
    rejected = guard(drafts, facts)
    if rejected:
        log.warning("guard rejected the Claude draft: %s", _redact("; ".join(rejected)))
        return _fallback(event, rejected)
    return {"draft_en": _clean(drafts["draft_en"]), "draft_es": _clean(drafts["draft_es"]),
            "drafted_by": DRAFTED_BY.format(model=model), "guard": {"passed": True, "rejected": []}}


PUBLISH_MAX_CHARS = 4000


def publish(packet: dict[str, Any], model: str, generated: str, path: Path) -> None:
    """Write the site's optional AI draft file. Refuses unless the guard passed, so the public site can only
    ever show a draft whose every number, id and time was checked against the event."""
    if not packet.get("guard", {}).get("passed"):
        raise ValueError("refusing to publish: the guard did not pass this draft")
    for k in ("draft_en", "draft_es"):
        if not isinstance(packet.get(k), str) or not 0 < len(packet[k]) <= PUBLISH_MAX_CHARS:
            raise ValueError(f"refusing to publish: {k} missing or over {PUBLISH_MAX_CHARS} chars")
    out = {"provider": "Claude", "model": model, "generated_local": generated, "runs_on_this_event": 1,
           "draft_en": packet["draft_en"], "draft_es": packet["draft_es"],
           "drafted_by": packet["drafted_by"], "guard": packet["guard"]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--event", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--publish", type=Path, help="also write the site's AI draft file, only if the guard passed")
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
    if args.publish and g["passed"]:
        publish(packet, args.model, time.strftime("%Y-%m-%d"), args.publish)
        print(f"published {args.publish}")
    return 0 if g["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
