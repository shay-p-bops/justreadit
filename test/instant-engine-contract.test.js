import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Instant mode is the local low-latency default", async () => {
  const [background, popup, manifest] = await Promise.all([
    readFile(new URL("../src/background.js", import.meta.url), "utf8"),
    readFile(new URL("../public/popup.html", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.json", import.meta.url), "utf8").then(JSON.parse)
  ]);

  assert.ok(manifest.permissions.includes("tts"));
  assert.match(popup, /<option value="system">Instant · system voice<\/option>/);
  assert.match(background, /chrome\.storage\.local\.get\(\{ engine: SYSTEM_ENGINE/);
  assert.match(background, /voice\.remote !== true/);
  assert.match(background, /chrome\.tts\.speak\(/);
  assert.match(background, /case "seek"[\s\S]*startSystemReading/);
});