const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const generatedAppScreen = document.getElementById("generatedAppScreen");
const startBtn = document.getElementById("startBtn");
const userNameInput = document.getElementById("userName");
const promptEditorArea = document.getElementById("promptEditor");
const modeBadge = document.getElementById("modeBadge");
const modeDescription = document.getElementById("modeDescription");
const modeToggleBtn = document.getElementById("modeToggleBtn");
const audioBadge = document.getElementById("audioBadge");
const audioToggleBtn = document.getElementById("audioToggleBtn");
const landingIntroAudio = document.getElementById("landingIntroAudio");

const matrixCanvas = document.getElementById("matrixCanvas");
const matrixCtx = matrixCanvas ? matrixCanvas.getContext("2d", { alpha: false }) : null;

// Start Screen Canvas
const startCanvas = document.getElementById("startCanvas");
const startCtx = startCanvas ? startCanvas.getContext("2d", { alpha: false }) : null;

const scoreVal = document.getElementById("scoreVal");
const livesVal = document.getElementById("livesVal");
const pauseBtn = document.getElementById("pauseBtn");
const backToStartBtn = document.getElementById("backToStartBtn");
const gameOverScreen = document.getElementById("gameOverScreen");
const gameStartScreen = document.getElementById("gameStartScreen");
const startLevelBtn = document.getElementById("startLevelBtn");
const restartBtn = document.getElementById("restartBtn");
const transcriptText = document.getElementById("transcriptText");
const audioStatus = document.getElementById("audioStatus");
const buildState = document.getElementById("buildState");
const activitySummary = document.getElementById("activitySummary");
const activityItems = Array.from(document.querySelectorAll(".agent-activity-item"));
const audioEl = document.getElementById("podcastAudio");
const appReadyBar = document.getElementById("appReadyBar");
const appReadyText = document.getElementById("appReadyText");
const openGeneratedAppBtn = document.getElementById("openGeneratedAppBtn");
const generatedAppFrame = document.getElementById("generatedAppFrame");
const generatedAppTitle = document.getElementById("generatedAppTitle");
const generatedAppSummary = document.getElementById("generatedAppSummary");
const generatedAppHistory = document.getElementById("generatedAppHistory");
const generatedAppHistoryList = document.getElementById("generatedAppHistoryList");
const generatedBackToStartBtn = document.getElementById("generatedBackToStartBtn");
const backToGameBtn = document.getElementById("backToGameBtn");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const DEFAULT_GENERATED_APP_FRAME_HEIGHT = 960;
let lastGeneratedAppFrameHeight = DEFAULT_GENERATED_APP_FRAME_HEIGHT;
let audioContext = null;
let ambientGainNode = null;
let ambientOscillators = [];
let audioUnlocked = false;
let activeSpeechUtterance = null;
let generatedAppHistoryItems = [];

if (landingIntroAudio) {
    landingIntroAudio.volume = 0.72;
}

if (ctx) {
    ctx.imageSmoothingEnabled = false;
}

const defaultCodeSnippets = [
    '<div class="flex flex-col items-center justify-center min-h-screen bg-slate-900">',
    '  <header class="w-full p-6 border-b border-slate-700">',
    '    <h1 class="text-3xl font-bold text-orange-500">Generated App Title</h1>',
    "  </header>",
    '  <main data-controller="mistral-agent" class="container mx-auto mt-10">',
    "    <!-- Agent thinking... injecting dynamic components -->",
    '    <section class="grid grid-cols-1 md:grid-cols-3 gap-6">',
    '       <article class="p-4 bg-slate-800 rounded-lg shadow-xl">',
    '           <h2 class="text-xl text-white">Feature Module A</h2>',
    '           <p class="text-slate-400">Podcast script and game state loading...</p>',
    "       </article>",
    "    </section>",
    "  </main>",
    "</div>",
];

let matrixInterval = null;
let currentCodeSnippets = [...defaultCodeSnippets];
let matrixDrops = [];
let matrixFontSize = 14;
let matrixColumns = 0;
let isStarting = false;
const defaultStartLabel = startBtn ? startBtn.innerHTML : "Generate and Play";
const DEFAULT_USER_NAME = "Adam";
const DEFAULT_TOPIC = "AI Game Companion";
const DEFAULT_AUDIO_ERROR = "Audio generation failed.";
const AUDIO_PROVIDER_STORAGE_KEY = "mistral-wait:audio-provider";
const LANDING_INTRO_TEXT =
    "Welcome to Mistral Wait Companion. Your build can now turn waiting time into a live playable experience.";
const BUILD_MODES = {
    stage: {
        label: "Stage Mode",
        description: "Fast, polished, hackathon-safe output for demos and reliable live runs.",
        activityLabel: "Stage builder is assembling the polished demo app.",
        audioDetail: "Podcast audio is streaming in while the stage-ready app stays on a reliable path.",
    },
    builder: {
        label: "Builder Mode",
        description:
            "Experimental autonomous builds with optional web research for simple apps, games, and microsites.",
        activityLabel: "Builder mode is exploring a broader app pass with optional web research.",
        audioDetail: "Podcast audio is streaming while the builder agent explores a richer app pass.",
    },
};
let activeBuildMode = "stage";
const AUDIO_PROVIDERS = {
    local: {
        label: "Local Audio",
        description: "Browser speech for intro and podcast, with instant local game sound effects.",
    },
    elevenlabs: {
        label: "ElevenLabs",
        description: "Generated voice for the intro and podcast, with local game sound effects kept responsive.",
    },
};
let activeAudioProvider = window.localStorage.getItem(AUDIO_PROVIDER_STORAGE_KEY) || "local";
let hasAttemptedLandingIntro = false;
let landingIntroRetryBound = false;

function getActiveModeConfig() {
    return BUILD_MODES[activeBuildMode] || BUILD_MODES.stage;
}

function getActiveAudioConfig() {
    return AUDIO_PROVIDERS[activeAudioProvider] || AUDIO_PROVIDERS.local;
}

function syncBuildModeUi() {
    const modeConfig = getActiveModeConfig();
    const audioConfig = getActiveAudioConfig();
    modeBadge.innerText = modeConfig.label;
    modeDescription.innerText = `${modeConfig.description} ${audioConfig.description}`;
    if (modeToggleBtn) {
        modeToggleBtn.dataset.mode = activeBuildMode;
        modeToggleBtn.setAttribute("aria-pressed", String(activeBuildMode === "builder"));
    }
}

function syncAudioProviderUi() {
    const audioConfig = getActiveAudioConfig();
    if (audioBadge) {
        audioBadge.innerText = audioConfig.label;
    }
    if (audioToggleBtn) {
        audioToggleBtn.dataset.mode = activeAudioProvider;
        audioToggleBtn.setAttribute("aria-pressed", String(activeAudioProvider === "elevenlabs"));
    }
    syncBuildModeUi();
}

function setStartButtonState(isBusy) {
    startBtn.disabled = isBusy;
    startBtn.innerHTML = isBusy ? "Starting..." : defaultStartLabel;
}

function ensureAudioContext() {
    if (!window.AudioContext && !window.webkitAudioContext) {
        return null;
    }

    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => null);
    }

    return audioContext;
}

function unlockAudio() {
    const context = ensureAudioContext();
    if (!context) {
        return;
    }
    audioUnlocked = true;
}

function createEnvelopeGain(context, volume, duration) {
    const gainNode = context.createGain();
    const now = context.currentTime;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gainNode.connect(context.destination);
    return gainNode;
}

function playTone({ frequency, type = "sine", duration = 0.18, volume = 0.05, glideTo = null }) {
    const context = ensureAudioContext();
    if (!context || !audioUnlocked) {
        return;
    }

    const oscillator = context.createOscillator();
    const gainNode = createEnvelopeGain(context, volume, duration);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (glideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(glideTo, context.currentTime + duration);
    }
    oscillator.connect(gainNode);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
}

