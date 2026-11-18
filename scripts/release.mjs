// Usage:  npm run release 0.3.0 -- "What changed (optional, Markdown)"
// Bumps the version everywhere, commits, tags v<version> and pushes.
// GitHub Actions then builds, signs and publishes the update.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const [, , version, ...notesParts] = process.argv;
const notes = notesParts.join(" ").trim();

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release <major.minor.patch> -- "release notes"');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = pkg.version;
const cmp = (a, b) => a.split(".").map(Number).reduce((r, x, i) => r || x - Number(b.split(".")[i]), 0);
const tagExists = sh(`git tag --list v${version}`) !== "";
if (tagExists) {
  console.error(`v${version} is already released.`);
  process.exit(1);
}
if (cmp(version, current) < 0) {
  console.error(`v${version} is lower than the current version v${current}.`);
  process.exit(1);
}
if (sh("git status --porcelain")) {
  console.error("Commit or stash your changes first (git status is not clean).");
  process.exit(1);
}
if (sh("git config --get remote.origin.url") === "") {
  console.error("No GitHub remote. Run scripts/setup-updater.ps1 first.");
  process.exit(1);
}
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (!conf.plugins?.updater?.pubkey || conf.plugins.updater.pubkey.includes("NOT_SET")) {
  console.error("The updater public key isn't set. Run scripts/setup-updater.ps1 first.");
  process.exit(1);
}

// Bump versions (package.json, tauri.conf.json, Cargo workspace).
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
conf.version = version;
writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(conf, null, 2) + "\n");
const cargo = readFileSync("Cargo.toml", "utf8").replace(/(\[workspace\.package\][^[]*?version\s*=\s*")[^"]+(")/, `$1${version}$2`);
writeFileSync("Cargo.toml", cargo);
writeFileSync("RELEASE_NOTES.md", (notes || `Japanese Mastery v${version}`) + "\n");

try {
  execSync("cargo update -w", { stdio: "inherit" });
} catch {
  console.warn("cargo not found; Cargo.lock will be refreshed by the build.");
}
execSync("npm install --package-lock-only --no-audit --no-fund", { stdio: "inherit" });

execSync(`git add -A && git commit -m "Release v${version}" && git tag v${version} && git push && git push origin v${version}`, { stdio: "inherit", shell: true });
const url = sh("git config --get remote.origin.url").replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
console.log(`\nTagged v${version}. GitHub is building it now (about 10–15 min):\n  ${url}/actions\nWhen it's done, the app will offer the update.`);
