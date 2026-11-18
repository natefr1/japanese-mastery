// Copies the kuromoji (IPADIC) dictionary into public/ so the coverage checker works offline.
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/@patdx/kuromoji/dict";
const dst = "public/kuromoji";
if (!existsSync(src)) {
  console.error("kuromoji dictionary not found; run npm install");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("kuromoji dictionary copied to", dst);
