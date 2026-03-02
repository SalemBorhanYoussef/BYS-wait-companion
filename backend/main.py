import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import weave

from backend.agent import generate_app_bundle
from backend.agent import generate_podcast_script
from backend.audio import generate_tts_with_provider
from backend.audio import audio_filename_for_text
from backend.audio import normalize_audio_provider
from backend.audio import resolve_audio_file
from backend.audio import stream_tts


load_dotenv()

app = FastAPI(title="Mistral Wait-Companion")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.getenv("WANDB_API_KEY"):
    try:
        weave.init("mistral-wait-companion-hackathon")
        print("W&B Weave tracing initialized.")
    except Exception as error:
        print(f"Failed to initialize Weave: {error}")
else:
    print("WANDB_API_KEY not found. Skipping Weave tracing.")


PENDING_AUDIO_TTL_SECONDS = 300
pending_audio_scripts: dict[str, dict[str, str | float]] = {}


def _env_value(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _cleanup_pending_audio_streams() -> None:
    now = time.time()
    expired_keys = [
        key
        for key, entry in pending_audio_scripts.items()
        if now - float(entry.get("created_at", now)) > PENDING_AUDIO_TTL_SECONDS
    ]
    for key in expired_keys:
        pending_audio_scripts.pop(key, None)


class GenerationRequest(BaseModel):
    user_name: str
    topic: str
    mode: str = "stage"


class AudioRequest(BaseModel):
    script: str
    provider: str = "local"
    namespace: str = "podcast"


class AppGenerationRequest(BaseModel):
    user_name: str
    topic: str
    script: str
    mode: str = "stage"


@app.get("/api/health")
async def healthcheck():
    return {"status": "ok"}


@app.post("/api/generate_text")
async def generate_text(req: GenerationRequest):
    print(f"Starting text generation for {req.user_name} on {req.topic}...")

    script = await generate_podcast_script(req.user_name, req.topic, req.mode)
    dummy_code = (
        "<!-- Agent Code Build -->\n"
        f"<h1>{req.topic} App initialized by {req.user_name}</h1>"
    )

    return JSONResponse(
        {
            "status": "success",
            "script": script,
            "dummy_code": dummy_code,
        }
    )


@app.post("/api/generate_audio")
async def generate_audio(req: AudioRequest):
    print("Starting audio synthesis...")
    _cleanup_pending_audio_streams()
    provider = normalize_audio_provider(req.provider)
    namespace = req.namespace or "podcast"

    if provider == "elevenlabs" and _env_value("ELEVENLABS_API_KEY", "Elevenlabs_API_KEY"):
        audio_filename = audio_filename_for_text(req.script, provider=provider, namespace=namespace)
        pending_audio_scripts[audio_filename] = {
            "script": req.script,
            "provider": provider,
            "created_at": time.time(),
        }
        return JSONResponse(
            {
                "status": "success",
                "audio_url": f"/api/audio/live/{audio_filename}",
                "provider": provider,
            }
        )

    audio_filename, _, resolved_provider = await generate_tts_with_provider(
        req.script,
        provider=provider,
        namespace=namespace,
    )

    return JSONResponse(
        {
            "status": "success",
            "audio_url": f"/api/audio/{audio_filename}",
            "provider": resolved_provider,
        }
    )


@app.post("/api/generate_app")
async def generate_app(req: AppGenerationRequest):
    print(f"Starting app generation for {req.user_name} on {req.topic}...")

    app_bundle = await generate_app_bundle(req.user_name, req.topic, req.script, req.mode)
    return JSONResponse(
        {
            "status": "success",
            "title": app_bundle["title"],
            "summary": app_bundle["summary"],
            "used_fallback": app_bundle.get("used_fallback", False),
            "mode": app_bundle.get("resolved_mode", req.mode),
            "app_url": app_bundle["app_url"],
            "history": app_bundle.get("history", []),
        }
    )


@app.get("/api/audio/{filename}")
async def stream_audio(filename: str):
    audio_path = resolve_audio_file(filename)
    if audio_path is None:
        raise HTTPException(status_code=404, detail="Audio file not found.")

    return FileResponse(audio_path, media_type="audio/mpeg", filename=audio_path.name)


@app.get("/api/audio/live/{filename}")
async def live_stream_audio(filename: str):
    _cleanup_pending_audio_streams()
    pending_entry = pending_audio_scripts.get(filename)
    if pending_entry is None:
        raise HTTPException(status_code=404, detail="No pending audio stream found.")

    script = str(pending_entry["script"])
    provider = str(pending_entry.get("provider") or "elevenlabs")

    def live_audio_generator():
        try:
            if provider == "elevenlabs":
                yield from stream_tts(script)
        finally:
            pending_entry["created_at"] = time.time()

    return StreamingResponse(
        live_audio_generator(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
