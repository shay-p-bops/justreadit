import { KokoroTTS, env } from "kokoro-js";
import { chunkText } from "./text.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsPromise = null;
let currentAudio = null;
let currentAudioUrl = null;
let currentPlaybackDone = null;
let runId = 0;
let inferenceQueue = Promise.resolve();
let state = { status: "idle", message: "Ready", current: 0, total: 0 };

env.wasmPaths = chrome.runtime.getURL("wasm/");

function publish(patch) {
  state = { ...state, ...patch };
  chrome.runtime.sendMessage({ type: "PLAYER_STATUS", state }).catch(() => {});
}

function progressMessage(progress) {
  if (progress?.status === "progress" && Number.isFinite(progress.progress)) {
    return `Downloading voice model… ${Math.round(progress.progress)}%`;
  }
  return "Preparing voice model…";
}

async function getTts() {
  if (!ttsPromise) {
    publish({ status: "loading", message: "Preparing voice model…", current: 0, total: 0 });
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (progress) => publish({ status: "loading", message: progressMessage(progress) })
    }).catch((error) => {
      ttsPromise = null;
      throw error;
    });
  }
  return ttsPromise;
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

async function playAudio(rawAudio, id, index, total) {
  if (id !== runId) return;

  currentAudioUrl = URL.createObjectURL(rawAudio.toBlob());
  const audio = new Audio(currentAudioUrl);
  currentAudio = audio;

  publish({ status: "playing", message: `Reading ${index} of ${total}`, current: index, total });

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };

    currentPlaybackDone = () => finish();
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("Audio playback failed."));
    audio.play().catch(finish);
  });

  if (currentAudio === audio) clearAudio();
  currentPlaybackDone = null;
}

function generate(tts, text, settings) {
  const task = inferenceQueue.then(() => tts.generate(text, settings));
  inferenceQueue = task.catch(() => {});
  return task;
}

async function startReading(text, settings = {}) {
  const id = ++runId;
  stopCurrentAudio();

  try {
    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("No readable text found.");

    const voice = typeof settings.voice === "string" ? settings.voice : "af_heart";
    const speed = Math.min(1.35, Math.max(0.75, Number(settings.speed) || 1));
    const tts = await getTts();
    if (id !== runId) return;

    let nextAudio = generate(tts, chunks[0], { voice, speed });

    for (let index = 0; index < chunks.length; index += 1) {
      publish({ status: "generating", message: `Generating ${index + 1} of ${chunks.length}`, current: index + 1, total: chunks.length });
      const audio = await nextAudio;
      if (id !== runId) return;

      nextAudio = index + 1 < chunks.length
        ? generate(tts, chunks[index + 1], { voice, speed })
        : null;

      await playAudio(audio, id, index + 1, chunks.length);
      if (id !== runId) return;
    }

    publish({ status: "idle", message: "Finished", current: chunks.length, total: chunks.length });
  } catch (error) {
    if (id === runId) {
      publish({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
}

function pause() {
  if (!currentAudio || currentAudio.paused) return;
  currentAudio.pause();
  publish({ status: "paused", message: `Paused · ${state.current} of ${state.total}` });
}

async function resume() {
  if (!currentAudio) return;
  await currentAudio.play();
  publish({ status: "playing", message: `Reading ${state.current} of ${state.total}` });
}

function stop() {
  runId += 1;
  stopCurrentAudio();
  publish({ status: "idle", message: "Stopped", current: 0, total: 0 });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;

  if (message.type === "GET_STATUS") {
    sendResponse({ ok: true, state });
    return;
  }

  (async () => {
    if (message.type === "START_READING") {
      startReading(message.text, message.settings);
      return { ok: true };
    }

    if (message.type === "PLAYER_COMMAND") {
      if (message.command === "pause") pause();
      else if (message.command === "resume") await resume();
      else if (message.command === "stop") stop();
      return { ok: true };
    }

    throw new Error("Unknown offscreen request.");
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
