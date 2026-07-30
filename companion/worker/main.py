"""Loopback-only OpenAI-compatible Kokoro worker.

The Windows service is the authenticated browser boundary. This process is a
private implementation detail and must never bind outside 127.0.0.1.
"""

from __future__ import annotations

import asyncio
import hmac
import io
import os
import wave
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from pykokoro import KokoroPipeline, PipelineConfig
from pykokoro.generation_config import GenerationConfig

APP_VERSION = "1.0.0"
WORKER_TOKEN = os.environ.get("SPEAKINGLAB_WORKER_TOKEN", "")
if len(WORKER_TOKEN) < 32:
    raise RuntimeError("SPEAKINGLAB_WORKER_TOKEN must be supplied by the companion service")
MODEL_PATH = Path(os.environ.get("SPEAKINGLAB_MODEL_PATH", ""))
VOICES_PATH = Path(os.environ.get("SPEAKINGLAB_VOICES_PATH", ""))
DEFAULT_VOICE = "af_heart"
VOICES = (
    "af_heart",
    "af_bella",
    "af_nicole",
    "af_sarah",
    "am_adam",
    "am_michael",
    "am_fenrir",
    "am_puck",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_fable",
)

app = FastAPI(
    title="Speaking Lab Kokoro Worker",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
SYNTHESIS_GATE = asyncio.Semaphore(1)


@app.middleware("http")
async def require_companion(request: Request, call_next):
    candidate = request.headers.get("x-speakinglab-worker-token", "")
    if not hmac.compare_digest(candidate, WORKER_TOKEN):
        return Response(
            content='{"error":"companion_auth_required"}',
            status_code=401,
            media_type="application/json",
        )
    return await call_next(request)


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=1, max_length=1_000)
    model: Literal["kokoro", "kokoro-82m"] = "kokoro"
    voice: str = DEFAULT_VOICE
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    response_format: Literal["wav"] = "wav"


@lru_cache(maxsize=16)
def _pipeline(voice: str, speed: float) -> KokoroPipeline:
    if not MODEL_PATH.is_file() or not VOICES_PATH.is_file():
        raise ValueError("model_not_installed")
    generation = GenerationConfig(lang="en-us", speed=speed)
    return KokoroPipeline(
        PipelineConfig(
            voice=voice,
            provider="auto",
            model_path=MODEL_PATH,
            voices_path=VOICES_PATH,
            generation=generation,
        )
    )


def _encode_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    audio = np.nan_to_num(audio, nan=0.0, posinf=1.0, neginf=-1.0)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


def _synthesize(request: SpeechRequest) -> bytes:
    if request.voice not in VOICES:
        raise ValueError("voice_not_installed")
    result = _pipeline(request.voice, round(request.speed, 2)).run(request.input.strip())
    return _encode_wav(result.audio, int(result.sample_rate))


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "modelInstalled": MODEL_PATH.is_file() and VOICES_PATH.is_file(),
    }


@app.get("/v1/models")
def models() -> dict[str, list[dict[str, str]]]:
    installed = MODEL_PATH.is_file() and VOICES_PATH.is_file()
    return {
        "data": [
            {
                "id": "kokoro",
                "object": "model",
                "owned_by": "local",
                "status": "installed" if installed else "not_installed",
            }
        ]
    }


@app.get("/v1/audio/voices")
def voices() -> dict[str, list[dict[str, str]]]:
    return {
        "data": [
            {
                "id": voice,
                "name": voice,
                "model": "kokoro",
            }
            for voice in VOICES
        ]
    }


@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest) -> Response:
    # Local loopback WAV avoids another lossy transcode and is small enough for
    # this network boundary. Cloud providers continue to use MP3.
    try:
        async with SYNTHESIS_GATE:
            audio = await asyncio.wait_for(
                asyncio.to_thread(_synthesize, request),
                timeout=55,
            )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except TimeoutError as error:
        # Python cannot safely cancel the native inference thread. Terminate the
        # private worker so the supervising Windows service restarts a clean
        # process instead of accumulating runaway threads.
        os._exit(70)
    except Exception as error:
        # Do not leak local paths, package versions, or model internals.
        raise HTTPException(status_code=503, detail="local_synthesis_failed") from error

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Audio-Bytes": str(len(audio)),
        },
    )
