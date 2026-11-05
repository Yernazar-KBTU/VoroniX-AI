// npm run build:demo -> the whole site in one file, with the model trained and
// learning in the browser:
//   dist-demo/index.html     a normal page, for a preview without a server;
//   dist-demo/artifact.html  the same page as the body of a claude.ai artifact,
//                            where the site's own database keeps what it learns.
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
const css = ["app.css", "live.css"].map((f) => readFileSync(`${root}public/${f}`, "utf8")).join("\n");
let html = page(loadBrain(), { live: true });
// A function as the replacement, so "$'" or "$&" inside the code are not read as replacement patterns.
html = html.replace('<link rel="stylesheet" href="/app.css">', () => `<style>${css}</style>`);
html = html.replace('<script src="/app.js"></script>', () => `<script>${tag(js)}</script>\n<script>${tag(readFileSync(`${root}public/app.js`, "utf8"))}</script>`);
mkdirSync(`${root}dist-demo`, { recursive: true });
writeFileSync(`${root}dist-demo/index.html`, html);
// An artifact page is published without <html>, <head> and <body>: the platform adds them.
const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1].replace(/<meta[^>]*>\s*/g, "");
const body = /<body>([\s\S]*)<\/body>/.exec(html)![1];
writeFileSync(`${root}dist-demo/artifact.html`, `${head.trim()}\n${body.trim()}\n`);
console.log(`dist-demo/index.html and artifact.html: ${(html.length / 1024).toFixed(0)} KB`);
