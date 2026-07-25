import { chunkText } from "./text.js";

let currentAudio = null;
let currentAudioUrl = null;
let currentPlaybackDone = null;
let currentVolume = 1;
let runId = 0;
let generationRequestId = 0;
let state = {
  status: "idle",
  message: "Ready",
  current: 0,
  total: 0,
  position: 0,
  duration: 0,
  startedAt: null,
  startupMs: null,
  updatedAt: Date.now()
};

const generationWorker = new Worker(chrome.runtime.getURL("tts-worker.js"), { type: "module" });
const pendingGenerations = new Map();
generationWorker.postMessage({ type: "INIT", wasmPaths: chrome.runtime.getURL("wasm/") });

function publish(patch) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  chrome.storage.session.set({ playerState: state }).catch(() => {});
  chrome.runtime.sendMessage({ type: "PLAYER_STATUS", state }).catch(() => {});
}

function progressMessage(progress) {
  if (progress?.status === "progress" && Number.isFinite(progress.progress)) {
    return `Downloading voice model… ${Math.round(progress.progress)}%`;
  }
  return "Preparing voice model…";
}

function rejectPendingGenerations(error) {
  for (const { reject } of pendingGenerations.values()) reject(error);
  pendingGenerations.clear();
}

generationWorker.addEventListener("error", () => {
  rejectPendingGenerations(new Error("Audio generation worker failed."));
});

generationWorker.addEventListener("message", (event) => {
  const message = event.data;
  const pending = pendingGenerations.get(message?.requestId);
  if (!pending) return;

  if (message.type === "MODEL_PROGRESS") {
    if (pending.runId === runId) {
      publish({ status: "loading", message: progressMessage(message.progress) });
    }
    return;
  }

  pendingGenerations.delete(message.requestId);
  if (message.type === "GENERATED") {
    pending.resolve(message.blob);
    return;
  }

  if (message.type === "GENERATION_ERROR") {
    pending.reject(new Error(message.error || "Audio generation failed."));
  }
});

function generate(text, settings, id) {
  const requestId = ++generationRequestId;
  return new Promise((resolve, reject) => {
    pendingGenerations.set(requestId, { resolve, reject, runId: id });
    generationWorker.postMessage({ type: "GENERATE", requestId, text, settings });
  });
}

function normaliseVolume(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function audioPosition(audio = currentAudio) {
  return Number.isFinite(audio?.currentTime) ? Math.max(0, audio.currentTime) : 0;
}

function audioDuration(audio = currentAudio) {
  return Number.isFinite(audio?.duration) ? Math.max(0, audio.duration) : 0;
}

function publishAudioProgress(audio = currentAudio) {
  if (!audio || audio !== currentAudio) return;
  publish({ position: audioPosition(audio), duration: audioDuration(audio) });
}

function clearAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

function stopCurrentAudio() {
  clearAudio();
  currentPlaybackDone?.();
  currentPlaybackDone = null;
}

async function playAudio(audioBlob, id, index, total) {
  if (id !== runId) return;

  currentAudioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(currentAudioUrl);
  audio.volume = currentVolume;
  currentAudio = audio;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };

    currentPlaybackDone = () => finish();
    audio.onloadedmetadata = () => publishAudioProgress(audio);
    audio.ondurationchange = () => publishAudioProgress(audio);
    audio.ontimeupdate = () => publishAudioProgress(audio);
    audio.onended = () => {
      publish({ position: audioDuration(audio), duration: audioDuration(audio) });
      finish();
    };
    audio.onerror = () => finish(new Error("Audio playback failed."));
    audio.play()
      .then(() => {
        if (id !== runId) return;
        const startupMs = Number.isFinite(state.startupMs)
          ? state.startupMs
          : Math.max(0, Date.now() - state.startedAt);
        publish({
          status: "playing",
          message: `Reading ${index} of ${total}`,
          current: index,
          total,
          position: audioPosition(audio),
          duration: audioDuration(audio),
          startupMs
        });
      })
      .catch(finish);
  });

  if (currentAudio === audio) clearAudio();
  currentPlaybackDone = null;
}

async function startReading(text, settings = {}, requestedAt = Date.now()) {
  const id = ++runId;
  stopCurrentAudio();

  const startedAt = Number.isFinite(Number(requestedAt)) ? Number(requestedAt) : Date.now();
  publish({
    status: "loading",
    message: "Starting speech…",
    current: 0,
    total: 0,
    position: 0,
    duration: 0,
    startedAt,
    startupMs: null
  });

  try {
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("No readable text found.");

    const voice = typeof settings.voice === "string" ? settings.voice : "af_heart";
    const speed = Math.min(1.35, Math.max(0.75, Number(settings.speed) || 1));
    currentVolume = normaliseVolume(settings.volume ?? 1);
    let nextAudio = generate(chunks[0], { voice, speed }, id);

    for (let index = 0; index < chunks.length; index += 1) {
      publish({
        status: "generating",
        message: index === 0 ? "Generating first audio…" : `Generating ${index + 1} of ${chunks.length}`,
        current: index + 1,
        total: chunks.length,
        position: 0,
        duration: 0
      });
      const audioBlob = await nextAudio;
      if (id !== runId) return;

      nextAudio = index + 1 < chunks.length
        ? generate(chunks[index + 1], { voice, speed }, id)
        : null;

      await playAudio(audioBlob, id, index + 1, chunks.length);
      if (id !== runId) return;
    }

    publish({
      status: "idle",
      message: "Finished",
      current: chunks.length,
      total: chunks.length,
      position: 0,
      duration: 0
    });
  } catch (error) {
    if (id === runId) {
      publish({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        position: 0,
        duration: 0
      });
    }
  }
}

function pause() {
  if (!currentAudio || currentAudio.paused) return;
  currentAudio.pause();
  publish({
    status: "paused",
    message: `Paused · ${state.current} of ${state.total}`,
    position: audioPosition(),
    duration: audioDuration()
  });
}

async function resume() {
  if (!currentAudio) return;
  await currentAudio.play();
  publish({
    status: "playing",
    message: `Reading ${state.current} of ${state.total}`,
    position: audioPosition(),
    duration: audioDuration()
  });
}

function seek(value) {
  if (!currentAudio) return;
  const duration = audioDuration();
  if (!duration) return;
  const nextPosition = Math.min(duration, Math.max(0, Number(value) || 0));
  currentAudio.currentTime = nextPosition;
  publish({ position: nextPosition, duration });
}

function setVolume(value) {
  currentVolume = normaliseVolume(value);
  if (currentAudio) currentAudio.volume = currentVolume;
}

function stop() {
  runId += 1;
  stopCurrentAudio();
  publish({
    status: "idle",
    message: "Stopped",
    current: 0,
    total: 0,
    position: 0,
    duration: 0,
    startedAt: null,
    startupMs: null
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;

  if (message.type === "GET_STATUS") {
    sendResponse({ ok: true, state });
    return;
  }

  (async () => {
    if (message.type === "START_READING") {
      startReading(message.text, message.settings, message.startedAt);
      return { ok: true };
    }

    if (message.type === "PLAYER_COMMAND") {
      if (message.command === "pause") pause();
      else if (message.command === "resume") await resume();
      else if (message.command === "stop") stop();
      else if (message.command === "seek") seek(message.value);
      else if (message.command === "set-volume") setVolume(message.value);
      return { ok: true };
    }

    throw new Error("Unknown offscreen request.");
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