function startAmbientLoop() {
    const context = ensureAudioContext();
    if (!context || !audioUnlocked || ambientOscillators.length > 0) {
        return;
    }

    ambientGainNode = context.createGain();
    ambientGainNode.gain.setValueAtTime(0.0001, context.currentTime);
    ambientGainNode.gain.linearRampToValueAtTime(0.022, context.currentTime + 0.6);
    ambientGainNode.connect(context.destination);

    const frequencies = [110, 165];
    ambientOscillators = frequencies.map((frequency, index) => {
        const oscillator = context.createOscillator();
        const filter = context.createBiquadFilter();
        oscillator.type = index === 0 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, context.currentTime);
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(index === 0 ? 260 : 420, context.currentTime);
        oscillator.connect(filter);
        filter.connect(ambientGainNode);
        oscillator.start();
        return oscillator;
    });
}

function stopAmbientLoop() {
    if (!audioContext || ambientOscillators.length === 0) {
        return;
    }

    const now = audioContext.currentTime;
    if (ambientGainNode) {
        ambientGainNode.gain.cancelScheduledValues(now);
        ambientGainNode.gain.setValueAtTime(Math.max(ambientGainNode.gain.value, 0.0001), now);
        ambientGainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    }

    for (const oscillator of ambientOscillators) {
        try {
            oscillator.stop(now + 0.22);
        } catch {
            // ignore duplicate stop attempts
        }
    }

    ambientOscillators = [];
    ambientGainNode = null;
}

function playLocalJumpSfx() {
    playTone({ frequency: 420, type: "square", duration: 0.12, volume: 0.03, glideTo: 620 });
}

function playLocalCoinSfx() {
    playTone({ frequency: 740, type: "triangle", duration: 0.16, volume: 0.05, glideTo: 1040 });
    window.setTimeout(() => {
        playTone({ frequency: 980, type: "triangle", duration: 0.12, volume: 0.04, glideTo: 1320 });
    }, 40);
}

function playLocalHitSfx() {
    playTone({ frequency: 180, type: "sawtooth", duration: 0.22, volume: 0.055, glideTo: 90 });
}

function playLocalReadySfx() {
    playTone({ frequency: 520, type: "triangle", duration: 0.16, volume: 0.04, glideTo: 720 });
    window.setTimeout(() => {
        playTone({ frequency: 780, type: "triangle", duration: 0.18, volume: 0.045, glideTo: 980 });
    }, 70);
}

function playJumpSfx() {
    playLocalJumpSfx();
}

function playCoinSfx() {
    playLocalCoinSfx();
}

function playHitSfx() {
    playLocalHitSfx();
}

function playReadySfx() {
    playLocalReadySfx();
}

function setAudioMessage(message) {
    audioStatus.innerText = message;
}

function setActivityStep(stepKey, status, detail) {
    const item = activityItems.find((entry) => entry.dataset.step === stepKey);
    if (!item) {
        return;
    }

    item.dataset.status = status;
    const detailNode = item.querySelector(".agent-activity-detail");
    if (detailNode && detail) {
        detailNode.innerText = detail;
    }
}

function resetActivityCard() {
    buildState.innerText = "BOOTING";
    activitySummary.innerText = "Initializing wait companion runtime.";
    setActivityStep("prompt", "active", "Parsing the incoming build request.");
    setActivityStep("podcast", "idle", "Preparing the spoken intro.");
    setActivityStep("audio", "idle", "Waiting for playback data.");
    setActivityStep("app", "idle", "Compiling the generated app.");
}

function setBuildProgress(state, detail, stepKey, status = "active") {
    buildState.innerText = state;
    activitySummary.innerText = detail;
    if (stepKey) {
        setActivityStep(stepKey, status, detail);
    }
}

function resetAudioPlayback() {
    stopLocalSpeech();
    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.removeAttribute("src");
    audioEl.load();
    audioEl.classList.add("hidden");
}

function revealAudioPlayer() {
    audioEl.classList.remove("hidden");
}

function speakTextLocally(text, statusMessage, detailMessage) {
    stopLocalSpeech();
    audioEl.classList.add("hidden");
    setAudioMessage(statusMessage);
    setBuildProgress("LIVE", detailMessage, "audio", "done");

    if (!("speechSynthesis" in window) || !text) {
        setAudioMessage("Local speech playback is not available in this browser.");
        setActivityStep("audio", "error", "Browser speech synthesis is unavailable.");
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 0.92;
    utterance.onend = () => {
        if (activeSpeechUtterance === utterance) {
            activeSpeechUtterance = null;
        }
    };
    utterance.onerror = () => {
        if (activeSpeechUtterance === utterance) {
            activeSpeechUtterance = null;
        }
        setAudioMessage("Local speech playback failed.");
        setActivityStep("audio", "error", "Browser speech synthesis failed.");
    };

    activeSpeechUtterance = utterance;
    window.speechSynthesis.speak(utterance);
}

function stopLandingIntroAudio() {
    if (!landingIntroAudio) {
        return;
    }

    landingIntroAudio.pause();
    landingIntroAudio.currentTime = 0;
}

function stopLocalSpeech() {
    if (!("speechSynthesis" in window)) {
        activeSpeechUtterance = null;
        return;
    }

    window.speechSynthesis.cancel();
    activeSpeechUtterance = null;
}

function resetGeneratedAppState() {
    appReadyBar.classList.add("hidden");
    appReadyText.innerText = "Your generated app is ready to open.";
    openGeneratedAppBtn.dataset.appUrl = "";
    generatedAppTitle.innerText = "Generated Hackathon App";
    generatedAppSummary.innerText = "The generated experience is ready to review.";
    generatedAppHistoryItems = [];
    renderGeneratedAppHistory();
    generatedAppFrame.removeAttribute("src");
    const cappedDefaultHeight = getGeneratedAppFrameMaxHeight(DEFAULT_GENERATED_APP_FRAME_HEIGHT);
    generatedAppFrame.style.height = `${cappedDefaultHeight}px`;
    lastGeneratedAppFrameHeight = cappedDefaultHeight;
    generatedAppScreen.classList.add("hidden");
}

function getGeneratedAppFrameMaxHeight(preferredHeight = DEFAULT_GENERATED_APP_FRAME_HEIGHT) {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || preferredHeight;
    const frameTop = generatedAppFrame ? generatedAppFrame.getBoundingClientRect().top : 0;
    const availableHeight = Math.floor(viewportHeight - Math.max(frameTop, 24) - 24);
    const safeMaxHeight = Math.max(520, availableHeight);
    return Math.min(preferredHeight, safeMaxHeight);
}

function formatHistoryAgeLabel(ageSecondsValue) {
    const ageSeconds = Number(ageSecondsValue);
    if (!Number.isFinite(ageSeconds) || ageSeconds < 60) {
        return "just now";
    }

    const ageMinutes = Math.max(1, Math.floor(ageSeconds / 60));
    return `${ageMinutes} min ago`;
}

function renderGeneratedAppHistory() {
    if (!generatedAppHistory || !generatedAppHistoryList) {
        return;
    }

    if (!generatedAppHistoryItems.length) {
        generatedAppHistory.classList.add("hidden");
        generatedAppHistoryList.innerHTML = "";
        return;
    }

    generatedAppHistory.classList.remove("hidden");
    generatedAppHistoryList.innerHTML = "";

    generatedAppHistoryItems.forEach((item) => {
        const entry = document.createElement("button");
        entry.className = "generated-history-item";
        entry.type = "button";
        entry.dataset.appUrl = item.app_url || "";

        const copy = document.createElement("span");
        copy.className = "generated-history-copy";

        const title = document.createElement("span");
        title.className = "generated-history-title";
        title.innerText = item.title || "Generated Hackathon App";

        const meta = document.createElement("span");
        meta.className = "generated-history-meta";
        meta.innerText = `${item.mode || "stage"} • ${formatHistoryAgeLabel(item.age_seconds)}`;

        const openLabel = document.createElement("span");
        openLabel.className = "generated-history-open";
        openLabel.innerText = "Open";
        meta.innerText = `${item.mode || "stage"} | ${formatHistoryAgeLabel(item.age_seconds)}`;

        copy.append(title, meta);
        entry.append(copy, openLabel);
        generatedAppHistoryList.appendChild(entry);

        entry.addEventListener("click", () => {
            const appUrl = entry.dataset.appUrl;
            if (!appUrl) {
                return;
            }

            openGeneratedAppPreview(
                appUrl,
                item.title || "Generated Hackathon App",
                item.summary || "The generated experience is ready to review."
            );
        });
    });
}

function setGeneratedAppReady(appData) {
    openGeneratedAppBtn.dataset.appUrl = appData.app_url;
    generatedAppTitle.innerText = appData.title;
    generatedAppSummary.innerText = appData.summary;
    generatedAppHistoryItems = Array.isArray(appData.history) ? appData.history : [];
    renderGeneratedAppHistory();
    appReadyText.innerText = appData.used_fallback
        ? `Build complete with a safe ${appData.mode || "stage"} fallback. Open the preview to inspect it.`
        : "Build complete. Open the generated app preview.";
    appReadyBar.classList.remove("hidden");
    setActivityStep(
        "app",
        appData.used_fallback ? "error" : "done",
        appData.used_fallback
            ? "Builder agent fell back to a safe one-page app. Check backend/model output."
            : appData.summary
    );
    activitySummary.innerText = appData.used_fallback
        ? "The requested app mode was selected, but generation fell back to the safe HTML template."
        : "The generated app is ready to open in a dedicated preview overlay.";
    playReadySfx();
}

function openGeneratedAppPreview(appUrl, title = "", summary = "") {
    if (!appUrl) {
        return;
    }

    if (title) {
        generatedAppTitle.innerText = title;
    }
    if (summary) {
        generatedAppSummary.innerText = summary;
    }

    openGeneratedAppBtn.dataset.appUrl = appUrl;
    generatedAppFrame.src = `${appUrl}?t=${Date.now()}`;
}

function getBuildRequest() {
    const topicSource = window.easymde ? window.easymde.value() : promptEditorArea.value;
    return {
        name: userNameInput.value.trim() || DEFAULT_USER_NAME,
        topic: topicSource.trim() || DEFAULT_TOPIC,
        mode: activeBuildMode,
    };
}

function stopHackerMatrix() {
    if (matrixInterval) {
        clearInterval(matrixInterval);
        matrixInterval = null;
    }
}

function setMatrixCode(seedCode) {
    if (!seedCode) {
        currentCodeSnippets = [...defaultCodeSnippets];
        return;
    }

    currentCodeSnippets = seedCode
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean);
}

