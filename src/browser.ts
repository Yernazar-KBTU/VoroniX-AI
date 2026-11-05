// Browser version of the VoroniX AI site. The model is trained right here, in
// the visitor's browser. On claude.ai the site has its own database, so what
// the AI learns at work is saved and every open page sees it live; anywhere
// else it still works, but forgets everything on reload.
import { CRM_CHANNEL, type CrmLiveMessage } from "./crm-brain.js";
import type { Report } from "./evaluate.js";
import { Live } from "./live/runtime.js";
import { ServerStore } from "./live/server-store.js";
import { MemoryStore, SiteStore, type Store } from "./live/store.js";
import { createUI, type Caps } from "./live/ui.js";
import { loadBrain } from "./service.js";

declare const PHRASES: string;
declare const REPORT: Report;

type Use = (name: string) => Promise<unknown>;
const w = window as unknown as { claude?: { use?: Use }; VXUI?: unknown };
const brain = loadBrain({ text: PHRASES, report: REPORT });
const ui = createUI(brain);
w.VXUI = ui;
let live: Live | null = null;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const real = window.fetch.bind(window);
// The site's own requests (/v1/..., /demo/...) are answered here, by the model that is learning.
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const path = url.pathname.replace(/^.*?(\/(v1|demo)\/)/, "$1");
  // Only this site's own API: the data server (another address) is a real call.
  if (url.origin !== location.origin || !/^\/(v1|demo)\//.test(path)) return real(input, init);
  const model = live?.learner.model ?? brain.model;
  if (path === "/v1/model") return json({ ...brain.info, quality: brain.report });
  if (path === "/v1/training") return json(brain.training());
  if (path === "/v1/dataset") return json({ phrases: brain.examples });
  if (path === "/v1/storage") return json(brain.storage());
  if (path === "/v1/network") return json(brain.network(Number(url.searchParams.get("limit")) || undefined, model));
  const text = JSON.parse(String(init?.body ?? "{}")).text;
  if (typeof text !== "string" || !text.trim() || text.length > 1000) return json({ error: "Write a message of 1 to 1000 characters." }, 400);
  if (path.endsWith("/explain")) return json({ model: brain.info.name, text, labels: brain.info.labels, lang: model.predict(text).lang, ...model.explain(text) });
  if (path.endsWith("/classify")) return json({ model: brain.info.name, text, ...model.predict(text) });
  return json({ error: "Not found" }, 404);
};

function serverConfig(): { url: string; key: string } | null {
  const h = new URLSearchParams(location.hash.slice(1));
  try {
    if (h.get("data") && h.get("key")) {
      localStorage.setItem("vx-data", JSON.stringify({ url: h.get("data"), key: h.get("key") }));
      history.replaceState(null, "", location.pathname + location.search);
    }
    const saved = JSON.parse(localStorage.getItem("vx-data") ?? "null") as { url?: string; key?: string } | null;
    return saved?.url && saved.key ? { url: saved.url, key: saved.key } : null;
  } catch {
    return null;
  }
}

async function boot() {
  const use = w.claude?.use?.bind(w.claude);
  const get = async (name: string) => (use ? await use(name).catch(() => null) : null);
  const [db, downloads, user] = await Promise.all([get("db"), get("downloads"), get("user")]);
  const caps: Caps = { kind: db ? "site" : "memory", canWrite: null };
  const u = user as { can?: (n: string) => boolean | null | Promise<boolean | null> } | null;
  if (u?.can) caps.canWrite = await Promise.resolve(u.can("data.write")).catch(() => null);
  const dl = downloads as { save?: (f: { filename: string; data: string }) => Promise<unknown> } | null;
  if (dl?.save) caps.save = (filename: string, data: string) => dl.save!({ filename, data }).then(() => undefined);
  // Connected to the AI on a server (the CRM's AI): #data=<data server>&key=<vxd_...> once, then remembered.
  const server = serverConfig();
  if (server) Object.assign(caps, { kind: "site", server: true });
  const store: Store = server ? new ServerStore({ url: server.url, key: server.key, onError: (e) => ui.error(`Data server: ${e.message}`) }) : db ? new SiteStore(db as ConstructorParameters<typeof SiteStore>[0], (e) => ui.error(e.code === "quota_exceeded" ? "The site's database is full. Delete old data in Data & storage." : `Could not save: ${e.message}`)) : new MemoryStore();
  live = new Live(store, brain.examples, undefined, brain.model);
  ui.attach(live, caps);
  await live.start();
  // The CRM page (same site address, another tab) tells us about every message it answers.
  if (typeof BroadcastChannel !== "undefined") {
    const L = live;
    new BroadcastChannel(CRM_CHANNEL).onmessage = (e: MessageEvent) => {
      const m = e.data as CrmLiveMessage | null;
      if (m?.v === 1 && m.type === "message" && m.processed) void L.fromCrm(m).catch((err) => console.error(err));
    };
  }
}

boot().catch((e) => ui.error(`VoroniX AI could not start: ${e instanceof Error ? e.message : String(e)}`));
