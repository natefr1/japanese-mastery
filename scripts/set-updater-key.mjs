// Writes the updater public key and GitHub endpoint into tauri.conf.json (UTF-8, no BOM).
// Usage: node scripts/set-updater-key.mjs <path-to-key.pub> <owner/repo>
import { readFileSync, writeFileSync } from "node:fs";
const [, , pubPath, repo] = process.argv;
if (!pubPath || !repo) {
  console.error("Usage: node scripts/set-updater-key.mjs <key.pub> <owner/repo>");
  process.exit(1);
}
const file = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(file, "utf8"));
conf.plugins ??= {};
conf.plugins.updater ??= {};
conf.plugins.updater.pubkey = readFileSync(pubPath, "utf8").trim();
conf.plugins.updater.endpoints = [`https://github.com/${repo}/releases/latest/download/latest.json`];
conf.plugins.updater.windows ??= { installMode: "passive" };
writeFileSync(file, JSON.stringify(conf, null, 2) + "\n");
console.log(`Updater configured for ${repo}.`);