function startHackerMatrix() {
    stopHackerMatrix();
    matrixCode.textContent = "<!-- INITIALIZING WAIT COMPANION -->\n\n";
    matrixInterval = window.setInterval(() => {
        const randomLine =
            currentCodeSnippets[Math.floor(Math.random() * currentCodeSnippets.length)];
        matrixCode.textContent += `${randomLine}\n`;
        if (matrixCode.textContent.length > 2500) {
            matrixCode.textContent = matrixCode.textContent.substring(500);
        }
    }, 150);
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${url} failed (${response.status}): ${errorText}`);
    }

    return response.json();
}

function buildCacheSafeAudioUrl(audioUrl) {
    return `${audioUrl}${audioUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

async function playAudioElement(audioNode, audioUrl, { resetTime = true } = {}) {
    audioNode.src = buildCacheSafeAudioUrl(audioUrl);
    if (resetTime) {
        audioNode.currentTime = 0;
    }
    await audioNode.play();
}

async function playAudioFromUrl(audioUrl, statusMessage, detailMessage) {
    revealAudioPlayer();
    setAudioMessage(statusMessage);
    setBuildProgress("LIVE", detailMessage, "audio", "done");

    try {
        await playAudioElement(audioEl, audioUrl);
    } catch (error) {
        console.error("Audio playback failed:", error);
        setAudioMessage("Audio ready. Click play if autoplay is blocked.");
        setActivityStep("audio", "active", "Playback ready. Waiting for manual start.");
    }
}

async function requestGeneratedAudio(script, namespace, provider = activeAudioProvider) {
    const normalizedProvider = provider === "elevenlabs" ? "elevenlabs" : "local";
    return postJson("/api/generate_audio", {
        script,
        provider: normalizedProvider,
        namespace,
    });
}

async function maybePlayLandingIntro({ force = false } = {}) {
    if ((activeAudioProvider === "elevenlabs" && !landingIntroAudio) || (hasAttemptedLandingIntro && !force)) {
        return;
    }

    hasAttemptedLandingIntro = true;

    if (activeAudioProvider === "local") {
        speakTextLocally(
            LANDING_INTRO_TEXT,
            "Playing local intro narration...",
            "Local browser speech is introducing the wait companion."
        );
        return;
    }

    try {
        const introAudio = await requestGeneratedAudio(LANDING_INTRO_TEXT, "intro", activeAudioProvider);
        if (!introAudio.audio_url) {
            return;
        }
        await playAudioElement(landingIntroAudio, introAudio.audio_url);
    } catch (error) {
        console.error("Landing intro playback failed:", error);
        if (!landingIntroRetryBound) {
            landingIntroRetryBound = true;
            const retryIntroPlayback = () => {
                if (!document.hidden && !startScreen.classList.contains("hidden")) {
                    maybePlayLandingIntro({ force: true }).catch(() => null);
                }
            };

            window.addEventListener("pointerdown", retryIntroPlayback, { once: true });
            window.addEventListener("keydown", retryIntroPlayback, { once: true });
        }
    }
}

const startGameFlow = async () => {
    if (isStarting) {
        return;
    }

    isStarting = true;
    setStartButtonState(true);
    unlockAudio();
    startAmbientLoop();
    stopLandingIntroAudio();

    const { name, topic, mode } = getBuildRequest();
    const modeConfig = BUILD_MODES[mode] || BUILD_MODES.stage;

    startScreen.classList.add("hidden");
    stopStartCanvasAnimation();
    gameScreen.classList.remove("hidden");

    resetAudioPlayback();
    resetGeneratedAppState();
    resetActivityCard();
    setAudioMessage("Audio status: waiting for script...");
    setMatrixCode();
    startHackerMatrix();
    setBuildProgress("BOOTING", "Initializing wait companion runtime.", "prompt", "active");
    initGame();

    try {
        setBuildProgress(
            "RESEARCH",
            "Collecting prompt context and preparing the live podcast script.",
            "podcast",
            "active"
        );
        const textData = await postJson("/api/generate_text", {
            user_name: name,
            topic,
            mode,
        });

        transcriptText.innerText = textData.script || "No script returned.";
        setMatrixCode(textData.dummy_code);
        setAudioMessage("Generating audio...");
        setActivityStep("prompt", "done", "Prompt received and handed to the active agents.");
        setActivityStep("podcast", "done", "Podcast script ready and loaded into the transcript.");
        setBuildProgress(
            "SYNTH",
            "Converting the script into audio while the wait screen stays interactive.",
            "audio",
            "active"
        );
        setActivityStep("app", "active", modeConfig.activityLabel);

        const appPromise = postJson("/api/generate_app", {
            user_name: name,
            topic,
            script: textData.script,
            mode,
        });

        appPromise
            .then((appData) => {
                if (appData.app_url) {
                    setGeneratedAppReady(appData);
                }
            })
            .catch((appError) => {
                console.error("App generation failed:", appError);
                setActivityStep("app", "error", "App generation failed. Retry with a simpler prompt.");
            });

        if (activeAudioProvider === "local") {
            speakTextLocally(
                textData.script,
                "Playing local speech narration...",
                "Browser speech synthesis is narrating the live podcast without storing audio files."
            );
        } else {
            const audioData = await requestGeneratedAudio(textData.script, "podcast", activeAudioProvider);

            if (audioData.audio_url) {
                await playAudioFromUrl(
                    audioData.audio_url,
                    "Streaming generated audio...",
                    modeConfig.audioDetail
                );
            } else {
                setAudioMessage("Audio generation finished without a playable file.");
                revealAudioPlayer();
                setBuildProgress(
                    "PARTIAL",
                    "Audio playback needs manual fallback, but the wait companion is still active.",
                    "audio",
                    "active"
                );
            }
        }

        await appPromise.catch(() => null);
    } catch (error) {
        console.error("Backend request failed:", error);
        transcriptText.innerText = "Error connecting to the backend.";
        setAudioMessage(DEFAULT_AUDIO_ERROR);
        revealAudioPlayer();
        buildState.innerText = "ERROR";
        activitySummary.innerText = "Check the backend service and retry the build session.";
        setActivityStep("podcast", "error", "Podcast agent unavailable.");
        setActivityStep("audio", "error", "Audio pipeline unavailable.");
        setActivityStep("app", "error", "App builder unavailable.");
    } finally {
        isStarting = false;
        setStartButtonState(false);
    }
};

startBtn.addEventListener("click", startGameFlow);

if (modeToggleBtn) {
    modeToggleBtn.addEventListener("click", () => {
        activeBuildMode = activeBuildMode === "stage" ? "builder" : "stage";
        syncBuildModeUi();
    });
}

if (audioToggleBtn) {
    audioToggleBtn.addEventListener("click", () => {
        stopLandingIntroAudio();
        stopLocalSpeech();
        activeAudioProvider = activeAudioProvider === "local" ? "elevenlabs" : "local";
        window.localStorage.setItem(AUDIO_PROVIDER_STORAGE_KEY, activeAudioProvider);
        syncAudioProviderUi();

        if (!startScreen.classList.contains("hidden")) {
            maybePlayLandingIntro({ force: true }).catch(() => null);
        }
    });
}

openGeneratedAppBtn.addEventListener("click", () => {
    const appUrl = openGeneratedAppBtn.dataset.appUrl;
    if (!appUrl) {
        return;
    }

    isPaused = true;
    pauseBtn.innerText = "RESUME";
    stopAmbientLoop();
    openGeneratedAppPreview(appUrl);
    gameScreen.classList.add("hidden");
    generatedAppScreen.classList.remove("hidden");
});

backToGameBtn.addEventListener("click", () => {
    generatedAppScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    startAmbientLoop();
});

window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) {
        return;
    }

    if (message.type !== "mistral-generated-app-height") {
        return;
    }

    const nextHeight = Number(message.height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
        return;
    }

    const requestedHeight = Math.max(720, Math.ceil(nextHeight) + 12);
    const targetHeight = getGeneratedAppFrameMaxHeight(requestedHeight);
    if (Math.abs(targetHeight - lastGeneratedAppFrameHeight) < 4) {
        return;
    }

    lastGeneratedAppFrameHeight = targetHeight;
    generatedAppFrame.style.height = `${targetHeight}px`;
});

