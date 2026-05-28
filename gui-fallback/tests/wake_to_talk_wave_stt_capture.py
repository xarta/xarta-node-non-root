#!/usr/bin/env python3
"""Generate TTS WAV fixtures and capture live Wake-to-Talk STT transcripts.

This script deliberately stops before Matrix. It writes real STT transcript
events to JSON files that `wake-to-talk-wave-e2e.test.cjs` replays through the
production JavaScript FSM to assert frozen pre-Matrix send snapshots.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import struct
import time
import wave
from pathlib import Path
from urllib import request
from urllib.error import HTTPError
from urllib.parse import urlparse, urlunparse

import websockets


API_BASE = os.environ.get("BLUEPRINTS_API_BASE", "http://127.0.0.1:8080").rstrip("/")
FIXTURE_DIR = Path(os.environ.get("WAKE_WAVE_FIXTURE_DIR", "/xarta-node/.lone-wolf/state/wake-to-talk-wave-e2e"))
TRANSCRIPT_DIR = Path(os.environ.get("WAKE_WAVE_TRANSCRIPT_DIR", str(FIXTURE_DIR / "transcripts")))
VOICE = os.environ.get("WAKE_WAVE_TTS_VOICE", "Majel_1.wav")
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 4096
ALLOW_ACTIVE_WAKE = os.environ.get("WAKE_WAVE_ALLOW_ACTIVE_WAKE") == "1"
WAKE_WAVE_NOISE_REDUCTION = os.environ.get("WAKE_WAVE_NOISE_REDUCTION", "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


SCENARIOS = [
    {
        "name": "no-wake-no-send",
        "parts": [{"text": "what is three times five"}],
    },
    {
        "name": "wake-phrase-autoexecute",
        "parts": [{"text": "Computer"}, {"silence_ms": 750}, {"text": "what is three times five"}],
    },
    {
        "name": "wake-phrase-spoken-execute",
        "parts": [
            {"text": "Computer"},
            {"silence_ms": 750},
            {"text": "what is three times five"},
            {"silence_ms": 350},
            {"text": "Computer execute"},
        ],
    },
    {
        "name": "pause-resume-execute",
        "parts": [
            {"text": "Computer"},
            {"silence_ms": 750},
            {"text": "start this message"},
            {"silence_ms": 350},
            {"text": "Computer pause dictation"},
            {"silence_ms": 350},
            {"text": "ignored while paused"},
            {"silence_ms": 350},
            {"text": "Computer resume dictation"},
            {"silence_ms": 350},
            {"text": "and finish it"},
            {"silence_ms": 350},
            {"text": "Computer execute"},
        ],
    },
    {
        "name": "cancel-clears-no-send",
        "parts": [
            {"text": "Computer"},
            {"silence_ms": 750},
            {"text": "throw this away"},
            {"silence_ms": 350},
            {"text": "Computer cancel dictation"},
        ],
    },
    {
        "name": "same-phrase-valid-separate-sessions",
        "parts": [
            {"text": "Computer"},
            {"silence_ms": 750},
            {"text": "repeatable phrase"},
            {"silence_ms": 1100},
            {"text": "Computer"},
            {"silence_ms": 750},
            {"text": "repeatable phrase"},
        ],
    },
]


CONTINUOUS_NO_END_SCENARIOS = [
    {
        "name": "continuous-no-end-wake-word",
        "parts": [{"text": "Computer"}, {"silence_ms": 2500}],
        "expect_text": "computer",
    },
]


def slug(value: str) -> str:
    clean = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    clean = "-".join(part for part in clean.split("-") if part)
    return clean[:80] or "fixture"


def http_post_json_bytes(url: str, payload: dict) -> bytes:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=180) as response:
            return response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc


def http_get_json(url: str) -> dict:
    try:
        with request.urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc


def assert_no_active_browser_wake_to_talk() -> None:
    if ALLOW_ACTIVE_WAKE:
        return
    status = http_get_json(f"{API_BASE}/api/v1/voice-mode/status")
    active = status.get("active") if isinstance(status, dict) else None
    if not isinstance(active, dict):
        return
    if not (active.get("stt_enabled") and active.get("stt_mode") == "wake_to_talk"):
        return

    label = active.get("browser_label") or active.get("browser_id") or "unknown browser"
    raise RuntimeError(
        "Wake-to-Talk is active in another browser, which can compete with "
        "this live STT capture test for the shared STT runtime. Turn off "
        f"WAKE TO TALK in {label} before running this suite, or set "
        "WAKE_WAVE_ALLOW_ACTIVE_WAKE=1 if you intentionally want to test "
        "under contention."
    )


def synthesize(text: str, regenerate: bool = False) -> Path:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = FIXTURE_DIR / f"{slug(text)}.wav"
    if path.exists() and not regenerate:
        return path
    audio = http_post_json_bytes(
        f"{API_BASE}/api/v1/tts/speak",
        {
            "text": text,
            "voice": VOICE,
            "mode": "batch",
            "format": "wav",
            "sanitize_text": False,
            "transform_profile": "none",
            "allow_fallback": False,
            "client_id": "wake-wave-e2e",
            "timeout_ms": 120000,
        },
    )
    path.write_bytes(audio)
    return path


def read_wav(path: Path) -> list[float]:
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    if sample_width != 2:
        raise RuntimeError(f"{path} uses unsupported sample width {sample_width}")
    samples = []
    for index in range(0, len(frames), sample_width * channels):
        total = 0.0
        for channel in range(channels):
            offset = index + channel * sample_width
            total += struct.unpack_from("<h", frames, offset)[0] / 32768.0
        samples.append(total / channels)
    return resample(samples, sample_rate, SAMPLE_RATE)


def resample(samples: list[float], input_rate: int, output_rate: int) -> list[float]:
    if input_rate == output_rate:
        return samples
    ratio = input_rate / output_rate
    output_len = max(1, int(len(samples) / ratio))
    output = []
    for idx in range(output_len):
        pos = idx * ratio
        left = int(math.floor(pos))
        right = min(len(samples) - 1, left + 1)
        frac = pos - left
        output.append((samples[left] * (1 - frac)) + (samples[right] * frac))
    return output


def write_wav(path: Path, samples: list[float]) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        data = bytearray()
        for sample in samples:
            value = max(-1.0, min(1.0, sample))
            data.extend(struct.pack("<h", round(value * 32767)))
        wf.writeframes(bytes(data))


def build_scenario_wav(scenario: dict, regenerate: bool = False) -> Path:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = FIXTURE_DIR / f"{scenario['name']}.wav"
    if path.exists() and not regenerate:
        return path
    samples: list[float] = []
    for part in scenario["parts"]:
        if "silence_ms" in part:
            samples.extend([0.0] * round(SAMPLE_RATE * int(part["silence_ms"]) / 1000))
        else:
            samples.extend(read_wav(synthesize(part["text"], regenerate=regenerate)))
    write_wav(path, samples)
    return path


def websocket_url() -> str:
    parsed = urlparse(API_BASE)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = "server=tb1"
    if WAKE_WAVE_NOISE_REDUCTION:
        query += "&noise_reduction=1&atten_lim_db=6"
    else:
        query += "&noise_reduction=0"
    return urlunparse((scheme, parsed.netloc, "/api/v1/voice-mode/stt/ws", "", query, ""))


async def capture_stt(wav_path: Path, *, send_end: bool = False, require_nonempty_text: str = "") -> list[dict]:
    samples = read_wav(wav_path)
    transcripts: list[dict] = []
    done_sending = asyncio.Event()
    last_message_at = time.monotonic()
    required = require_nonempty_text.strip().lower()

    async with websockets.connect(websocket_url(), max_size=16 * 1024 * 1024) as ws:
        async def sender() -> None:
            audio_frames = 0
            for offset in range(0, len(samples), CHUNK_SAMPLES):
                chunk = samples[offset : offset + CHUNK_SAMPLES]
                payload = struct.pack(f"<{len(chunk)}f", *chunk)
                await ws.send(payload)
                audio_frames += 1
                await asyncio.sleep(len(chunk) / SAMPLE_RATE)
            if send_end:
                await ws.send(json.dumps({"type": "end", "audio_frames": audio_frames, "audio_bytes": len(samples) * 4}))
            done_sending.set()

        sender_task = asyncio.create_task(sender())
        started_at = time.monotonic()
        while True:
            if required and any(required in str(item.get("text") or "").lower() for item in transcripts):
                break
            if required and done_sending.is_set() and time.monotonic() - last_message_at > 12.0:
                break
            if done_sending.is_set() and transcripts and time.monotonic() - last_message_at > 3.0:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=3.5)
            except asyncio.TimeoutError:
                if required and time.monotonic() - started_at > 15.0:
                    break
                if done_sending.is_set() and transcripts:
                    break
                raise
            last_message_at = time.monotonic()
            if isinstance(raw, bytes):
                continue
            payload = json.loads(raw)
            msg_type = payload.get("type")
            if msg_type in {"partial", "final"}:
                transcripts.append(
                    {
                        "type": msg_type,
                        "text": str(payload.get("text") or ""),
                        "audio_end_frame": len(transcripts) * 100 + 100,
                        "utterance_id": f"{wav_path.stem}-stream",
                        "timing": payload.get("timing"),
                    }
                )
            elif msg_type == "error":
                raise RuntimeError(payload.get("detail") or "STT websocket error")
        sender_task.cancel()
    if required and not any(required in str(item.get("text") or "").lower() for item in transcripts):
        summary = " | ".join(f"{item.get('type')}:{item.get('text')}" for item in transcripts)
        raise RuntimeError(
            f"No live STT text containing {required!r} arrived without an explicit end. "
            f"Captured events: {summary or '(none)'}"
        )
    return transcripts


async def run_continuous_no_end_smoke(args: argparse.Namespace) -> None:
    for scenario in CONTINUOUS_NO_END_SCENARIOS:
        wav_path = build_scenario_wav(scenario, regenerate=args.regenerate)
        transcripts = await capture_stt(
            wav_path,
            send_end=False,
            require_nonempty_text=scenario["expect_text"],
        )
        summary = " | ".join(f"{item['type']}:{item['text']}" for item in transcripts)
        print(f"{scenario['name']}: no-end live STT text observed")
        print(f"  {summary}")


async def run(args: argparse.Namespace) -> None:
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    if not args.generate_only:
        assert_no_active_browser_wake_to_talk()
        if not args.skip_no_end_smoke:
            await run_continuous_no_end_smoke(args)
    for scenario in SCENARIOS:
        wav_path = build_scenario_wav(scenario, regenerate=args.regenerate)
        if args.generate_only:
            print(f"{scenario['name']}: wav={wav_path}")
            continue
        transcripts = await capture_stt(wav_path, send_end=args.send_end)
        out_path = TRANSCRIPT_DIR / f"{scenario['name']}.json"
        out_path.write_text(
            json.dumps(
                {
                    "scenario": scenario["name"],
                    "wav_path": str(wav_path),
                    "api_base": API_BASE,
                    "stream_mode": "explicit_end" if args.send_end else "continuous_no_explicit_end",
                    "transcripts": transcripts,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        summary = " | ".join(f"{item['type']}:{item['text']}" for item in transcripts)
        print(f"{scenario['name']}: captured {len(transcripts)} transcript events -> {out_path}")
        print(f"  {summary}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--regenerate", action="store_true", help="Regenerate cached TTS WAV fixtures")
    parser.add_argument("--generate-only", action="store_true", help="Only generate WAV fixtures, do not contact STT")
    parser.add_argument(
        "--skip-no-end-smoke",
        action="store_true",
        help="Skip the live continuous no-explicit-end STT smoke. Use only when deliberately testing the older finalized capture path.",
    )
    parser.add_argument(
        "--send-end",
        action="store_true",
        help="Legacy finalized-capture mode: send an explicit STT end command after fixture audio. Do not use for normal Wake-to-Talk validation.",
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
