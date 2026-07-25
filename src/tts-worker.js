import { KokoroTTS, env } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsPromise = null;
let inferenceQueue = Promise.resolve();

function serialiseProgress(progress) {
  return {
    status: typeof progress?.status === "string" ? progress.status : "",
    progress: Number.isFinite(progress?.progress) ? progress.progress : null
  };
}

async function getTts(requestId) {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (progress) => {
        self.postMessage({
          type: "MODEL_PROGRESS",
          requestId,
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

async function generateAudio({ requestId, text, settings }) {
  try {
    const tts = await getTts(requestId);
    const audio = await tts.generate(text, settings);
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

  if (message?.type !== "GENERATE") return;

  const task = inferenceQueue.then(() => generateAudio(message));
  inferenceQueue = task.catch(() => {});
});