window.addEventListener("resize", () => {
    if (generatedAppScreen.classList.contains("hidden")) {
        return;
    }

    const cappedHeight = getGeneratedAppFrameMaxHeight(lastGeneratedAppFrameHeight);
    if (Math.abs(cappedHeight - lastGeneratedAppFrameHeight) < 4) {
        return;
    }

    lastGeneratedAppFrameHeight = cappedHeight;
    generatedAppFrame.style.height = `${cappedHeight}px`;
});

let score = 0;
let coins = 0;
let lives = 7;
let isPaused = false;
let isJumping = false;
let playerY = 200;
let playerVY = 0;
const floorY = 240;
const playerSize = 60;
let obstacles = [];
let collectibles = [];
let gameLoopId;
let isInvulnerable = false;
let hasLevelStarted = false;
let speedBoostTimer = 0;
let animationTick = 0;
let timeDilation = 1.0;
let invulnerabilityTimer = 0;
let spawnCooldown = 0;
let lastFrameTime = 0;
let playerForwardOffset = 0;
let particles = [];
let shakeTimer = 0;
let wasGroundedLastFrame = true;

const gravity = 2200;
const normalJumpVelocity = -780;
const boostedJumpVelocity = -920;
const baseWorldSpeed = 180;
const maxFrameDeltaMs = 40;
const baseSpawnInterval = 1.45;
const minSpawnInterval = 0.78;
const powerupDuration = 4.5;
const invulnerabilityDuration = 1.15;
const slowdownFloor = 0.45;
const slowdownRecoveryPerSecond = 0.85;
const maxForwardOffset = 30;
const forwardOffsetResponse = 10;
const screenShakeDuration = 0.2;

const HACKATHON_SPONSORS = [
    "Mistral AI", "AWS", "NVIDIA", "Hugging Face",
    "Weights & Biases", "ElevenLabs", "Supercell",
    "Tilde Research", "Giant", "Raise", "White Circle",
    "Jump Trading"
];

const HACKATHON_CITIES = [
    "SAN FRANCISCO", "NEW YORK", "LONDON", "PARIS",
    "TOKYO", "SINGAPORE", "SYDNEY", "ONLINE"
];

// Generate an endless array of varied buildings for the background
const bgBuildings = Array.from({ length: 40 }, () => ({
    width: 20 + Math.random() * 60,
    height: 60 + Math.random() * 120,
    hasAntenna: Math.random() > 0.7,
    windows: Math.random() > 0.4 ? Array.from({ length: Math.floor(Math.random() * 8) + 2 }, () => ({
        wx: Math.random(),
        wy: Math.random(),
        on: Math.random() > 0.3
    })) : []
}));

// Generate structured foreground billboards
const bgBillboards = Array.from({ length: 30 }, (_, index) => {
    const isSponsor = index % 2 === 0;
    const text = isSponsor
        ? HACKATHON_SPONSORS[Math.floor(Math.random() * HACKATHON_SPONSORS.length)]
        : HACKATHON_CITIES[Math.floor(Math.random() * HACKATHON_CITIES.length)];

    let color = isSponsor ? "#f97316" : "#ec4899"; // Default: Orange for sponsors, Pink for cities
    let subtext = isSponsor ? "PARTNER" : "LOCATION";
    let isHighlighted = false;

    // Highlight our integrated partners & their awards
    if (text === "ElevenLabs") {
        color = "#22d3ee"; // Bright Cyan
        const elevenAwards = ["BEST AUDIO USE", "BEST VOICE USE CASE"];
        subtext = elevenAwards[Math.floor(Math.random() * elevenAwards.length)];
        isHighlighted = true;
    } else if (text === "Supercell") {
        color = "#22d3ee"; // Bright Cyan
        const superAwards = ["BEST VIDEO GAME", "INNOVATION LAB"];
        subtext = superAwards[Math.floor(Math.random() * superAwards.length)];
        isHighlighted = true;
    } else if (text === "Mistral AI") {
        color = "#eab308"; // Gold
        subtext = "GLOBAL WINNER";
    }

    return {
        width: 140 + text.length * 8 + (isHighlighted ? 40 : 0), // wider for highlighted subtexts
        height: 40 + Math.random() * 30 + (isHighlighted ? 10 : 0), // taller for highlighted subtexts
        text: text,
        color: color,
        subtext: subtext,
        poleOffset: 10 + Math.random() * 30,
        xBaseOffset: index * 280 + Math.random() * 100 // Space them out
    };
});

