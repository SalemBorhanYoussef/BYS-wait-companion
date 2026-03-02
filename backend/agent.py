import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path

import weave
from mistralai import Mistral


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
GENERATED_APP_DIR = FRONTEND_DIR / "generated-app"
AGENT_IDS: dict[str, str] = {}
GENERATED_APP_TTL_SECONDS = 300
DEFAULT_STAGE_BUILDER_MODEL = "codestral-latest"
DEFAULT_EXPERIMENT_BUILDER_MODEL = "codestral-latest"
DEFAULT_EXPERIMENT_RESEARCH_MODEL = "mistral-small-latest"
DEFAULT_PODCAST_MODEL = "mistral-medium-latest"


def _env_value(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


PODCAST_AGENT_INSTRUCTIONS = """
You are the Mistral Wait-Companion podcast host.
Write a short spoken live intro for the user while their app is being generated.
Use web_search only when the topic clearly benefits from fresh, factual web information.
Keep the tone playful, concise, clear, slightly geeky, and easy to narrate aloud.
Return plain spoken text only. No markdown. No bullets. No stage directions.
""".strip()


STAGE_APP_AGENT_INSTRUCTIONS = """
You are the app builder for Mistral Wait-Companion.
Generate a small, polished single-page app for the user's request in a safe stage-demo mode.

Hard constraints:
- Keep the app simple and actually runnable in plain HTML, CSS, and JavaScript.
- Match the existing hackathon theme: deep navy background, soft blue depth, orange accents, crisp cards, subtle pixel/retro details.
- Do not use web_search in this mode.
- Never rely on build tools, frameworks, or package managers.
- Keep code lightweight, predictable, and demo-friendly.
- Prefer stable layouts, simple interactions, and low-risk logic.

Return strictly valid JSON with this shape:
{
  "title": "short title",
  "summary": "one short summary sentence",
  "html": "<section>...</section>",
  "css": "scoped css only",
  "js": "plain browser javascript"
}

Rules for fields:
- "html" must be markup only for the app body content. No <!DOCTYPE>, <html>, <head>, <body>, <style>, or <script>.
- "css" must not include <style> tags.
- "js" must not include <script> tags.
- Scope CSS to classes inside the generated app.
- Prefer accessible, responsive layouts.
""".strip()


BUILDER_APP_AGENT_INSTRUCTIONS = """
You are the experimental app builder for Mistral Wait-Companion.
Generate a small but genuinely functional single-page app for the user's request.

Hard constraints:
- Keep the app runnable in plain HTML, CSS, and JavaScript only.
- Match the existing hackathon theme: deep navy background, soft blue depth, orange accents, crisp cards, subtle pixel/retro details.
- You may use web_search when the request needs current facts, partner context, market/news context, or real-world references.
- If web_search is not needed, do not use it.
- Build a basic but working version of the requested app or game.
- Prefer compact features over ambitious but broken output.
- Prioritize correctness, interaction quality, and clarity over visual novelty.
- Do not produce placeholder-heavy shells. Ship one complete core loop instead.
- Keep the generated scope small enough that the result feels finished.
- Never rely on frameworks, package managers, or server code.

Return strictly valid JSON with this shape:
{
  "title": "short title",
  "summary": "one short summary sentence",
  "html": "<section>...</section>",
  "css": "scoped css only",
  "js": "plain browser javascript"
}

Rules for fields:
- "html" must be markup only for the app body content. No <!DOCTYPE>, <html>, <head>, <body>, <style>, or <script>.
- "css" must not include <style> tags.
- "js" must not include <script> tags.
- Scope CSS to classes inside the generated app.
- Prefer accessible, responsive layouts.
- If the request is for a game, return a genuinely playable micro-game.
- If the request is for a content site, structure the content clearly and keep facts concise.
- If the request is for a news/site concept, render only a few strong sections, not a bloated portal.
- If the request is for a partner/company page, keep the factual copy short and clearly usable.
Quality bar:
- The app must be understandable within 5 seconds.
- The user should see one obvious primary interaction immediately.
- JavaScript should be short, readable, and directly tied to the visible UI.
""".strip()


RESEARCH_BRIEF_INSTRUCTIONS = """
You are the research planner for Mistral Wait-Companion.
Use web_search only when the request clearly needs current or real-world information.
Return a concise implementation brief for the code model.

Return plain text with exactly these sections:
GOAL:
FACTS:
UI:
INTERACTIONS:
CONSTRAINTS:

Rules:
- Keep it short and implementation-focused.
- FACTS must contain only concrete facts worth using in the app.
- If no web research is needed, say "No external facts needed."
- Do not write code.
""".strip()


def _normalize_mode(mode: str | None) -> str:
    return "builder" if str(mode or "").strip().lower() == "builder" else "stage"


def _model_supports_builtin_connectors(model: str) -> bool:
    lowered = model.lower()
    unsupported_families = ["codestral"]
    return not any(family in lowered for family in unsupported_families)


def _infer_request_profile(topic: str) -> str:
    lowered = topic.lower()
    if any(keyword in lowered for keyword in ["game", "runner", "platformer", "arcade", "2d"]):
        return "game"
    if any(keyword in lowered for keyword in ["news", "headline", "magazine", "journal"]):
        return "news"
    if any(keyword in lowered for keyword in ["partner", "company", "brand", "supercell", "landing page"]):
        return "partner"
    return "app"


def _should_use_web_research(mode: str, request_profile: str, topic: str) -> bool:
    if _normalize_mode(mode) != "builder":
        return False

    if request_profile in {"news", "partner"}:
        return True

    lowered = topic.lower()
    search_triggers = [
        "latest",
        "recent",
        "current",
        "today",
        "news",
        "partner",
        "supercell",
        "company",
        "market",
        "headline",
    ]
    return any(trigger in lowered for trigger in search_triggers)


def _get_client() -> Mistral | None:
    api_key = _env_value("MISTRAL_API_KEY", "Mistral_API_KEY")
    return Mistral(api_key=api_key) if api_key else None


def _extract_message_text(response) -> str:
    chunks: list[str] = []
    for output in getattr(response, "outputs", []):
        content = getattr(output, "content", None)
        if isinstance(content, str):
            chunks.append(content)
            continue

        if isinstance(content, list):
            for chunk in content:
                text = getattr(chunk, "text", None)
                if text:
                    chunks.append(text)

    return "\n".join(part.strip() for part in chunks if part and part.strip()).strip()


def _strip_code_fences(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _extract_json_object(raw_text: str) -> dict:
    cleaned = _strip_code_fences(raw_text)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in agent response.")
    return json.loads(cleaned[start : end + 1])


def _sanitize_fragment(fragment: str, tag_name: str) -> str:
    cleaned = _strip_code_fences(fragment)
    cleaned = re.sub(
        rf"</?{tag_name}[^>]*>",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def _sanitize_html_fragment(fragment: str) -> str:
    cleaned = _strip_code_fences(fragment)
    dangerous_tags = ["script", "style", "iframe", "object", "embed", "link", "meta", "base"]
    for tag_name in dangerous_tags:
        cleaned = re.sub(
            rf"<{tag_name}\b[^>]*>.*?</{tag_name}>",
            "",
            cleaned,
            flags=re.IGNORECASE | re.DOTALL,
        )
        cleaned = re.sub(
            rf"</?{tag_name}\b[^>]*>",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )

    cleaned = re.sub(r"\son[a-zA-Z-]+\s*=\s*([\"']).*?\1", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"\son[a-zA-Z-]+\s*=\s*[^\s>]+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(href|src|action)\s*=\s*([\"'])\s*javascript:[^\"']*\2", r'\1="#"', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s(srcdoc|formaction)\s*=\s*([\"']).*?\2", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    return cleaned.strip()


def _sanitize_css_fragment(fragment: str) -> str:
    cleaned = _sanitize_fragment(fragment, "style")
    cleaned = re.sub(r"@import\s+url\([^)]*\)\s*;?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"@import\s+[\"'][^\"']*[\"']\s*;?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"expression\s*\([^)]*\)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"url\s*\(\s*([\"'])?\s*javascript:[^)]*\)", "none", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _sanitize_js_fragment(fragment: str) -> str:
    cleaned = _sanitize_fragment(fragment, "script")
    dangerous_patterns = [
        r"\bwindow\.parent\b",
        r"\bwindow\.top\b",
        r"\bdocument\.cookie\b",
        r"\blocalStorage\b",
        r"\bsessionStorage\b",
        r"\bindexedDB\b",
        r"\bBroadcastChannel\b",
        r"\bSharedWorker\b",
        r"\bServiceWorker\b",
        r"\bnavigator\.sendBeacon\b",
        r"\bXMLHttpRequest\b",
        r"\bWebSocket\b",
        r"\bEventSource\b",
    ]
    if any(re.search(pattern, cleaned, flags=re.IGNORECASE) for pattern in dangerous_patterns):
        return (
            "console.warn('Generated script contained blocked capabilities and was disabled.');"
        )
    return cleaned.strip()


def _ensure_agent(
    client: Mistral,
    cache_key: str,
    model: str,
    name: str,
    instructions: str,
    tools: list[dict] | None = None,
) -> str:
    cached_agent_id = AGENT_IDS.get(cache_key)
    if cached_agent_id:
        return cached_agent_id

    create_kwargs = {
        "model": model,
        "name": name,
        "description": name,
        "instructions": instructions,
        "completion_args": {"temperature": 0.2},
    }
    if tools:
        create_kwargs["tools"] = tools

    agent = client.beta.agents.create(**create_kwargs)
    AGENT_IDS[cache_key] = agent.id
    return agent.id


def _run_agent_prompt(
    cache_key: str,
    model: str,
    name: str,
    instructions: str,
    prompt: str,
    tools: list[dict] | None = None,
) -> str:
    client = _get_client()
    if client is None:
        raise RuntimeError("MISTRAL_API_KEY is missing.")

    agent_id = _ensure_agent(client, cache_key, model, name, instructions, tools)
    try:
        response = client.beta.conversations.start(
            agent_id=agent_id,
            inputs=prompt,
            store=False,
        )
    except Exception:
        AGENT_IDS.pop(cache_key, None)
        agent_id = _ensure_agent(client, cache_key, model, name, instructions, tools)
        response = client.beta.conversations.start(
            agent_id=agent_id,
            inputs=prompt,
            store=False,
        )

    return _extract_message_text(response)


def _fallback_podcast_script(user_name: str, topic: str) -> str:
    return (
        f"Hello {user_name}. Your {topic} build is loading, the wait screen is live, "
        "and the Mistral companion is keeping you entertained while the app comes together."
    )


async def _generate_research_brief(user_name: str, topic: str, request_profile: str) -> str:
    client = _get_client()
    if client is None:
        return "No external facts needed."

    research_model = os.getenv("MISTRAL_EXPERIMENT_RESEARCH_MODEL", DEFAULT_EXPERIMENT_RESEARCH_MODEL)
    if not _model_supports_builtin_connectors(research_model):
        return "No external facts needed."

    prompt = (
        f'User name: "{user_name}"\n'
        f'Requested app: "{topic}"\n'
        f'Request profile: "{request_profile}"\n'
        "Create the implementation research brief now."
    )

    return await asyncio.to_thread(
        _run_agent_prompt,
        f"research_planner_{request_profile}",
        research_model,
        "Wait Companion Research Planner",
        RESEARCH_BRIEF_INSTRUCTIONS,
        prompt,
        [{"type": "web_search"}],
    )


def _fallback_app_bundle(user_name: str, topic: str, mode: str = "stage") -> dict[str, str]:
    safe_topic = topic.strip() or "Hackathon Demo"
    safe_name = user_name.strip() or "Builder"
    normalized_mode = _normalize_mode(mode)
    mode_label = "Builder Mode" if normalized_mode == "builder" else "Stage Mode"
    return {
        "title": f"{safe_topic} Demo",
        "summary": f"A lightweight {mode_label.lower()} app for {safe_name}.",
        "used_fallback": True,
        "resolved_mode": normalized_mode,
        "html": f"""
<section class="generated-hero">
  <div class="generated-pill">{mode_label}</div>
  <h1>{safe_topic}</h1>
  <p class="generated-subtitle">A fast, focused prototype generated for {safe_name}.</p>
</section>
<section class="generated-grid">
  <article class="generated-card">
    <h2>Core Idea</h2>
    <p>This demo keeps the scope intentionally small so it stays runnable and easy to evolve.</p>
  </article>
  <article class="generated-card">
    <h2>Interaction</h2>
    <button class="generated-primary" id="generatedActionBtn">Launch Demo Action</button>
    <p id="generatedStatus">System ready for the next iteration.</p>
  </article>
  <article class="generated-card generated-card-wide">
    <h2>Why This Fits</h2>
    <ul>
      <li>Plain HTML, CSS, and JavaScript</li>
      <li>Consistent with the wait-companion hackathon theme</li>
      <li>Easy to replace with a richer generated version later</li>
    </ul>
  </article>
</section>
""".strip(),
        "css": """
.generated-hero {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.generated-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(249, 115, 22, 0.32);
  background: rgba(249, 115, 22, 0.08);
  color: #fdba74;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.generated-hero h1 {
  margin: 0;
  font-size: clamp(2.4rem, 6vw, 4.8rem);
  line-height: 0.96;
}

.generated-subtitle {
  margin: 0;
  max-width: 60ch;
  color: #9fb4d2;
  font-size: 1.08rem;
}

.generated-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.generated-card {
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(120, 150, 210, 0.16);
  background: linear-gradient(180deg, rgba(9, 20, 44, 0.96), rgba(4, 10, 24, 0.98));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}

.generated-card h2 {
  margin: 0 0 12px;
  font-size: 1.1rem;
}

.generated-card-wide {
  grid-column: 1 / -1;
}

.generated-card ul {
  margin: 0;
  padding-left: 18px;
  color: #d8e2f0;
  line-height: 1.7;
}

.generated-primary {
  min-height: 46px;
  padding: 0 18px;
  border: none;
  border-radius: 16px;
  background: linear-gradient(135deg, #ff7a1a, #fb923c);
  color: white;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 16px 32px rgba(249, 115, 22, 0.24);
}

#generatedStatus {
  margin-top: 14px;
  color: #67e8f9;
}

@media (max-width: 760px) {
  .generated-grid {
    grid-template-columns: 1fr;
  }

  .generated-card-wide {
    grid-column: auto;
  }
}
""".strip(),
        "js": """
const generatedActionBtn = document.getElementById('generatedActionBtn');
const generatedStatus = document.getElementById('generatedStatus');

if (generatedActionBtn && generatedStatus) {
  generatedActionBtn.addEventListener('click', () => {
    generatedStatus.textContent = 'Demo action executed. Ready for the next feature pass.';
  });
}
""".strip(),
    }


def _remove_generated_app_dir(build_dir: Path) -> None:
    for child in build_dir.iterdir():
        child.unlink(missing_ok=True)
    build_dir.rmdir()


def _build_manifest_path(build_dir: Path) -> Path:
    return build_dir / "manifest.json"


def _load_generated_app_manifest(build_dir: Path) -> dict | None:
    manifest_path = _build_manifest_path(build_dir)
    if not manifest_path.exists():
        return None

    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _cleanup_generated_apps(keep_build_id: str, max_builds: int = 6) -> None:
    GENERATED_APP_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    build_dirs = [entry for entry in GENERATED_APP_DIR.iterdir() if entry.is_dir()]
    fresh_build_dirs: list[Path] = []

    for build_dir in build_dirs:
        if build_dir.name == keep_build_id:
            fresh_build_dirs.append(build_dir)
            continue

        build_age_seconds = now - build_dir.stat().st_mtime
        if build_age_seconds > GENERATED_APP_TTL_SECONDS:
            _remove_generated_app_dir(build_dir)
            continue

        fresh_build_dirs.append(build_dir)

    fresh_build_dirs.sort(key=lambda entry: entry.stat().st_mtime, reverse=True)

    for build_dir in fresh_build_dirs[max_builds:]:
        if build_dir.name == keep_build_id:
            continue
        _remove_generated_app_dir(build_dir)


def _list_generated_app_history() -> list[dict[str, str]]:
    GENERATED_APP_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    history_items: list[dict[str, str]] = []

    for build_dir in GENERATED_APP_DIR.iterdir():
        if not build_dir.is_dir():
            continue

        build_age_seconds = now - build_dir.stat().st_mtime
        if build_age_seconds > GENERATED_APP_TTL_SECONDS:
            _remove_generated_app_dir(build_dir)
            continue

        manifest = _load_generated_app_manifest(build_dir)
        if manifest is None:
            continue

        history_items.append(
            {
                "build_id": build_dir.name,
                "title": str(manifest.get("title", "Generated Hackathon App")),
                "summary": str(manifest.get("summary", "")),
                "app_url": f"/generated-app/{build_dir.name}/index.html",
                "mode": str(manifest.get("mode", "stage")),
                "created_at": str(manifest.get("created_at", "")),
                "age_seconds": str(int(build_age_seconds)),
            }
        )

    history_items.sort(key=lambda item: item["created_at"], reverse=True)
    return history_items


def _write_generated_app(bundle: dict[str, str]) -> str:
    build_id = uuid.uuid4().hex[:10]
    build_dir = GENERATED_APP_DIR / build_id
    build_dir.mkdir(parents=True, exist_ok=True)
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    html_fragment = _sanitize_html_fragment(bundle.get("html", ""))
    css_fragment = _sanitize_css_fragment(bundle.get("css", ""))
    js_fragment = _sanitize_js_fragment(bundle.get("js", ""))
    title = bundle.get("title", "Generated Hackathon App").strip() or "Generated Hackathon App"

    bridge_script = """
(function () {
  var lastPublishedHeight = 0;
  var appShell = document.querySelector(".generated-app-shell");

  function publishHeight() {
    var shellHeight = appShell ? Math.ceil(appShell.scrollHeight) : 0;
    var height = shellHeight;

    if (!height) {
      return;
    }

    if (Math.abs(height - lastPublishedHeight) < 4) {
      return;
    }

    lastPublishedHeight = height;

    if (window.parent && height) {
      window.parent.postMessage(
        {
          type: "mistral-generated-app-height",
          height: height
        },
        "*"
      );
    }
  }

  window.addEventListener("load", publishHeight);
  window.addEventListener("resize", publishHeight);

  if (typeof ResizeObserver !== "undefined") {
    var resizeObserver = new ResizeObserver(function () {
      publishHeight();
    });
    if (appShell) {
      resizeObserver.observe(appShell);
    }
  } else {
    setInterval(publishHeight, 500);
  }

  setTimeout(publishHeight, 60);
})();
""".strip()

    merged_js = "\n\n".join(part for part in [js_fragment, bridge_script] if part.strip())

    index_markup = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="./app.css">
</head>
<body>
    <div class="generated-app">
        <div class="generated-app-shell">
{html_fragment}
        </div>
    </div>
    <script src="./app.js"></script>
</body>
</html>
"""

    base_css = """
:root {
  color-scheme: dark;
  --generated-bg: #020d23;
  --generated-bg-soft: #09142c;
  --generated-text: #f8fafc;
  --generated-muted: #94a3b8;
  --generated-border: rgba(120, 150, 210, 0.18);
  --generated-orange: #f97316;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at top center, rgba(15, 66, 132, 0.18), transparent 26%),
    linear-gradient(180deg, #010918 0%, var(--generated-bg) 100%);
  color: var(--generated-text);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image: linear-gradient(rgba(59, 130, 246, 0.16) 0 0);
  background-size: 26px 26px;
}

.generated-app {
  min-height: 0;
  padding: 36px;
  overflow-x: hidden;
}

.generated-app-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

a {
  color: inherit;
}
"""

    (build_dir / "index.html").write_text(index_markup, encoding="utf-8")
    (build_dir / "app.css").write_text(f"{base_css}\n\n{css_fragment}\n", encoding="utf-8")
    (build_dir / "app.js").write_text(merged_js, encoding="utf-8")
    _build_manifest_path(build_dir).write_text(
        json.dumps(
            {
                "title": title,
                "summary": bundle.get("summary", ""),
                "mode": bundle.get("resolved_mode", "stage"),
                "created_at": created_at,
            },
            ensure_ascii=True,
            indent=2,
        ),
        encoding="utf-8",
    )
    _cleanup_generated_apps(keep_build_id=build_id)

    return f"/generated-app/{build_id}/index.html"


@weave.op()
async def generate_podcast_script(user_name: str, topic: str, mode: str = "stage") -> str:
    client = _get_client()
    if client is None:
        return _fallback_podcast_script(user_name, topic)

    normalized_mode = _normalize_mode(mode)
    podcast_model = os.getenv("MISTRAL_PODCAST_MODEL", DEFAULT_PODCAST_MODEL)
    podcast_tools = (
        [{"type": "web_search"}]
        if normalized_mode == "builder" and _model_supports_builtin_connectors(podcast_model)
        else None
    )

    prompt = (
        f'Mode: "{normalized_mode}"\n'
        f'User name: "{user_name}"\n'
        f'Topic: "{topic}"\n'
        "Write the live spoken intro now."
    )

    try:
        return await asyncio.to_thread(
            _run_agent_prompt,
            f"podcast_agent_{normalized_mode}",
            podcast_model,
            "Wait Companion Podcast Host",
            PODCAST_AGENT_INSTRUCTIONS,
            prompt,
            podcast_tools,
        )
    except Exception as error:
        print(f"Mistral podcast agent error: {error}")
        return _fallback_podcast_script(user_name, topic)


@weave.op()
async def generate_app_bundle(
    user_name: str,
    topic: str,
    script: str,
    mode: str = "stage",
) -> dict[str, str]:
    client = _get_client()
    normalized_mode = _normalize_mode(mode)
    if client is None:
        bundle = _fallback_app_bundle(user_name, topic, normalized_mode)
        bundle["app_url"] = _write_generated_app(bundle)
        bundle["history"] = _list_generated_app_history()
        return bundle

    builder_instructions = (
        BUILDER_APP_AGENT_INSTRUCTIONS if normalized_mode == "builder" else STAGE_APP_AGENT_INSTRUCTIONS
    )
    if normalized_mode == "builder":
        builder_model = os.getenv(
            "MISTRAL_EXPERIMENT_BUILDER_MODEL",
            os.getenv("MISTRAL_BUILDER_MODEL", DEFAULT_EXPERIMENT_BUILDER_MODEL),
        )
    else:
        builder_model = os.getenv(
            "MISTRAL_STAGE_BUILDER_MODEL",
            os.getenv("MISTRAL_BUILDER_MODEL", DEFAULT_STAGE_BUILDER_MODEL),
        )
    builder_tools = None

    print(f"App builder mode '{normalized_mode}' using model '{builder_model}'.")
    request_profile = _infer_request_profile(topic)
    research_brief = "No external facts needed."
    if _should_use_web_research(normalized_mode, request_profile, topic):
        try:
            research_brief = await _generate_research_brief(user_name, topic, request_profile)
            print(
                f"Research brief generated for builder mode using "
                f"{os.getenv('MISTRAL_EXPERIMENT_RESEARCH_MODEL', DEFAULT_EXPERIMENT_RESEARCH_MODEL)}."
            )
        except Exception as error:
            print(f"Mistral research planner error: {error}")
            research_brief = "No external facts needed."

    profile_guidance = {
        "game": (
            "Request profile: game.\n"
            "Return one small playable mechanic with clear controls, scoring or progress, and immediate feedback.\n"
            "Do not build multiple unfinished systems."
        ),
        "news": (
            "Request profile: news/content site.\n"
            "Return a compact editorial page with a small number of strong sections and concise factual cards.\n"
            "Avoid giant portal layouts."
        ),
        "partner": (
            "Request profile: partner/company page.\n"
            "Return a polished marketing microsite with concise real-world copy and one strong CTA area.\n"
            "Avoid generic lorem-ipsum style filler."
        ),
        "app": (
            "Request profile: general app.\n"
            "Return one focused app flow with a clearly visible primary interaction."
        ),
    }[request_profile]

    prompt = (
        f'Build mode: "{normalized_mode}"\n'
        f'User name: "{user_name}"\n'
        f'Requested app: "{topic}"\n'
        f'Podcast context: "{script}"\n'
        f"{profile_guidance}\n"
        f"Research brief:\n{research_brief}\n"
        "First decide the single strongest app concept that can be completed well in one page.\n"
        "Then generate only that finished version.\n"
        "Generate the app bundle now."
    )

    try:
        raw_text = await asyncio.to_thread(
            _run_agent_prompt,
            f"builder_agent_{normalized_mode}",
            builder_model,
            "Wait Companion App Builder",
            builder_instructions,
            prompt,
            builder_tools,
        )
        bundle = _extract_json_object(raw_text)
    except Exception as error:
        print(f"Mistral app builder error: {error}")
        bundle = _fallback_app_bundle(user_name, topic, normalized_mode)

    normalized_bundle = {
        "title": str(bundle.get("title", "Generated Hackathon App")).strip(),
        "summary": str(bundle.get("summary", f"A generated app for {topic}.")).strip(),
        "used_fallback": bool(bundle.get("used_fallback", False)),
        "resolved_mode": normalized_mode,
        "html": str(bundle.get("html", "")).strip(),
        "css": str(bundle.get("css", "")).strip(),
        "js": str(bundle.get("js", "")).strip(),
    }
    normalized_bundle["app_url"] = _write_generated_app(normalized_bundle)
    normalized_bundle["history"] = _list_generated_app_history()
    return normalized_bundle
