"""Pre-generate Kokoro read-aloud audio for the demo night's packet drafts.

The browser's speechSynthesis voice is robotic, so the demo night's four drafts (template and AI, EN and ES)
are recorded once offline and shipped as mp3. The web app plays a recording only when the draft on screen is
byte-identical to the one recorded (manifest `sha256`); any edit falls back to the browser voice.

Kokoro is NOT a project dependency: it lives in its own pinned uv project, so generation runs there and this
module keeps stdlib-only imports at top level (CI imports it for the normalizer and manifest checks):

    uv run --project ~/.local/share/kokoro-tts python -m pipeline.voice [--voice-es ef_dora]

Needs ffmpeg (default: hackathon-os-kit's) and, on first use of a voice, HF_HUB_OFFLINE=0 to fetch it.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "web" / "public"
AUDIO_DIR = PUBLIC / "audio"
KOKORO_DIR = Path.home() / ".local/share/kokoro-tts"
FFMPEG = Path.home() / "Documents/kn/hackathon-os-kit/bin/ffmpeg"

VOICES = {"en": "af_heart", "es": "ef_dora"}
LANG_CODE = {"en": "a", "es": "e"}  # Kokoro pipeline language codes
SAMPLE_RATE = 24000
TARGET_LUFS = -16.0
BITRATE = "32k"  # speech; 64k doubled the precache for no audible gain (UI audit 3, S170)

MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"],
    "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
           "noviembre", "diciembre"],
}
UNITS = {
    "en": [("ppb-v", "parts per billion by volume"), ("ppb", "parts per billion"), ("mph", "miles per hour"),
           ("CST", "Central Standard Time"), ("CDT", "Central Daylight Time")],
    "es": [("ppb-v", "partes por mil millones por volumen"), ("ppb", "partes por mil millones"),
           ("mph", "millas por hora"), ("CST", "hora estándar central"), ("CDT", "hora de verano central")],
}


def _digits(s: str) -> str:
    """'425347' -> '4 2 5, 3 4 7': ids are read digit by digit, in threes so a listener can follow."""
    groups = [s[max(i - 3, 0):i] for i in range(len(s), 0, -3)][::-1]
    return ", ".join(" ".join(g) for g in groups)


def speech_text(text: str, lang: str) -> str:
    """Speech-only rewrite of a draft. The on-screen text never changes; only what Kokoro is given."""
    if lang not in UNITS:
        raise ValueError(f"unsupported language {lang!r}; expected one of {sorted(UNITS)}")
    t = text

    def iso_date(m: re.Match) -> str:
        y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
        month = MONTHS[lang][mo - 1]
        return f"{month} {d}, {y}" if lang == "en" else f"{d} de {month} de {y}"

    t = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", iso_date, t)
    # Monitor ids like 48_201_0069: digits in groups, not "forty-eight underscore ...".
    t = re.sub(r"\b\d+(?:_\d+)+\b", lambda m: ", ".join(" ".join(p) for p in m.group(0).split("_")), t)
    if lang == "es":
        t = re.sub(r"\b(\d{1,2}):00 a\. ?m\.", r"\1 de la mañana", t)
        t = re.sub(r"\b(\d{1,2}):00 p\. ?m\.", r"\1 de la tarde", t)
    else:
        t = re.sub(r"\b(\d{1,2}):00 (a\.m\.|p\.m\.)", r"\1 \2", t)  # "9:00" would be read "nine zero zero"
    t = re.sub(r"\b0(\d:\d{2})\b", r"\1", t)  # 09:38 -> 9:38
    if lang == "es":  # ES would read the thousands comma as a decimal; EN reads 7,634 correctly but 7634 as a year
        t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)
    t = re.sub(r"\b(\d+)\.0\b", r"\1", t)  # 77.0 degrees -> 77 degrees
    if lang == "es":
        t = re.sub(r"\b(\d+)\.(\d+)\b", r"\1 coma \2", t)
    for abbr, spoken in UNITS[lang]:
        t = re.sub(rf"(?<![\w-]){re.escape(abbr)}(?![\w-])", spoken, t)
    t = re.sub(r"\b\d{6,}\b", lambda m: _digits(m.group(0)), t)  # report/incident numbers
    t = re.sub(r"\bTCEQ\b", "T C E Q", t)  # an initialism, not a word
    if lang == "en":  # a brand said as a word; the EN G2P spells capitals out ("I N E O S"), the ES one does not
        t = re.sub(r"\bINEOS\b", "Ineos", t)
    return re.sub(r"\s+", " ", t).strip()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def demo_drafts(public: Path = PUBLIC) -> dict[str, str]:
    """`<source>_<lang>` -> the exact draft text the web app shows for the default demo night."""
    event = json.loads((public / "event.json").read_text(encoding="utf-8"))
    ai = json.loads((public / "packet.ai.json").read_text(encoding="utf-8"))
    return {
        "template_en": event["packet"]["draft_en"],
        "template_es": event["packet"]["draft_es"],
        "ai_en": ai["draft_en"],
        "ai_es": ai["draft_es"],
    }


# ---- generation (needs Kokoro + ffmpeg; never imported by CI) ----

def _load_speak():
    spec = importlib.util.spec_from_file_location("kokoro_speak", KOKORO_DIR / "speak.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _synthesize(pipeline, voice: str, text: str, wav_path: Path) -> list[str]:
    import numpy as np
    import soundfile as sf

    chunks, unknown = [], []
    for r in pipeline(text, voice=voice, speed=1.0):
        if r.audio is not None:
            chunks.append(r.audio.numpy())
        unknown += [k.text for k in (r.tokens or []) if not k.phonemes or "❓" in k.phonemes]
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")
    sf.write(wav_path, np.concatenate(chunks), SAMPLE_RATE)
    return [w for w in unknown if any(c.isalpha() for c in w)]


def _ffmpeg(*args: str) -> str:
    p = subprocess.run([str(FFMPEG), "-hide_banner", "-nostdin", *args], check=False, capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(f"ffmpeg failed: {p.stderr[-800:]}")
    return p.stderr


def _to_mp3(wav: Path, mp3: Path) -> None:
    """Two-pass loudnorm (measure, then linear gain) to -16 LUFS, then mono 32 kbps mp3."""
    filt = f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11"
    log = _ffmpeg("-i", str(wav), "-af", f"{filt}:print_format=json", "-f", "null", "-")
    m = json.loads(log[log.rindex("{"):log.rindex("}") + 1])
    second = (f"{filt}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    # loudnorm resamples to 192 kHz; back to Kokoro's 24 kHz so 32 kbps is spent on speech, not a 48 kHz stream
    _ffmpeg("-y", "-i", str(wav), "-af", second, "-ar", str(SAMPLE_RATE), "-ac", "1", "-codec:a", "libmp3lame",
            "-b:a", BITRATE, str(mp3))


def generate(voices: dict[str, str], out: Path = AUDIO_DIR) -> dict:
    speak = _load_speak()
    speak.use_homebrew_espeak()
    from kokoro import KPipeline

    drafts = demo_drafts()
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    pipelines: dict[str, object] = {}
    for key, draft in drafts.items():
        lang = key.rsplit("_", 1)[1]
        voice = voices[lang]
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=LANG_CODE[lang], repo_id="hexgrad/Kokoro-82M")
            pipelines[lang].load_voice(voice)
        spoken = speech_text(draft, lang)
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / f"{key}.wav"
            unknown = _synthesize(pipelines[lang], voice, spoken, wav)
            mp3 = out / f"{key}.mp3"
            _to_mp3(wav, mp3)
            with wave.open(str(wav)) as w:
                seconds = round(w.getnframes() / w.getframerate(), 1)
        if unknown:
            print(f"warning: unpronounced words in {key}: {unknown}", file=sys.stderr)
        words = len(spoken.split())
        print(f"{key}: {voice} {seconds}s, {words} words ({seconds / words:.2f} s/word), "
              f"{mp3.stat().st_size} bytes", file=sys.stderr)
        # `sha256` is of the on-screen draft (what the browser matches); `spoken_sha256` of what Kokoro read.
        manifest[key] = {"file": f"{key}.mp3", "voice": voice, "sha256": sha256(draft),
                         "spoken_sha256": sha256(spoken), "seconds": seconds}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--voice-en", default=VOICES["en"])
    ap.add_argument("--voice-es", default=VOICES["es"])
    ap.add_argument("--out", type=Path, default=AUDIO_DIR)
    a = ap.parse_args()
    if not FFMPEG.exists():
        sys.exit(f"ffmpeg not found at {FFMPEG}; set FFMPEG in pipeline/voice.py or install it")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    generate({"en": a.voice_en, "es": a.voice_es}, a.out)


if __name__ == "__main__":
    main()
