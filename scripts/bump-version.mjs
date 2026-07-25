import { readFile, writeFile } from "node:fs/promises";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const requested = process.argv[2] ?? "patch";
const packageJson = await readJson("package.json");
const manifest = await readJson("public/manifest.json");
const current = parseSemver(packageJson.version);
if (!current) throw new Error(`package.json contains an invalid semantic version: ${packageJson.version}`);
if (manifest.version !== packageJson.version) {
  throw new Error(`Release versions are out of sync: package.json=${packageJson.version}, public/manifest.json=${manifest.version}`);
}

const nextVersion = SEMVER.test(requested) ? requested : increment(current, requested);
if (!nextVersion) throw new Error("Usage: npm run version:bump -- [patch|minor|major|x.y.z]");
if (!isGreater(nextVersion, packageJson.version)) {
  throw new Error(`The requested version ${nextVersion} must be greater than ${packageJson.version}`);
}

packageJson.version = nextVersion;
manifest.version = nextVersion;
await Promise.all([
  writeJson("package.json", packageJson),
  writeJson("public/manifest.json", manifest)
]);
console.log(`Just Read It version bumped: ${current.join(".")} -> ${nextVersion}`);

function increment([major, minor, patch], release) {
  if (release === "patch") return `${major}.${minor}.${patch + 1}`;
  if (release === "minor") return `${major}.${minor + 1}.0`;
  if (release === "major") return `${major + 1}.0.0`;
  return null;
}

function parseSemver(value) {
  const match = SEMVER.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

function isGreater(candidate, base) {
  const next = parseSemver(candidate);
  const previous = parseSemver(base);
  if (!next || !previous) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
