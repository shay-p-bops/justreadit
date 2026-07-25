const OFFSCREEN_PATH = "offscreen.html";
const MENU_ID = "just-read-it-selection";
const SYSTEM_ENGINE = "system";
const KOKORO_ENGINE = "kokoro";
const ACTIVE_STATUSES = new Set(["loading", "generating", "playing", "paused"]);
const IDLE_STATE = {
  status: "idle",
  message: "Ready",
  engine: null,
  current: 0,
  total: 0,
  position: 0,
  duration: 0,
  startedAt: null,
  startupMs: null,
  updatedAt: Date.now()
};

let creatingOffscreen = null;
let latestState = { ...IDLE_STATE };
let activeEngine = null;
let receivedLiveState = false;
let systemRunId = 0;
let systemPlayback = null;
let systemVoicePromise = null;
let restoringState = chrome.storage.session.get({ playerState: null })
  .then(({ playerState }) => {
    if (!receivedLiveState && playerState && typeof playerState === "object") {
      latestState = { ...IDLE_STATE, ...playerState };
      activeEngine = latestState.engine || null;
    }
  })
  .catch(() => {});

function normaliseEngine(value) {
  return value === KOKORO_ENGINE ? KOKORO_ENGINE : SYSTEM_ENGINE;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function estimateSpeechDuration(text, rate) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 190 * clamp(rate, 0.5, 2);
  return Math.max(1, (words / wordsPerMinute) * 60);
}

function positionForCharacter(characterIndex, textLength, duration) {
  if (!textLength || !duration) return 0;
  return clamp(characterIndex / textLength, 0, 1) * duration;
}

