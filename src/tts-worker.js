import { KokoroTTS, env } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsPromise = null;
let inferenceQueue = Promise.resolve();
let modelProgressRequestId = null;
let pendingUserGenerations = 0;
const warmedVoices = new Set();
const warmingVoices = new Set();

function serialiseProgress(progress) {
  return {
    status: typeof progress?.status === "string" ? progress.status : "",
    progress: Number.isFinite(progress?.progress) ? progress.progress : null
  };
}

async function getTts(requestId = null) {
  if (requestId !== null && requestId !== undefined) {
    modelProgressRequestId = requestId;
  }

  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (progress) => {
        self.postMessage({
          type: "MODEL_PROGRESS",
          requestId: modelProgressRequestId,
          progress: serialiseProgress(progress)
        });
      }
    }).catch((error) => {
      ttsPromise = null;
      throw error;
    });
  }

  return ttsPromise;
}

function normaliseVoice(settings = {}) {
  return typeof settings.voice === "string" ? settings.voice : "af_heart";
}

async function prewarmEngine(settings = {}) {
  const voice = normaliseVoice(settings);
  if (warmedVoices.has(voice) || warmingVoices.has(voice)) return;

  warmingVoices.add(voice);
  try {
    const tts = await getTts();
    const task = inferenceQueue.then(async () => {
      if (pendingUserGenerations > 0 || warmedVoices.has(voice)) return;
      await tts.generate("a", { voice, speed: 1 });
      warmedVoices.add(voice);
    });
    inferenceQueue = task.catch(() => {});
    await task;
  } catch {
    // Prewarming is an optimisation only. A real request will retry and surface errors.
  } finally {
    warmingVoices.delete(voice);
  }
}

async function generateAudio({ requestId, text, settings }) {
  try {
    const tts = await getTts(requestId);
    const audio = await tts.generate(text, settings);
    warmedVoices.add(normaliseVoice(settings));
    self.postMessage({ type: "GENERATED", requestId, blob: audio.toBlob() });
  } catch (error) {
    self.postMessage({
      type: "GENERATION_ERROR",
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message?.type === "INIT") {
    env.wasmPaths = message.wasmPaths;
    return;
  }

  if (message?.type === "PREWARM") {
    prewarmEngine(message.settings);
    return;
  }

  if (message?.type !== "GENERATE") return;

  pendingUserGenerations += 1;
  const task = inferenceQueue
    .then(() => generateAudio(message))
    .finally(() => {
      pendingUserGenerations = Math.max(0, pendingUserGenerations - 1);
    });
  inferenceQueue = task.catch(() => {});
});