const backgroundState = {
    farOffset: 0,
    midOffset: 0,
    nearOffset: 0,
    stars: Array.from({ length: 25 }, (_, index) => ({
        x: Math.random() * 1200,
        y: Math.random() * 180,
        size: index % 3 === 0 ? 2 : 1,
        alpha: 0.25 + Math.random() * 0.5,
    })),
    buildings: bgBuildings,
    billboards: bgBillboards,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function updateHud() {
    scoreVal.innerText = score;
    livesVal.innerText = lives;
}

function spawnDustBurst(x, y) {
    for (let index = 0; index < 5; index += 1) {
        particles.push({
            kind: "dust",
            x,
            y,
            vx: -50 + Math.random() * 100,
            vy: -30 - Math.random() * 70,
            life: 0.28 + Math.random() * 0.16,
            maxLife: 0.44,
            size: 3 + Math.random() * 4,
            color: "255,255,255",
        });
    }
}

function spawnCoinBurst(x, y) {
    for (let index = 0; index < 10; index += 1) {
        const angle = (Math.PI * 2 * index) / 10 + Math.random() * 0.35;
        const speed = 80 + Math.random() * 120;
        particles.push({
            kind: "spark",
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 30,
            life: 0.32 + Math.random() * 0.24,
            maxLife: 0.54,
            size: 3 + Math.random() * 3,
            color: index % 2 === 0 ? "236,72,153" : "103,232,249",
        });
    }
}

function updateParticles(deltaSeconds) {
    particles = particles.filter((particle) => {
        particle.life -= deltaSeconds;
        if (particle.life <= 0) {
            return false;
        }

        particle.x += particle.vx * deltaSeconds;
        particle.y += particle.vy * deltaSeconds;
        particle.vy += particle.kind === "dust" ? 180 * deltaSeconds : 260 * deltaSeconds;
        particle.vx *= particle.kind === "dust" ? 0.9 : 0.98;
        return true;
    });
}

function drawParticles() {
    for (const particle of particles) {
        const alpha = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = particle.kind === "spark" ? "lighter" : "source-over";
        ctx.fillStyle = `rgba(${particle.color}, ${alpha * (particle.kind === "spark" ? 0.95 : 0.42)})`;
        if (particle.kind === "spark") {
            ctx.fillRect(
                Math.round(particle.x),
                Math.round(particle.y),
                Math.max(2, Math.round(particle.size)),
                Math.max(2, Math.round(particle.size))
            );
        } else {
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function drawParallaxBackground(worldSpeed, deltaSeconds) {
    backgroundState.farOffset = (backgroundState.farOffset + worldSpeed * 0.04 * deltaSeconds);
    backgroundState.midOffset = (backgroundState.midOffset + worldSpeed * 0.18 * deltaSeconds);
    backgroundState.nearOffset = (backgroundState.nearOffset + worldSpeed * 0.45 * deltaSeconds);

    const gradient = ctx.createLinearGradient(0, 0, 0, floorY);
    // Dark cyberpunk night sky
    gradient.addColorStop(0, "#02040a");
    gradient.addColorStop(0.6, "#0f172a");
    gradient.addColorStop(1, "#1e1b4b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, floorY);

    // Render twinkling stars
    for (const star of backgroundState.stars) {
        const twinkle = 0.5 + Math.sin((animationTick * 2 + star.x)) * 0.5;
        // Make stars loop locally relative to screen instead of scrolling to save computation
        const sx = (star.x - backgroundState.farOffset * 0.1) % canvas.width;
        const drawX = sx < 0 ? canvas.width + sx : sx;

        ctx.fillStyle = `rgba(139, 92, 246, ${star.alpha * twinkle})`; // Purple tint stars
        ctx.fillRect(drawX, star.y, Math.max(1, star.size), Math.max(1, star.size));
    }

    // LAYER 1: Far mountains/distant skyline
    const farBaseY = floorY - 140;
    ctx.fillStyle = "#0c1222";
    let distDrawX = -(backgroundState.farOffset % 400);
    while (distDrawX < canvas.width) {
        ctx.beginPath();
        ctx.moveTo(distDrawX, floorY);
        ctx.lineTo(distDrawX + 60, farBaseY);
        ctx.lineTo(distDrawX + 120, farBaseY + 60);
        ctx.lineTo(distDrawX + 180, farBaseY - 20);
        ctx.lineTo(distDrawX + 280, farBaseY + 70);
        ctx.lineTo(distDrawX + 400, floorY);
        ctx.closePath();
        ctx.fill();
        distDrawX += 400; // repeating mountain sequence
    }

    // LAYER 2: Mid-ground Dense City Skyline
    const midBaseY = floorY;
    ctx.fillStyle = "#161d36"; // Dark slate blue
    const totalMidWidth = backgroundState.buildings.reduce((sum, b) => sum + b.width + 10, 0);

    // Draw buildings, repeating over the total building array width
    ctx.save();
    let currentMidX = -(backgroundState.midOffset % totalMidWidth);

    // We draw the block twice or three times to cover the screen seamlessly
    for (let loop = 0; loop < 3; loop++) {
        let bx = currentMidX;
        for (const building of backgroundState.buildings) {
            if (bx > canvas.width) break; // Optimization
            if (bx + building.width > 0) {
                // Draw main building block
                ctx.fillStyle = "#161d36";
                ctx.fillRect(Math.floor(bx), midBaseY - building.height, Math.floor(building.width), Math.floor(building.height));

                // Draw roof antenna
                if (building.hasAntenna) {
                    ctx.fillStyle = "#1e293b";
                    ctx.fillRect(Math.floor(bx + building.width / 2 - 1), midBaseY - building.height - 25, 2, 25);
                    // Blinking red beacon
                    if (Math.sin(animationTick * 4 + bx) > 0) {
                        ctx.fillStyle = "#ef4444";
                        ctx.fillRect(Math.floor(bx + building.width / 2 - 1.5), midBaseY - building.height - 27, 3, 3);
                    }
                }

                // Draw illuminated windows
                ctx.fillStyle = "rgba(253, 186, 116, 0.4)"; // Warm indoor light
                for (const win of building.windows) {
                    if (win.on) {
                        const winX = bx + 4 + win.wx * (building.width - 12);
                        const winY = (midBaseY - building.height + 10) + win.wy * (building.height - 20);
                        ctx.fillRect(Math.floor(winX), Math.floor(winY), 3, 4);
                    }
                }
            }
            bx += building.width + 10; // gap between buildings
        }
        currentMidX += totalMidWidth;
    }
    ctx.restore();

    // LAYER 3: Foreground Neon Hackathon Billboards
    const totalNearWidth = backgroundState.billboards[backgroundState.billboards.length - 1].xBaseOffset + 400;
    let currentNearX = -(backgroundState.nearOffset % totalNearWidth);

    ctx.save();
    // Use proper pixel font
    ctx.font = '10px "Press Start 2P"';
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let loop = 0; loop < 2; loop++) {
        for (const board of backgroundState.billboards) {
            const boardX = currentNearX + board.xBaseOffset;
            if (boardX > canvas.width) continue;
            if (boardX + board.width < 0) continue;

            const boardY = floorY - board.poleOffset - board.height;

            // Draw poles
            ctx.fillStyle = "#334155";
            ctx.fillRect(Math.floor(boardX + 10), Math.floor(boardY + board.height), 4, board.poleOffset);
            ctx.fillRect(Math.floor(boardX + board.width - 14), Math.floor(boardY + board.height), 4, board.poleOffset);

            // Draw Billboard background
            ctx.fillStyle = "#0c0a09"; // Very dark backing
            ctx.fillRect(Math.floor(boardX), Math.floor(boardY), Math.floor(board.width), Math.floor(board.height));

            // Draw Neon border (glow effect)
            ctx.shadowColor = board.color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = board.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(Math.floor(boardX), Math.floor(boardY), Math.floor(board.width), Math.floor(board.height));

            // Draw Text
            ctx.shadowBlur = 0;
            ctx.fillStyle = board.color;
            // Draw main text (Sponsor/City)
            ctx.fillText(board.text, boardX + board.width / 2, boardY + board.height / 2 + 2);

            // Draw subtext
            ctx.font = '6px "Press Start 2P"';
            ctx.fillStyle = "#64748b";
            ctx.fillText(board.subtext, boardX + board.width / 2, boardY + board.height / 2 - 12);

            ctx.font = '10px "Press Start 2P"'; // restore font
        }
        currentNearX += totalNearWidth;
    }
    ctx.restore();
}

function getJumpVelocity() {
    return speedBoostTimer > 0 ? boostedJumpVelocity : normalJumpVelocity;
}

function getDifficultyFactor() {
    return clamp(score / 900, 0, 1);
}

function getWorldSpeed() {
    const difficultyBoost = getDifficultyFactor() * 90;
    const powerupEase = speedBoostTimer > 0 ? 0.82 : 1;
    return (baseWorldSpeed + difficultyBoost) * timeDilation * powerupEase;
}

function hasActiveShield() {
    return speedBoostTimer > 0;
}

function scheduleNextSpawn() {
    const difficultyFactor = getDifficultyFactor();
    const minInterval = Math.max(minSpawnInterval, baseSpawnInterval - difficultyFactor * 0.38);
    const maxInterval = Math.max(minInterval + 0.18, 2.05 - difficultyFactor * 0.64);
    spawnCooldown = minInterval + Math.random() * (maxInterval - minInterval);
}

function spawnEntity() {
    const spawnX = canvas.width + 60;
    const spawnCoin = Math.random() < 0.26;
    const lastObstacle = obstacles[obstacles.length - 1];
    const lastCoin = collectibles[collectibles.length - 1];

    if (lastObstacle && spawnX - lastObstacle.x < 220) {
        return;
    }

    if (lastCoin && spawnX - lastCoin.x < 170) {
        return;
    }

    if (spawnCoin) {
        collectibles.push({
            x: spawnX,
            y: floorY - 110 - Math.random() * 54,
            w: 24,
            h: 24,
            collected: false,
        });
        return;
    }

    const obstacleSize = 28 + Math.round(Math.random() * 10);
    obstacles.push({
        x: spawnX,
        y: floorY - obstacleSize,
        w: obstacleSize,
        h: obstacleSize,
        hit: false,
        scored: false,
    });
}

// Load Master Sprite Sheet (Player, Enemy, Coin vertically stacked)
const spriteMaster = new Image();
let processedSpriteSheet = null;
let processedSpriteMeta = "";
let spriteSheetReady = false;
let spriteSheetFailed = false;

spriteMaster.decoding = "async";
spriteMaster.onload = () => {
    spriteSheetReady = true;
    spriteSheetFailed = false;
    processedSpriteSheet = null;
    processedSpriteMeta = "";
};
spriteMaster.onerror = () => {
    spriteSheetReady = false;
    spriteSheetFailed = true;
    processedSpriteSheet = null;
    processedSpriteMeta = "";
    console.warn("Failed to load master sprite sheet from /assets/master_sheet.png");
};
spriteMaster.src = `/assets/master_sheet.png?v=1`;

function getRenderableSpriteSheet() {
    if (spriteSheetFailed || !spriteSheetReady) {
        return null;
    }

    if (!spriteMaster.complete || spriteMaster.naturalWidth === 0 || spriteMaster.naturalHeight === 0) {
        return null;
    }

    const spriteMeta = `${spriteMaster.currentSrc}:${spriteMaster.naturalWidth}x${spriteMaster.naturalHeight}`;
    if (processedSpriteSheet && processedSpriteMeta === spriteMeta) {
        return processedSpriteSheet;
    }

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = spriteMaster.naturalWidth;
    offscreenCanvas.height = spriteMaster.naturalHeight;
    const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

    offscreenCtx.drawImage(spriteMaster, 0, 0);
    const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    const { data } = imageData;
    const alphaMask = new Uint8ClampedArray(offscreenCanvas.width * offscreenCanvas.height);

    function pixelIndex(x, y) {
        return (y * offscreenCanvas.width + x) * 4;
    }

    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];

        const isChromakeyGreen =
            green > 95 &&
            green > red * 1.18 &&
            green > blue * 1.18 &&
            red < 150 &&
            blue < 150;

        if (isChromakeyGreen) {
            data[index + 3] = 0;
        }
    }

    for (let y = 0; y < offscreenCanvas.height; y += 1) {
        for (let x = 0; x < offscreenCanvas.width; x += 1) {
            const index = pixelIndex(x, y);
            alphaMask[y * offscreenCanvas.width + x] = data[index + 3];
        }
    }

    for (let y = 1; y < offscreenCanvas.height - 1; y += 1) {
        for (let x = 1; x < offscreenCanvas.width - 1; x += 1) {
            const index = pixelIndex(x, y);
            const alpha = alphaMask[y * offscreenCanvas.width + x];

            if (alpha === 0) {
                continue;
            }

            let transparentNeighbors = 0;
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                    if (offsetX === 0 && offsetY === 0) {
                        continue;
                    }

                    const neighborAlpha =
                        alphaMask[(y + offsetY) * offscreenCanvas.width + (x + offsetX)];
                    if (neighborAlpha === 0) {
                        transparentNeighbors += 1;
                    }
                }
            }

            if (transparentNeighbors >= 3) {
                const red = data[index];
                const green = data[index + 1];
                const blue = data[index + 2];
                const greenBias = Math.max(0, green - Math.max(red, blue));

                if (greenBias > 10) {
                    data[index] = Math.min(255, red + greenBias * 0.55);
                    data[index + 1] = Math.max(0, green - greenBias * 0.85);
                    data[index + 2] = Math.min(255, blue + greenBias * 0.28);
                }

                data[index + 3] = Math.min(alpha, transparentNeighbors >= 5 ? 120 : 180);
            }
        }
    }

    offscreenCtx.putImageData(imageData, 0, 0);
    processedSpriteSheet = offscreenCanvas;
    processedSpriteMeta = spriteMeta;
    return processedSpriteSheet;
}

