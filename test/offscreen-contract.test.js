import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offscreen document only uses the runtime extension API", async () => {
  const source = await readFile(new URL("../src/offscreen.js", import.meta.url), "utf8");
  const apiNames = [...new Set(
    [...source.matchAll(/\bchrome\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
  )].sort();

  assert.deepEqual(apiNames, ["runtime"]);
});
