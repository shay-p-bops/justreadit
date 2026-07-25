import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, normaliseText } from "../src/text.js";

test("normaliseText cleans whitespace without flattening paragraphs", () => {
  assert.equal(normaliseText("  Hello   world\n\n  Next line  "), "Hello world\n\nNext line");
});

test("chunkText keeps short sentences together", () => {
  assert.deepEqual(chunkText("Hello world. This is short.", 80), ["Hello world. This is short."]);
});

test("chunkText splits long text below the limit", () => {
  const input = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const chunks = chunkText(input, 90);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 90));
  assert.equal(chunks.join(" "), input);
});
