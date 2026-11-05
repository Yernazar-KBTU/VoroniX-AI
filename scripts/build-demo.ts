// npm run build:demo -> dist-demo/index.html: the whole site in one file,
// with the model trained in the browser. Used for a preview without a server.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { page } from "../src/page.js";
import { loadBrain } from "../src/service.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const stub = `${root}scripts/node-stub.js`;
writeFileSync(stub, "export const readFileSync = () => { throw new Error('no files in the browser'); };\nexport const fileURLToPath = () => '';\n");
const bundle = await build({
  entryPoints: [`${root}src/browser.ts`],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  target: "es2020",
  alias: { "node:fs": stub, "node:url": stub },
  define: {
    PHRASES: JSON.stringify(readFileSync(`${root}data/phrases.tsv`, "utf8")),
    REPORT: readFileSync(`${root}reports/metrics.json`, "utf8"),
    "import.meta.url": JSON.stringify("https://voronix.local/src/"),
  },
});
const js = bundle.outputFiles[0].text;
const tag = (s: string) => s.replace(/<\/script/gi, "<\\/script");
let html = page(loadBrain());
html = html.replace('<link rel="stylesheet" href="/app.css">', `<style>${readFileSync(`${root}public/app.css`, "utf8")}</style>`);
html = html.replace('<script src="/app.js"></script>', `<script>${tag(js)}</script>\n<script>${tag(readFileSync(`${root}public/app.js`, "utf8"))}</script>`);
html = html.replace("<footer>", '<footer>Preview: this copy trains the model in your browser, the API runs on the VoroniX AI server. ');
mkdirSync(`${root}dist-demo`, { recursive: true });
writeFileSync(`${root}dist-demo/index.html`, html);
console.log(`dist-demo/index.html: ${(html.length / 1024).toFixed(0)} KB`);
