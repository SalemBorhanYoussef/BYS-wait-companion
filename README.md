---
title: Mistral Wait-Companion
emoji: 🎮
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
short_description: Turn AI waiting time into a playable experience.
---

# Mistral Wait-Companion

Mistral Wait-Companion turns AI waiting time into a playable experience.

Instead of showing a dead loading spinner while an app is being generated, it gives the user:

- a live runner game
- generated narration
- a generated app preview

The strongest part of the project is that the wait screen is not separate from the build pipeline.
It is driven by the same AI workflow that generates the final app:

- **Mistral Agents** for orchestration and prompt-driven generation flow
- **Codestral** for lightweight web app generation in plain HTML, CSS, and JavaScript
- **web_search / research support** for richer builder-mode outputs when current or real-world context helps
- **ElevenLabs** for the welcome voice, live podcast-style narration, and future audio extensions

This project was built for the **Mistral AI Worldwide Hackathon**.

## Showcase

- Watch the demo: [Mistral Wait-Companion on YouTube](https://youtu.be/ga-2SwS_LdY?si=BruA6yp1pmimfng7)
- Try the live app: [BYS-wait-companion on Hugging Face Spaces](https://huggingface.co/spaces/mistral-hackaton-2026/BYS-wait-companion)

## What It Does

The user enters a prompt for an app or website.

While the build runs:

- the frontend switches into a playable HTML5 Canvas wait screen
- Mistral generates the live script and app output
- audio plays either through browser speech or ElevenLabs
- the final generated app opens in a preview overlay when ready

## Product Screens

Three key moments of the experience: prompt entry, live wait gameplay, and generated app preview.

<table>
  <tr>
    <td align="center"><strong>Landing</strong></td>
    <td align="center"><strong>Wait Game</strong></td>
    <td align="center"><strong>Generated App</strong></td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="frontend/assets/screenshots/StartSite.png" alt="Mistral Wait-Companion landing screen" width="100%" />
    </td>
    <td align="center" width="33%">
      <img src="frontend/assets/screenshots/GameSite.png" alt="Mistral Wait-Companion game screen" width="100%" />
    </td>
    <td align="center" width="33%">
      <img src="frontend/assets/screenshots/generationSite.png" alt="Mistral Wait-Companion generated app screen" width="100%" />
    </td>
  </tr>
</table>

## Main Features

- FastAI-style wait-screen replacement for prompt-driven app generation
- Playable runner game instead of a static loading spinner
- Live transcript and audio layer during generation
- Mistral-driven app generation that stays connected to the wait experience
- Agent-based workflow that can be extended toward more autonomous content generation
- `Stage Mode` for stable demo-friendly output
- `Builder Mode` for broader generation with optional research support
- Generated app preview inside a sandboxed iframe
- Short-lived generated app history
- Automatic cleanup of generated apps older than 5 minutes

## Stack

### Backend

- FastAPI
- Mistral API
- Mistral Agents workflow
- Codestral for app-generation output
- ElevenLabs API
- optional Weights & Biases Weave tracing

### Frontend

- Vanilla HTML
- Vanilla CSS
- Vanilla JavaScript
- HTML5 Canvas
- EasyMDE for prompt editing

## Architecture

One of the key strengths of the project is how the AI stack is layered:

- **Mistral Agents** make the generation flow extensible instead of hard-coding a single static prompt path.
- **Codestral** is a strong fit for generating lightweight runnable web apps quickly.
- **Research support / web search** makes Builder Mode more useful for content-heavy or context-aware app ideas.
- **ElevenLabs** makes the waiting phase feel alive through a spoken welcome and podcast-style narration instead of silent UI.

That combination makes the product feel more like an AI-native interface system than a simple game wrapper around a build.

### Backend endpoints

- `POST /api/generate_text`
  Generates the live podcast / narration script with Mistral.

- `POST /api/generate_audio`
  Prepares audio playback.
  - `Local Audio`: browser speech synthesis is used in the frontend
  - `ElevenLabs`: returns a short-lived stream URL

- `POST /api/generate_app`
  Generates a one-page app bundle, writes it into `frontend/generated-app/<build-id>/`, and returns recent generated app history.

- `GET /api/audio/live/{filename}`
  Streams ElevenLabs audio directly without saving the stream as a local MP3 artifact.

- `GET /api/audio/{filename}`
  Serves only explicit fallback audio files when needed.

### Frontend flow

1. User enters a prompt on the landing page.
2. User clicks `Generate and Play`.
3. The game screen starts while generation continues in the background.
4. Transcript and audio update during the wait phase.
5. The generated app becomes available in the overlay.
6. Recent generated apps can be reopened while still within the short retention window.

## Audio Behavior

### Local Audio

- landing intro uses browser speech synthesis
- podcast uses browser speech synthesis
- game SFX use the Web Audio API

### ElevenLabs

- landing intro uses ElevenLabs streaming
- podcast uses ElevenLabs streaming
- game SFX stay local for responsiveness

In the current product direction, ElevenLabs adds value in three places:

1. **Welcome / greeting audio**
   The app can greet the user when the experience starts, making the product feel alive immediately.
2. **Podcast beside the game**
   The narration layer turns the waiting phase into something guided and entertaining instead of silent.
3. **Future app-level audio**
   Generated apps could later receive optional narrated or accessibility-focused audio layers when that improves the experience.

For generated apps themselves, audio integration is possible, but it should stay selective.
As a default, it is usually better **not** to inject audio into every generated app automatically.
That would add complexity and can easily become too much.

The better future direction is:

- keep audio central in the wait experience
- add it to generated apps only when it serves a clear purpose
- especially for accessibility, onboarding, guided demos, or premium branded flows

## Generated Apps

Generated apps are:

- written per build into `frontend/generated-app/<build-id>/`
- shown inside a sandboxed iframe preview
- stored only temporarily
- automatically cleaned after roughly 5 minutes

This keeps the demo lightweight and prevents generated build output from accumulating indefinitely.

## Requirements

- Python 3.9+
- `MISTRAL_API_KEY`
- optional `ELEVENLABS_API_KEY`
- optional `WANDB_API_KEY`

## Environment Setup

Copy `.env.example` to `.env` and fill in the values you need.

Important:

- never commit `.env`
- `.env.example` is safe to commit
- generated app output is intentionally ignored

## Local Setup

```bash
git clone <your-repo-url>
cd MistralHackathon
pip install -r requirements.txt
```

## Run Locally

```bash
uvicorn backend.main:app --reload
```

Open:

```text
http://localhost:8000
```

Do not open `frontend/index.html` with `file://`.

## Docker

Build the image:

```bash
docker build -t mistral-wait-companion .
```

Run it:

```bash
docker run --rm -p 7860:7860 --env-file .env mistral-wait-companion
```

Open:

```text
http://localhost:7860
```

Notes:

- the container reads the same environment variables as local development
- generated apps stay ephemeral inside the container
- for Hugging Face Spaces or similar platforms, the image also respects `PORT`

## Recommended Demo Config

For the safest hackathon demo:

- use `Stage Mode` as default
- use `Local Audio` if you want the most reliable offline-friendly flow
- use `ElevenLabs` when you want stronger narrated presentation

Recommended model defaults:

- `MISTRAL_STAGE_BUILDER_MODEL=codestral-latest`
- `MISTRAL_EXPERIMENT_BUILDER_MODEL=codestral-latest`
- `MISTRAL_EXPERIMENT_RESEARCH_MODEL=mistral-small-latest`
- `MISTRAL_PODCAST_MODEL=mistral-medium-latest`

## Deployment Notes

This app is suitable for hackathon-style deployment such as Docker or Hugging Face Spaces:

- one FastAPI process
- static frontend served by FastAPI
- no frontend build step required
- generated apps are ephemeral

Before submission, verify:

1. `MISTRAL_API_KEY` is set
2. `ELEVENLABS_API_KEY` is set if you want live TTS
3. the app loads correctly from `http://localhost:8000`
4. `Stage Mode` generates at least one clean working demo
5. `Builder Mode` works for your chosen showcase prompts

## Safe To Commit

- source code
- `README.md`
- `.env.example`
- `LICENSE`

Do not commit:

- `.env`
- generated app output
- generated local secrets or tokens

## Demo Prompt Ideas

- `A website for the latest Supercell games news`
- `A game inspired by the fast, colorful energy of popular mobile arena games`
- `A futuristic landing page for an AI hackathon tool`

## Project Vision

Wait-Companion is not just a mini-game around a loading screen.

The bigger idea is a reusable waiting layer for AI-native products:

- app builders
- generation platforms
- creative tools
- branded AI interfaces

The longer-term opportunity is broader than app generation alone.
The same Mistral-driven workflow could grow into:

- AI-generated content experiences
- adaptive onboarding flows
- narrated product demos
- AI-generated microsites with optional live research context
- more agentic, preference-aware interface generation

The long-term direction is a platform that can generate personalized apps and interfaces based on user goals, preferences, and context.

## Hackathon Positioning

This project is designed to demonstrate:

- strong Mistral integration
- clear use of Mistral Agents and Codestral in one product flow
- practical value from research-supported generation
- effective ElevenLabs integration beyond simple text-to-speech
- a clear user-experience improvement
- a lightweight but polished full-stack implementation
- a memorable demo that is easy to understand quickly

## License

This repository is released as **All Rights Reserved** unless explicitly agreed otherwise in writing.
See [LICENSE](LICENSE).