function returnToStartScreen() {
    stopHackerMatrix();
    resetAudioPlayback();
    stopAmbientLoop();
    stopLandingIntroAudio();
    stopLocalSpeech();

    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
    }

    generatedAppScreen.classList.add("hidden");
    gameScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    startCanvasAnimation();

    resetGeneratedAppState();
    isPaused = true;
    hasLevelStarted = false;
    maybePlayLandingIntro({ force: true }).catch(() => null);
}

function initGame() {
    score = 0;
    coins = 0;
    lives = 7;
    isPaused = true;
    isInvulnerable = false;
    hasLevelStarted = false;
    playerY = floorY - playerSize;
    playerVY = 0;
    speedBoostTimer = 0;
    timeDilation = 1.0;
    invulnerabilityTimer = 0;
    spawnCooldown = 0.9;
    animationTick = 0;
    lastFrameTime = 0;
    playerForwardOffset = 0;
    particles = [];
    shakeTimer = 0;
    wasGroundedLastFrame = true;
    obstacles = [{ x: 800, y: floorY - 30, w: 30, h: 30, hit: false, scored: false }];
    collectibles = [];

    updateHud();
    pauseBtn.innerText = "START";
    gameOverScreen.classList.add("hidden");
    gameStartScreen.classList.remove("hidden");

    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
    }
    gameLoopId = requestAnimationFrame(gameLoop);
}

pauseBtn.addEventListener("click", () => {
    if (!hasLevelStarted) {
        hasLevelStarted = true;
        isPaused = false;
        gameStartScreen.classList.add("hidden");
        pauseBtn.innerText = "PAUSE";
        return;
    }

    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? "RESUME" : "PAUSE";
});

restartBtn.addEventListener("click", () => {
    initGame();
});

startLevelBtn.addEventListener("click", () => {
    hasLevelStarted = true;
    isPaused = false;
    gameStartScreen.classList.add("hidden");
    pauseBtn.innerText = "PAUSE";
});

backToStartBtn.addEventListener("click", returnToStartScreen);
generatedBackToStartBtn.addEventListener("click", returnToStartScreen);

function triggerJump() {
    if (!hasLevelStarted) {
        return;
    }

    if (!isJumping && !isPaused && lives > 0) {
        isJumping = true;
        playerVY = getJumpVelocity();
        playJumpSfx();
    }
}

document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        return;
    }

    if (event.code === "Space" || event.code === "ArrowUp") {
        if (event.code === "Space") {
            event.preventDefault();
        }
        triggerJump();
    }

    if (event.code === "KeyP") {
        pauseBtn.click();
    }
});

canvas.addEventListener("click", triggerJump);