function characterForPosition(text, position, duration) {
  if (!duration) return 0;
  const approximate = Math.floor(clamp(position / duration, 0, 1) * text.length);
  if (approximate <= 0 || approximate >= text.length) return approximate;
  const nextSpace = text.indexOf(" ", approximate);
  return nextSpace === -1 ? approximate : nextSpace + 1;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function hasOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["WORKERS", "BLOBS"],
    justification: "Run local speech generation in a worker, create audio blobs, and play them."
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

function prepareAudioEngine() {
  ensureOffscreenDocument().catch((error) => {
    console.warn("Just Read It could not prewarm the audio engine:", error);
  });
}

function prepareInstantEngine() {
  getSystemVoice().catch((error) => {
    console.warn("Just Read It could not prepare a local system voice:", error);
  });
}

async function prepareSelectedEngine() {
  const settings = await getSettings();
  if (settings.engine === KOKORO_ENGINE) prepareAudioEngine();
  else prepareInstantEngine();
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

function rememberState(nextState) {
  receivedLiveState = true;
  latestState = { ...IDLE_STATE, ...nextState, updatedAt: nextState.updatedAt ?? Date.now() };
  if (latestState.engine) activeEngine = latestState.engine;
  chrome.storage.session.set({ playerState: latestState }).catch(() => {});
}

function markAudioEngineInterrupted() {
  const interruptedState = {
    ...latestState,
    status: "error",
    message: "Audio engine stopped before playback. Try again.",
    position: 0,
    duration: 0,
    updatedAt: Date.now()
  };
  rememberState(interruptedState);
  setBadge(interruptedState.status);
}

async function getSettings() {
  const stored = await chrome.storage.local.get({ engine: SYSTEM_ENGINE, voice: "af_heart", speed: 1, volume: 1 });
  return {
    engine: normaliseEngine(stored.engine),
    voice: typeof stored.voice === "string" ? stored.voice : "af_heart",
    speed: Number.isFinite(Number(stored.speed)) ? Number(stored.speed) : 1,
    volume: Number.isFinite(Number(stored.volume)) ? Number(stored.volume) : 1
  };
}

function systemVoiceScore(voice) {
  const language = String(voice?.lang || "").toLowerCase();
  const events = new Set(voice?.eventTypes || []);
  let score = 0;
  if (language === "en-us") score += 40;
  else if (language.startsWith("en-")) score += 30;
  else if (language === "en") score += 20;
  if (events.has("start")) score += 4;
  if (events.has("word")) score += 4;
  if (events.has("end")) score += 4;
  return score;
}

async function getSystemVoice() {
  if (!systemVoicePromise) {
    systemVoicePromise = chrome.tts.getVoices()
      .then((voices) => voices
        .filter((voice) => voice.remote !== true && /^en(?:-|$)/i.test(String(voice.lang || "")))
        .sort((left, right) => systemVoiceScore(right) - systemVoiceScore(left))[0] || null)
      .catch((error) => {
        systemVoicePromise = null;
        throw error;
      });
  }

  const voice = await systemVoicePromise;
  if (!voice) throw new Error("No local English system voice is available. Choose Natural · Kokoro instead.");
  return voice;
}

function stopSystemPlayback({ publish = false } = {}) {
  systemRunId += 1;
  systemPlayback = null;
  chrome.tts.stop();

  if (publish) {
    rememberState({
      status: "idle",
      message: "Stopped",
      engine: SYSTEM_ENGINE,
      current: 0,
      total: 0,
      position: 0,
      duration: 0,
      startedAt: null,
      startupMs: null
    });
    setBadge("idle");
  }
}

function markSystemStarted(playback, position) {
  if (!systemPlayback || systemPlayback.id !== playback.id || playback.started) return;
  playback.started = true;
  rememberState({
    status: "playing",
    message: `Reading with ${playback.voice.voiceName || "system voice"}`,
    engine: SYSTEM_ENGINE,
    current: 1,
    total: 1,
    position,
    duration: playback.duration,
    startedAt: playback.startedAt,
    startupMs: Math.max(0, Date.now() - playback.startedAt)
  });
  setBadge("playing");
}

function markSystemError(id, error) {
  if (id !== systemRunId) return;
  systemPlayback = null;
  rememberState({
    ...latestState,
    status: "error",
    message: error instanceof Error ? error.message : String(error),
    engine: SYSTEM_ENGINE,
    position: 0,
    duration: 0
  });
  setBadge("error");
}

function handleSystemEvent(id, event) {
  const playback = systemPlayback;
  if (!playback || playback.id !== id) return;

  const fullCharacterIndex = playback.offset + Math.max(0, Number(event.charIndex) || 0);
  const position = positionForCharacter(fullCharacterIndex, playback.fullText.length, playback.duration);

  switch (event.type) {
    case "start":
      markSystemStarted(playback, position);
      break;
    case "word":
    case "sentence":
      markSystemStarted(playback, position);
      rememberState({ ...latestState, engine: SYSTEM_ENGINE, position, duration: playback.duration });
      break;
    case "pause":
      rememberState({ ...latestState, status: "paused", message: "Paused · system voice", engine: SYSTEM_ENGINE, position });
      setBadge("paused");
      break;
    case "resume":
      markSystemStarted(playback, position);
      rememberState({ ...latestState, status: "playing", message: "Reading · system voice", engine: SYSTEM_ENGINE, position });
      setBadge("playing");
      break;
    case "end":
      markSystemStarted(playback, position);
      systemPlayback = null;
      rememberState({
        status: "idle",
        message: "Finished",
        engine: SYSTEM_ENGINE,
        current: 1,
        total: 1,
        position: playback.duration,
        duration: playback.duration,
        startedAt: playback.startedAt,
        startupMs: latestState.startupMs
      });
      setBadge("idle");
      break;
    case "interrupted":
    case "cancelled":
      systemPlayback = null;
      rememberState({ ...IDLE_STATE, status: "idle", message: "Stopped", engine: SYSTEM_ENGINE, updatedAt: Date.now() });
      setBadge("idle");
      break;
    case "error":
      markSystemError(id, event.errorMessage || "System speech failed.");
      break;
    default:
      break;
  }
}

async function startSystemReading(text, settings, startedAt = Date.now(), offset = 0) {
  const fullText = String(text ?? "").trim();
  if (!fullText) throw new Error("No text to read.");

  activeEngine = SYSTEM_ENGINE;
  stopSystemPlayback();
  hasOffscreenDocument()
    .then((available) => {
      if (available) chrome.runtime.sendMessage({ target: "offscreen", type: "PLAYER_COMMAND", command: "stop" }).catch(() => {});
    })
    .catch(() => {});

  const id = ++systemRunId;
  const duration = estimateSpeechDuration(fullText, settings.speed);
  const safeOffset = clamp(offset, 0, fullText.length);
  const remainder = fullText.slice(safeOffset);
  const leadingWhitespace = remainder.length - remainder.trimStart().length;
  const spokenOffset = safeOffset + leadingWhitespace;
  const utterance = fullText.slice(spokenOffset);

  if (!utterance) {
    rememberState({
      status: "idle",
      message: "Finished",
      engine: SYSTEM_ENGINE,
      current: 1,
      total: 1,
      position: duration,
      duration,
      startedAt,
      startupMs: 0
    });
    setBadge("idle");
    return { ok: true };
  }

  rememberState({
    status: "loading",
    message: "Starting instant voice…",
    engine: SYSTEM_ENGINE,
    current: 1,
    total: 1,
    position: positionForCharacter(spokenOffset, fullText.length, duration),
    duration,
    startedAt,
    startupMs: null
  });
  setBadge("loading");

  try {
    const voice = await getSystemVoice();
    if (id !== systemRunId) return { ok: true };

    systemPlayback = {
      id,
      fullText,
      offset: spokenOffset,
      duration,
      startedAt,
      settings,
      voice,
      started: false
    };

    await chrome.tts.speak(utterance, {
      voiceName: voice.voiceName,
      lang: voice.lang || "en-US",
      rate: clamp(settings.speed, 0.5, 2),
      volume: clamp(settings.volume, 0, 1),
      desiredEventTypes: ["start", "word", "sentence", "end", "error", "pause", "resume"],
      onEvent: (event) => handleSystemEvent(id, event)
    });

    await delay(150);
    if (systemPlayback?.id === id && !systemPlayback.started && await chrome.tts.isSpeaking()) {
      const position = positionForCharacter(spokenOffset, fullText.length, duration);
      markSystemStarted(systemPlayback, position);
    }

    return { ok: true };
  } catch (error) {
    markSystemError(id, error);
    throw error;
  }
}

async function startKokoroReading(text, settings, startedAt = Date.now()) {
  const cleaned = String(text ?? "").trim();
  if (!cleaned) throw new Error("No text to read.");

  activeEngine = KOKORO_ENGINE;
  stopSystemPlayback();
  const pendingState = {
    status: "loading",
    message: "Starting natural voice…",
    engine: KOKORO_ENGINE,
    current: 0,
    total: 0,
    position: 0,
    duration: 0,
    startedAt,
    startupMs: null,
    updatedAt: Date.now()
  };
  rememberState(pendingState);
  setBadge(pendingState.status);

  try {
    return await sendToOffscreen({ type: "START_READING", text: cleaned, settings, startedAt });
  } catch (error) {
    const errorState = {
      ...pendingState,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now()
    };
    rememberState(errorState);
    setBadge(errorState.status);
    throw error;
  }
}

async function startReading(text, settings, startedAt = Date.now()) {
  return settings.engine === KOKORO_ENGINE
    ? startKokoroReading(text, settings, startedAt)
    : startSystemReading(text, settings, startedAt);
}

async function handleSystemCommand(command, value) {
  if (command === "pause") {
    chrome.tts.pause();
    if (systemPlayback) {
      rememberState({ ...latestState, status: "paused", message: "Paused · system voice", engine: SYSTEM_ENGINE });
      setBadge("paused");
    }
  } else if (command === "resume") {
    chrome.tts.resume();
    if (systemPlayback) {
      rememberState({ ...latestState, status: "playing", message: "Reading · system voice", engine: SYSTEM_ENGINE });
      setBadge("playing");
    }
  } else if (command === "stop") {
    stopSystemPlayback({ publish: true });
  } else if (command === "seek" && systemPlayback) {
    const playback = systemPlayback;
    const nextOffset = characterForPosition(playback.fullText, Number(value), playback.duration);
    await startSystemReading(playback.fullText, playback.settings, Date.now(), nextOffset);
  }

  return { ok: true };
}

async function extractFromActiveTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tab.id, { target: "content", type: "EXTRACT_TEXT", mode });
  } catch {
    throw new Error("This page cannot be read. Try a normal web page.");
  }
}

