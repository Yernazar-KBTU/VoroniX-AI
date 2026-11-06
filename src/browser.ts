// Browser version of the VoroniX AI site. The model is trained right here, in
// the visitor's browser. On claude.ai the site has its own database, so what
// the AI learns at work is saved and every open page sees it live; anywhere
// else it still works, but forgets everything on reload.
import { AI_RECENT, CRM_CHANNEL, CRM_RECENT, type AiSiteMessage, type CrmLiveMessage } from "./crm-brain.js";
import { serviceName, staffName } from "./live/crm.js";
import type { Outcome } from "./live/agent.js";
import type { Report } from "./evaluate.js";
import { Live } from "./live/runtime.js";
import { ServerStore } from "./live/server-store.js";
import { LocalStore, MemoryStore, SiteStore, type Store } from "./live/store.js";
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

function hasLocalStorage(): boolean {
  try {
    localStorage.setItem("vx-probe", "1");
    localStorage.removeItem("vx-probe");
    return true;
  } catch {
    return false;
  }
}

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
  // On the team's own site (GitHub Pages) the CRM page and this page share one database in this browser.
  const shared = !server && !db && hasLocalStorage();
  if (shared) caps.kind = "site";
  if (server) Object.assign(caps, { kind: "site", server: true });
  const store: Store = server ? new ServerStore({ url: server.url, key: server.key, onError: (e) => ui.error(`Data server: ${e.message}`) }) : db ? new SiteStore(db as ConstructorParameters<typeof SiteStore>[0], (e) => ui.error(e.code === "quota_exceeded" ? "The site's database is full. Delete old data in Data & storage." : `Could not save: ${e.message}`)) : shared ? new LocalStore() : new MemoryStore();
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
  // Messages the CRM answered while this page was closed (the CRM keeps the last ones).
  // The same list is also the second way in while this page is open: some browsers
  // (or a CRM tab loaded before an update) do not deliver the channel message.
  if (shared && typeof window !== "undefined") {
    const L = live;
    window.addEventListener("storage", (e: StorageEvent) => {
      if (e.key !== CRM_RECENT || !e.newValue) return;
      try {
        for (const m of JSON.parse(e.newValue) as CrmLiveMessage[]) if (m?.v === 1 && m.processed) void L.fromCrm(m).catch((err) => console.error(err));
      } catch (err) {
        console.error(err);
      }
    });
  }
  // Messages this page answers itself go to the CRM page too (same browser): it shows them as test chats.
  if (shared) {
    const L = live;
    L.on("handled", (d) => {
      const { at, input, outcome } = d as { at: number; input: { name: string; channel: string; text: string }; outcome: Outcome };
      const b = outcome.booking ?? outcome.cancelled;
      const m: AiSiteMessage = {
        id: `ai-${at}-${Math.random().toString(36).slice(2, 6)}`,
        at,
        client: outcome.client.id,
        name: outcome.client.name || input.name,
        channel: input.channel,
        text: input.text,
        reply: outcome.reply,
        lang: outcome.lang,
        intents: outcome.prediction.intents.map((i) => ({ label: i.label, score: Math.round(i.score * 100) / 100 })),
        unsure: outcome.unsure,
        ...(b ? { booking: { id: b.id, serviceId: b.service, staffId: b.staff, service: serviceName(L.business, b.service, "ru"), staff: staffName(L.business, b.staff), start: b.start, minutes: b.minutes, price: b.price, cancelled: b.status === "cancelled" } } : {}),
      };
      try {
        const list = JSON.parse(localStorage.getItem(AI_RECENT) ?? "[]") as AiSiteMessage[];
        list.push(m);
        localStorage.setItem(AI_RECENT, JSON.stringify(list.slice(-80)));
      } catch (e) {
        console.error("The CRM page was not told about the message", e);
      }
    });
  }
  if (shared) {
    try {
      const recent = JSON.parse(localStorage.getItem(CRM_RECENT) ?? "[]") as CrmLiveMessage[];
      for (const m of recent) if (m?.v === 1 && m.processed) await live.fromCrm(m, { quiet: true });
    } catch (e) {
      console.error(e);
    }
  }
}

boot().catch((e) => ui.error(`VoroniX AI could not start: ${e instanceof Error ? e.message : String(e)}`));
