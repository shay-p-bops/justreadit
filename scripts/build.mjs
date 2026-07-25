import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: "browser",
  target: "chrome116",
  mainFields: ["browser", "module", "main"],
  define: {
    global: "globalThis",
    "process.env.NODE_ENV": '"production"'
  },
  logLevel: "info"
};

await build({
  ...shared,
  entryPoints: {
    background: join(root, "src/background.js"),
    offscreen: join(root, "src/offscreen.js"),
    popup: join(root, "src/popup.js")
  },
  outdir: dist,
  format: "esm"
});

await build({
  ...shared,
  entryPoints: { content: join(root, "src/content.js") },
  outdir: dist,
  format: "iife"
});

await cp(join(root, "public"), dist, { recursive: true });

const require = createRequire(import.meta.url);
const wasmSource = dirname(require.resolve("onnxruntime-web"));
const wasmTarget = join(dist, "wasm");
await mkdir(wasmTarget, { recursive: true });

for (const entry of await readdir(wasmSource, { withFileTypes: true })) {
  if (entry.isFile() && /^ort-wasm.*\.(wasm|mjs)$/.test(entry.name)) {
    await cp(join(wasmSource, entry.name), join(wasmTarget, entry.name));
  }
}

console.log(`Built extension in ${dist}`);
