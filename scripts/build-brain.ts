// npm run build:brain -> dist-brain/voronix-brain.js: the VoroniX AI brain for a
// CRM page (one script, no server). The VoroniX CRM demo loads this file.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stub = `${root}scripts/node-stub.js`;
writeFileSync(stub, "export const readFileSync = () => { throw new Error('no files in the browser'); };\nexport const fileURLToPath = () => '';\n");
let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
} catch {}
const out = await build({
  entryPoints: [`${root}src/brain-browser.ts`],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  target: "es2020",
  alias: { "node:fs": stub, "node:url": stub },
  define: {
    PHRASES: JSON.stringify(readFileSync(`${root}data/phrases.tsv`, "utf8")),
    VERSION: JSON.stringify(commit),
    "import.meta.url": JSON.stringify("https://voronix.local/src/"),
  },
});
const js = `/* VoroniX AI brain ${commit}, built from https://github.com/Yernazar-KBTU/VoroniX-AI (MIT). */\n${out.outputFiles[0].text}`;
mkdirSync(`${root}dist-brain`, { recursive: true });
writeFileSync(`${root}dist-brain/voronix-brain.js`, js);
console.log(`dist-brain/voronix-brain.js: ${(js.length / 1024).toFixed(0)} KB`);