function drawPlayer(x, y) {
    if (isInvulnerable && !hasActiveShield() && Math.floor(Date.now() / 100) % 2 === 0) {
        return;
    }

    if (hasActiveShield()) {
        const boostPulse = 0.55 + Math.sin(animationTick * 0.35) * 0.18;
        const auraRadius = playerSize * (0.62 + boostPulse * 0.18);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath();
        ctx.arc(x + playerSize / 2, y + playerSize / 2, auraRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(236, 72, 153, ${0.1 + boostPulse * 0.12})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x + playerSize / 2, y + playerSize / 2, auraRadius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(103, 232, 249, ${0.22 + boostPulse * 0.16})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
    }

    // Dynamic Shadow on the floor
    const shadowScale = Math.max(0.3, 1 - (floorY - playerSize - y) / 150);
    ctx.beginPath();
    ctx.ellipse(x + playerSize / 2, floorY, (playerSize / 2.5) * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();

    // Faux tilt when jumping
    let runTilt = 0;
    if (isJumping) {
        runTilt = playerVY < 0 ? -0.1 : 0.1;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x + playerSize / 2, y + playerSize / 2);
    ctx.rotate(runTilt);

    const renderableSpriteSheet = getRenderableSpriteSheet();
    if (renderableSpriteSheet) {
        // Master Sheet: Player is Row 0 (Y: 0-100)
        const totalFrames = 8;
        const frameWidth = renderableSpriteSheet.width / totalFrames;
        const frameHeight = renderableSpriteSheet.height / 3;

        // Animate slower when in bullet-time
        const animSpeedModifier = timeDilation < 1.0 ? 12 : 6;
        let frameIndex = isJumping ? 4 : Math.floor(animationTick / animSpeedModifier) % totalFrames;
        const sx = frameIndex * frameWidth;

        ctx.drawImage(
            renderableSpriteSheet,
            sx, 0 * frameHeight, frameWidth, frameHeight,
            Math.round(-playerSize / 2 - 5), Math.round(-playerSize / 2 - 5), Math.round(playerSize + 10), Math.round(playerSize + 10)
        );
    } else {
        ctx.fillStyle = "#FF6300"; // Mistral Orange
        ctx.fillRect(-playerSize / 2, -playerSize / 2, playerSize, playerSize);
    }
    ctx.restore();

    if (hasActiveShield()) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `rgba(236, 72, 153, ${0.3 + Math.sin(animationTick * 0.45) * 0.16})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + playerSize / 2, y + playerSize / 2, playerSize * 0.52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawObstacle(obstacle) {
    if (obstacle.hit) {
        return;
    }

    // Shadow on the floor
    ctx.beginPath();
    ctx.ellipse(obstacle.x + obstacle.w / 2, floorY, obstacle.w / 2, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();

    // Master Sheet logic for enemy (8 frames, Row 1)
    const renderableSpriteSheet = getRenderableSpriteSheet();
    if (renderableSpriteSheet) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        const totalFrames = 8;
        const frameWidth = renderableSpriteSheet.width / totalFrames;
        const frameHeight = renderableSpriteSheet.height / 3;

        const frameIndex = Math.floor((animationTick + obstacle.x) / 6) % totalFrames;
        const sx = frameIndex * frameWidth;

        ctx.drawImage(
            renderableSpriteSheet,
            sx, 1 * frameHeight, frameWidth, frameHeight,
            Math.round(obstacle.x - 5), Math.round(obstacle.y - 5), Math.round(obstacle.w + 10), Math.round(obstacle.h + 10)
        );
        ctx.restore();
    } else {
        ctx.fillStyle = "#E11D48"; // Rose/Red
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(obstacle.x + 5, obstacle.y + 10, 8, 8); // eye 1
        ctx.fillRect(obstacle.x + 25, obstacle.y + 10, 8, 8); // eye 2
    }
}

function drawCollectible(coin) {
    if (coin.collected) return;

    // Floating Y animation overlay
    const floatY = Math.sin(animationTick * 0.1) * 5;

    // Soft Shadow on the floor
    const shadowScale = Math.max(0.2, 1 - (floorY - coin.y) / 200);
    ctx.beginPath();
    ctx.ellipse(coin.x + coin.w / 2, floorY, (coin.w / 1.5) * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();

    const renderableSpriteSheet = getRenderableSpriteSheet();
    if (renderableSpriteSheet) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        // Master Sheet logic for Coin (8 frames, Row 2)
        const totalFrames = 8;
        const frameWidth = renderableSpriteSheet.width / totalFrames;
        const frameHeight = renderableSpriteSheet.height / 3;

        const frameIndex = Math.floor(animationTick / 8) % totalFrames; // spin slower
        const sx = frameIndex * frameWidth;

        ctx.drawImage(
            renderableSpriteSheet,
            sx, 2 * frameHeight, frameWidth, frameHeight,
            Math.round(coin.x - 5), Math.round(coin.y + floatY - 5), Math.round(coin.w + 10), Math.round(coin.h + 10)
        );
        ctx.restore();
    } else {
        ctx.fillStyle = "#EC4899"; // Pink/Magenta elixir fallback
        ctx.beginPath();
        ctx.arc(coin.x + coin.w / 2, coin.y + coin.h / 2 + floatY, coin.w / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function gameLoop(timestamp) {
    if (!lastFrameTime) {
        lastFrameTime = timestamp;
    }

    const deltaMs = Math.min(maxFrameDeltaMs, timestamp - lastFrameTime || 16.67);
    const deltaSeconds = deltaMs / 1000;
    const frameScale = deltaMs / (1000 / 60);
    lastFrameTime = timestamp;
    animationTick += frameScale;

    if (isPaused) {
        lastFrameTime = timestamp;
        gameLoopId = requestAnimationFrame(gameLoop);
        return;
    }
    if (lives <= 0) {
        gameOverScreen.classList.remove("hidden");
        stopHackerMatrix();
        gameLoopId = null;
        return;
    }

    if (timeDilation < 1.0) {
        timeDilation = Math.min(1.0, timeDilation + slowdownRecoveryPerSecond * deltaSeconds);
    }

    if (speedBoostTimer > 0) {
        speedBoostTimer = Math.max(0, speedBoostTimer - deltaSeconds);
    }

    if (invulnerabilityTimer > 0) {
        invulnerabilityTimer = Math.max(0, invulnerabilityTimer - deltaSeconds);
        if (invulnerabilityTimer === 0) {
            isInvulnerable = false;
        }
    }

    if (shakeTimer > 0) {
        shakeTimer = Math.max(0, shakeTimer - deltaSeconds);
    }

    const worldSpeed = getWorldSpeed();
    playerVY += gravity * deltaSeconds;
    playerY += playerVY * deltaSeconds;
    if (playerY >= floorY - playerSize) {
        playerY = floorY - playerSize;
        isJumping = false;
        playerVY = 0;
    }
    const isGrounded = playerY >= floorY - playerSize - 0.5;

    if (!wasGroundedLastFrame && isGrounded) {
        spawnDustBurst(58 + playerForwardOffset, floorY - 4);
    }
    wasGroundedLastFrame = isGrounded;

    const jumpHeight = floorY - playerSize - playerY;
    const airborneRatio = clamp(jumpHeight / (playerSize * 1.15), 0, 1);
    const forwardBias = playerVY < 0 ? 1 : 0.72;
    const targetForwardOffset = airborneRatio * maxForwardOffset * forwardBias;
    const offsetBlend = Math.min(1, deltaSeconds * forwardOffsetResponse);
    playerForwardOffset += (targetForwardOffset - playerForwardOffset) * offsetBlend;

    if (!isJumping && playerForwardOffset < 0.25) {
        playerForwardOffset = 0;
    }

    const playerX = 50 + playerForwardOffset;

    updateParticles(deltaSeconds);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (shakeTimer > 0) {
        const shakeStrength = (shakeTimer / screenShakeDuration) * 4;
        const shakeX = (Math.random() - 0.5) * shakeStrength * 2;
        const shakeY = (Math.random() - 0.5) * shakeStrength * 1.4;
        ctx.translate(shakeX, shakeY);
    }

    drawParallaxBackground(worldSpeed, deltaSeconds);
    ctx.fillStyle = "#1E293B";
    ctx.fillRect(0, floorY, canvas.width, canvas.height - floorY);
    drawPlayer(playerX, playerY);

    for (let i = 0; i < collectibles.length; i++) {
        const coin = collectibles[i];
        coin.x -= worldSpeed * deltaSeconds;
        if (!coin.collected) {
            drawCollectible(coin);

            if (
                playerX < coin.x + coin.w &&
                playerX + playerSize > coin.x &&
                playerY < coin.y + coin.h &&
                playerY + playerSize > coin.y
            ) {
                coin.collected = true;
                coins += 1;
                score += 50;
                updateHud();
                speedBoostTimer = powerupDuration;
                timeDilation = slowdownFloor;
                spawnCoinBurst(coin.x + coin.w / 2, coin.y + coin.h / 2);
                playCoinSfx();
            }
        }
    }
    collectibles = collectibles.filter((coin) => coin.x + coin.w > -40 && !coin.collected);

    for (let index = 0; index < obstacles.length; index += 1) {
        const obstacle = obstacles[index];
        obstacle.x -= worldSpeed * deltaSeconds;
        if (!obstacle.hit) {
            drawObstacle(obstacle);
        }

        if (!obstacle.hit && !obstacle.scored && obstacle.x + obstacle.w < playerX) {
            obstacle.scored = true;
            score += 10;
            updateHud();
        }

        if (
            !obstacle.hit &&
            playerX < obstacle.x + obstacle.w &&
            playerX + playerSize > obstacle.x &&
            playerY < obstacle.y + obstacle.h &&
            playerY + playerSize > obstacle.y
        ) {
            if (hasActiveShield()) {
                obstacle.hit = true;
                obstacle.scored = true;
                score += 15;
                updateHud();
                continue;
            }

            if (isInvulnerable) {
                continue;
            }

            lives -= 1;
            updateHud();
            obstacle.hit = true;
            isInvulnerable = true;
            invulnerabilityTimer = invulnerabilityDuration;
            shakeTimer = screenShakeDuration;
            playHitSfx();
        }
    }

    obstacles = obstacles.filter((obstacle) => obstacle.x + obstacle.w > -60);

    spawnCooldown -= deltaSeconds;
    if (spawnCooldown <= 0) {
        spawnEntity();
        scheduleNextSpawn();
    }

    if (isInvulnerable) {
        ctx.fillStyle = `rgba(239, 68, 68, ${0.08 + Math.sin(animationTick * 0.22) * 0.04})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawParticles();
    ctx.restore();

    gameLoopId = requestAnimationFrame(gameLoop);
}

const defaultPrompt = `# Mistral Hackathon Agent

Build a highly interactive AI game companion that responds to my actions in real-time.

- Uses **Mistral Large** for reasoning.
- Uses a generated podcast while the wait screen stays interactive.`;

promptEditorArea.value = defaultPrompt;

function initializeEditor() {
    window.easymde = new EasyMDE({
        element: promptEditorArea,
        spellChecker: false,
        status: false,
        sideBySideFullscreen: false,
        toolbar: [
            "bold",
            "italic",
            "heading",
            "|",
            "quote",
            "unordered-list",
            "ordered-list",
            "|",
            "preview",
            "guide",
        ],
        placeholder: "Describe the app you want to build...",
        initialValue: defaultPrompt,
    });

    const inputField = window.easymde.codemirror.getInputField();
    if (inputField) {
        inputField.setAttribute("spellcheck", "false");
        inputField.setAttribute("autocorrect", "off");
        inputField.setAttribute("autocapitalize", "off");
    }

    if (!window.easymde.isPreviewActive()) {
        window.easymde.togglePreview();
    }

    const codeMirrorWrapper = window.easymde.codemirror.getWrapperElement();
    const editorContainer = codeMirrorWrapper
        ? codeMirrorWrapper.closest(".EasyMDEContainer")
        : null;

    if (!editorContainer) {
        return;
    }

    editorContainer.addEventListener("click", (event) => {
        const previewPane = event.target.closest(".editor-preview, .editor-preview-side");
        if (!previewPane || !window.easymde.isPreviewActive()) {
            return;
        }

        window.easymde.togglePreview();
        window.easymde.codemirror.focus();
    });
}

// --- Canvas Matrix Rain Implementation ---
function initMatrixCanvas() {
    if (!matrixCanvas || !matrixCtx) return;
    matrixCanvas.width = window.innerWidth;
    matrixCanvas.height = window.innerHeight;

    matrixColumns = Math.floor(matrixCanvas.width / matrixFontSize);
    matrixDrops = [];
    for (let x = 0; x < matrixColumns; x++) {
        // Pre-fill the screen with matrix drops so it starts dense
        matrixDrops[x] = Math.random() * (matrixCanvas.height / matrixFontSize);
    }
}

function drawMatrix() {
    if (!matrixCtx) return;

    // Translucent black blurs the previous frame to create trails
    matrixCtx.fillStyle = "rgba(15, 23, 42, 0.1)"; // slate-900 with alpha
    matrixCtx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);

    matrixCtx.fillStyle = "#22C55E"; // Matrix Green (Tail)
    matrixCtx.font = matrixFontSize + "px monospace";

    for (let i = 0; i < matrixDrops.length; i++) {
        // Random characters (Katakana + Latin)
        const char = String.fromCharCode(0x30A0 + Math.random() * 96);

        // Draw the character
        const x = i * matrixFontSize;
        const y = matrixDrops[i] * matrixFontSize;

        // Highlight head of the stream
        if (Math.random() > 0.95) {
            matrixCtx.fillStyle = "#BBF7D0"; // White-ish Green head
        } else {
            matrixCtx.fillStyle = "#22C55E";
        }

        matrixCtx.fillText(char, x, y);

        // Once it passes the screen bottom, reset it quickly (~5 frames avg) to keep a heavy, continuous loop
        if (y > matrixCanvas.height && Math.random() > 0.8) {
            // Also occasionally reset drops BEFORE they hit the bottom for dynamic trail lengths
            matrixDrops[i] = 0;
        } else if (Math.random() > 0.995) {
            // Very rarely vanish mid-screen to create gaps
            matrixDrops[i] = 0;
        }
        matrixDrops[i]++;
    }
}

window.addEventListener('resize', () => {
    if (matrixInterval) {
        initMatrixCanvas();
    }
});

function startHackerMatrix() {
    if (matrixInterval) {
        clearInterval(matrixInterval);
    }
    initMatrixCanvas();
    if (matrixCtx) {
        matrixCtx.fillStyle = "#0F172A";
        matrixCtx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
    }
    matrixInterval = setInterval(drawMatrix, 35);
}

function stopHackerMatrix() {
    if (matrixInterval) {
        clearInterval(matrixInterval);
        matrixInterval = null;
    }
}

syncAudioProviderUi();
window.setTimeout(() => {
    maybePlayLandingIntro().catch(() => null);
}, 220);

// --- Start Screen Canvas Animation Implementation ---
let startInterval = null;
let bgParticles = [];

function initStartCanvas() {
    if (!startCanvas || !startCtx) return;
    startCanvas.width = window.innerWidth;
    startCanvas.height = window.innerHeight;

    // Create random floating pixels
    const numParticles = Math.floor((window.innerWidth * window.innerHeight) / 15000);
    bgParticles = [];
    for (let i = 0; i < numParticles; i++) {
        bgParticles.push({
            x: Math.random() * startCanvas.width,
            y: Math.random() * startCanvas.height,
            size: 3 + Math.random() * 8, // 3px to 11px
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4 - 0.2, // slight upward drift
            color: Math.random() > 0.8 ? 'rgba(236, 72, 153, 0.4)' : 'rgba(249, 115, 22, 0.4)', // Pink or Orange
            alpha: Math.random()
        });
    }
}

function drawStartCanvas() {
    if (!startCtx) return;

    // Clear background
    startCtx.fillStyle = "#020817"; // Very dark blue/black slate
    startCtx.fillRect(0, 0, startCanvas.width, startCanvas.height);

    for (let i = 0; i < bgParticles.length; i++) {
        const p = bgParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha += 0.02; // Pulsing alpha

        if (p.x < -20) p.x = startCanvas.width + 20;
        if (p.x > startCanvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = startCanvas.height + 20;
        if (p.y > startCanvas.height + 20) p.y = -20;

        const currentAlpha = 0.2 + (Math.sin(p.alpha) * 0.5 + 0.5) * 0.8;

        startCtx.save();
        startCtx.globalAlpha = currentAlpha;
        startCtx.fillStyle = p.color;
        // Draw pixel block
        startCtx.fillRect(Math.floor(p.x), Math.floor(p.y), Math.floor(p.size), Math.floor(p.size));

        // Very subtle glow for larger pixels
        if (p.size > 8) {
            startCtx.shadowBlur = 15;
            startCtx.shadowColor = p.color;
            startCtx.fillRect(Math.floor(p.x), Math.floor(p.y), Math.floor(p.size), Math.floor(p.size));
        }

        startCtx.restore();
    }
}

window.addEventListener('resize', () => {
    if (startInterval) {
        initStartCanvas();
    }
});

function startCanvasAnimation() {
    if (startInterval) clearInterval(startInterval);
    initStartCanvas();
    startInterval = setInterval(drawStartCanvas, 1000 / 60); // 60fps
}

function stopStartCanvasAnimation() {
    if (startInterval) {
        clearInterval(startInterval);
        startInterval = null;
    }
}

// Start the animation immediately on page load
startCanvasAnimation();

window.setTimeout(initializeEditor, 100);