function setBadge(status) {
  const text = status === "playing" ? "▶" : status === "paused" ? "Ⅱ" : ["loading", "generating"].includes(status) ? "…" : "";
  chrome.action.setBadgeText({ text });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Read selection with Just Read It",
      contexts: ["selection"]
    });
  });
  prepareSelectedEngine();
});

chrome.runtime.onStartup.addListener(prepareSelectedEngine);
chrome.tts.onVoicesChanged?.addListener(() => {
  systemVoicePromise = null;
  prepareSelectedEngine();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  try {
    await startReading(info.selectionText, await getSettings(), Date.now());
  } catch (error) {
    console.error("Just Read It:", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PLAYER_STATUS") {
    if (activeEngine === SYSTEM_ENGINE) return;
    rememberState({ ...(message.state || IDLE_STATE), engine: KOKORO_ENGINE });
    setBadge(message.state?.status);
    return;
  }

  if (message?.target !== "background") return;

  (async () => {
    switch (message.type) {
      case "READ_ACTIVE_TAB": {
        const result = await extractFromActiveTab(message.mode);
        if (!result?.ok) throw new Error(result?.error || "No readable text found.");
        return startReading(result.text, await getSettings(), message.startedAt);
      }
      case "PLAYER_COMMAND":
        if (activeEngine === SYSTEM_ENGINE || latestState.engine === SYSTEM_ENGINE) {
          return handleSystemCommand(message.command, message.value);
        }
        return sendToOffscreen({ type: "PLAYER_COMMAND", command: message.command, value: message.value });
      case "GET_STATUS": {
        await restoringState;
        if (latestState.engine === KOKORO_ENGINE && ACTIVE_STATUSES.has(latestState.status)) {
          const audioEngineAvailable = await hasOffscreenDocument();
          if (!audioEngineAvailable) markAudioEngineInterrupted();
        }
        const settings = await getSettings();
        if (settings.engine === KOKORO_ENGINE && !(await hasOffscreenDocument())) prepareAudioEngine();
        else if (settings.engine === SYSTEM_ENGINE) prepareInstantEngine();
        return { ok: true, state: latestState };
      }
      default:
        throw new Error("Unknown request.");
    }
  })()
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});