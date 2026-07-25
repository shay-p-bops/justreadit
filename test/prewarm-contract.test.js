import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Natural mode prewarms without blocking real reads", async () => {
  const [background, worker] = await Promise.all([
    readFile(new URL("../src/background.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tts-worker.js", import.meta.url), "utf8")
  ]);

  assert.match(background, /chrome\.runtime\.onStartup\.addListener\(prepareSelectedEngine\)/);
  assert.match(background, /async function prepareSelectedEngine\(\)[\s\S]*settings\.engine === KOKORO_ENGINE/);
  assert.match(background, /case "GET_STATUS":[\s\S]*settings\.engine === KOKORO_ENGINE[\s\S]*prepareAudioEngine\(\)/);
  assert.match(worker, /message\?\.type === "INIT"[\s\S]*prewarmEngine\(\)/);
  assert.match(worker, /pendingUserGenerations > 0/);
});