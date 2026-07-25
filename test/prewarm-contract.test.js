import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("speech engine prewarms before playback without blocking real reads", async () => {
  const [background, worker] = await Promise.all([
    readFile(new URL("../src/background.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tts-worker.js", import.meta.url), "utf8")
  ]);

  assert.match(background, /chrome\.runtime\.onStartup\.addListener\(prepareAudioEngine\)/);
  assert.match(background, /case "GET_STATUS":[\s\S]*prepareAudioEngine\(\)/);
  assert.match(worker, /message\?\.type === "INIT"[\s\S]*prewarmEngine\(\)/);
  assert.match(worker, /pendingUserGenerations > 0/);
});
