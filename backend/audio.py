import os
import re
import uuid
from pathlib import Path
from typing import Iterator

import requests
from gtts import gTTS


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
GENERATED_AUDIO_PREFIX = "audio_"
DEFAULT_FALLBACK_AUDIO = "audio_1dece0f3.mp3"
DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5"


def _env_value(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def normalize_audio_provider(provider: str | None) -> str:
    normalized = str(provider or "").strip().lower()
    if normalized in {"elevenlabs", "local"}:
        return normalized
    return "elevenlabs" if _env_value("ELEVENLABS_API_KEY", "Elevenlabs_API_KEY") else "local"


def _fallback_audio_url() -> str:
    fallback_name = os.getenv("FALLBACK_AUDIO_FILE", DEFAULT_FALLBACK_AUDIO)
    fallback_path = FRONTEND_DIR / fallback_name
    return fallback_name if fallback_path.exists() else DEFAULT_FALLBACK_AUDIO


def audio_filename_for_text(text: str, provider: str = "local", namespace: str = "podcast") -> str:
    safe_provider = normalize_audio_provider(provider)
    safe_namespace = re.sub(r"[^a-z0-9_-]+", "_", namespace.lower())
    unique_suffix = uuid.uuid4().hex[:12]
    return f"{GENERATED_AUDIO_PREFIX}{safe_namespace}_{safe_provider}_{unique_suffix}.mp3"


def _elevenlabs_request_payload(text: str) -> dict:
    return {
        "text": text,
        "model_id": _env_value("ELEVENLABS_MODEL_ID", "Elevenlabs_MODEL_ID") or DEFAULT_ELEVENLABS_MODEL_ID,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.5,
        },
    }


async def generate_tts_with_provider(
    text: str,
    provider: str = "local",
    namespace: str = "podcast",
) -> tuple[str, bool, str]:
    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
    normalized_provider = normalize_audio_provider(provider)
    filename = audio_filename_for_text(text, provider=normalized_provider, namespace=namespace)
    filepath = FRONTEND_DIR / filename

    if normalized_provider == "local":
        try:
            tts = gTTS(text=text, lang="en", tld="com")
            tts.save(str(filepath))
            return filename, False, normalized_provider
        except Exception as fallback_error:
            print(f"Local gTTS fallback failed: {fallback_error}")
            return _fallback_audio_url(), False, normalized_provider

    api_key = _env_value("ELEVENLABS_API_KEY", "Elevenlabs_API_KEY")
    if not api_key:
        return await generate_tts_with_provider(text, provider="local", namespace=namespace)

    voice_id = _env_value("ELEVENLABS_VOICE_ID", "Elevenlabs_VOICE_ID") or "EXAVITQu4vr4xnSDxMaL"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }

    try:
        response = requests.post(url, json=_elevenlabs_request_payload(text), headers=headers, timeout=30, stream=True)
        response.raise_for_status()
        with filepath.open("wb") as output_file:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    output_file.write(chunk)
    except (requests.RequestException, OSError) as error:
        print(f"ElevenLabs provider synthesis failed: {error}")
        return await generate_tts_with_provider(text, provider="local", namespace=namespace)

    return filename, False, normalized_provider


def stream_tts(text: str) -> Iterator[bytes]:
    api_key = _env_value("ELEVENLABS_API_KEY", "Elevenlabs_API_KEY")
    if not api_key:
        saved_filename = _fallback_audio_url()
        saved_path = FRONTEND_DIR / saved_filename
        if saved_path.exists():
            with saved_path.open("rb") as fallback_file:
                while True:
                    chunk = fallback_file.read(8192)
                    if not chunk:
                        break
                    yield chunk
        return

    voice_id = _env_value("ELEVENLABS_VOICE_ID", "Elevenlabs_VOICE_ID") or "EXAVITQu4vr4xnSDxMaL"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }

    response = None
    try:
        response = requests.post(
            url,
            json=_elevenlabs_request_payload(text),
            headers=headers,
            timeout=30,
            stream=True,
        )
        response.raise_for_status()

        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                yield chunk
    except requests.RequestException as error:
        print(f"ElevenLabs streaming failed: {error}")
        fallback_path = FRONTEND_DIR / _fallback_audio_url()
        if fallback_path.exists():
            with fallback_path.open("rb") as fallback_file:
                while True:
                    chunk = fallback_file.read(8192)
                    if not chunk:
                        break
                    yield chunk
    finally:
        if response is not None:
            response.close()


def resolve_audio_file(filename: str) -> Path | None:
    if not filename.endswith(".mp3"):
        return None

    safe_name = Path(filename).name
    fallback_name = _fallback_audio_url()
    if (
        not safe_name.startswith(GENERATED_AUDIO_PREFIX)
        and safe_name != fallback_name
    ):
        return None

    audio_path = FRONTEND_DIR / safe_name
    return audio_path if audio_path.exists() else None
