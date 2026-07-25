import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_FILES = ["package.json", "public/manifest.json"];
const ZERO_SHA = /^0+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const packageJson = await readJson("package.json");
const manifest = await readJson("public/manifest.json");
validateSynchronizedVersions({ packageJson, manifest });

const baseRef = await resolveBaseRef();
if (!baseRef) {
  console.log("Version contract passed: release metadata is synchronized (no Git base available for change classification).");
  process.exit(0);
}

const changedFiles = new Set([
  ...await gitLines(["diff", "--name-only", `${baseRef}...HEAD`, "--"]),
  ...await gitLines(["diff", "--name-only", "HEAD", "--"])
]);
const productFiles = [...changedFiles].filter(isProductFile);
if (productFiles.length === 0) {
  console.log("Version contract passed: no release-sensitive product files changed.");
  process.exit(0);
}

const missingReleaseFiles = RELEASE_FILES.filter((file) => !changedFiles.has(file));
if (missingReleaseFiles.length > 0) {
  throw new Error(
    `Product changes require a synchronized version increment. Missing from the change set: ${missingReleaseFiles.join(", ")}. `
      + "Run `npm run version:bump -- patch` before validation."
  );
}

const baseManifest = await readJsonFromGit(baseRef, "public/manifest.json");
if (!baseManifest || !isGreaterSemver(manifest.version, baseManifest.version)) {
  throw new Error(
    `Product changes require a semantic version increment above ${baseManifest?.version ?? "the base version"}; current version is ${manifest.version}. `
      + "Run `npm run version:bump -- patch` unless the change requires a minor or major release."
  );
}

console.log(`Version contract passed: ${baseManifest.version} -> ${manifest.version} for ${productFiles.length} release-sensitive file(s).`);

async function resolveBaseRef() {
  const configured = process.env.JUST_READ_IT_VERSION_BASE?.trim();
  if (configured && !ZERO_SHA.test(configured) && await gitRefExists(configured)) return configured;
  if (await gitRefExists("HEAD^")) return "HEAD^";
  return await gitRefExists("HEAD") ? "HEAD" : null;
}

async function gitRefExists(ref) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

async function gitLines(args) {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf8" });
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonFromGit(ref, path) {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function validateSynchronizedVersions({ packageJson, manifest }) {
  const version = manifest.version;
  if (!SEMVER.test(version)) throw new Error(`public/manifest.json contains an invalid semantic version: ${version}`);
  if (packageJson.version !== version) {
    throw new Error(`Release versions are out of sync with public/manifest.json ${version}: package.json=${String(packageJson.version)}`);
  }
}

function isProductFile(path) {
  if (path.startsWith("src/") && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  return path.startsWith("public/")
    || path === "package.json"
    || path === "scripts/build.mjs";
}

function isGreaterSemver(candidate, base) {
  const next = parseSemver(candidate);
  const previous = parseSemver(base);
  if (!next || !previous) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

function parseSemver(value) {
  const match = SEMVER.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}
