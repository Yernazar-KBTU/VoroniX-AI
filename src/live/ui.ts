// The live part of the VoroniX AI site: the social inbox, what the AI does
// and learns as it happens, the CRM it works in, the training queue, the
// knowledge and the storage. Plain DOM and SVG, no libraries.
import { LABELS, type Label, type Lang } from "../data.js";
import { LABEL_NAMES } from "../page.js";
import type { Brain } from "../service.js";
import { COMMAND_EXAMPLES } from "./commands.js";
import { makeService, money, serviceName, staffName, when } from "./crm.js";
import { addDays, ruleLang, ymd } from "./entities.js";
import { businessFacts } from "./knowledge.js";
import { facts } from "./memory.js";
import type { CommandPlan, Live } from "./runtime.js";
import { COLLECTIONS, type Collection } from "./store.js";
import { STREAM } from "./stream.js";
import type { Booking, ClientMemory, LiveEvent, QueueItem, Version } from "./types.js";

export interface Caps {
  kind: "site" | "memory";
  /** null: the platform did not say; writes are tried and a refusal switches the page to view-only. */
  canWrite: boolean | null;
  save?: (filename: string, data: string) => Promise<void>;
}

type Detail = Record<string, unknown>;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-GB");
};
const CH: Record<string, [string, string]> = { instagram: ["Instagram", "IG"], telegram: ["Telegram", "TG"], whatsapp: ["WhatsApp", "WA"], crm: ["Added in the CRM", "CRM"] };
const chan = (c: string) => `<i class="ch ch-${esc(c)}" title="${esc(CH[c]?.[0] ?? c)}">${esc(CH[c]?.[1] ?? c)}</i>`;
const name = (l: string) => LABEL_NAMES[l] ?? l;
const lb = (l: string, score?: number) => `<span class="lb lb-${esc(l)}">${esc(name(l))}${score !== undefined ? ` <b>${pct(score)}</b>` : ""}</span>`;
const LANG_NAME: Record<string, string> = { ru: "Russian", kk: "Kazakh", en: "English" };
const SOURCE: Record<string, string> = { client: "Proved by the conversation", operator: "Checked by a person", business: "Taught by hand", auto: "Written by the AI from business data" };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
const EXAMPLES = ["Сәлем! Ертең кешке фейдке жазылуға бола ма?", "Сколько стоит стрижка и борода?", "Can you squeeze me in tomorrow at 3pm?", "Да, первый вариант", "Есть где припарковаться?", "Не смогу прийти, отмените"];
const toggles = (on: readonly string[]) => LABELS.map((l) => `<button type="button" class="tg${on.includes(l) ? " on" : ""}" data-l="${l}">${esc(name(l))}</button>`).join("");
const picked = (box: Element | null) => [...(box?.querySelectorAll(".tg.on") ?? [])].map((b) => (b as HTMLElement).dataset.l as Label);

export function createUI(brain: Brain) {
  let live: Live | null = null;
  let caps: Caps = { kind: "memory", canWrite: null };
  let current = "";
  let ready = false;
  let failed = "";
  const st = {
    chan: "all",
    client: "",
    crm: "calendar",
    hl: [] as string[],
    day: "",
    filter: null as string[] | null,
    search: "",
    detail: "",
    plan: null as CommandPlan | null,
    planNote: "",
    playing: null as AbortController | null,
    progress: "",
    typing: "",
    loss: {} as Record<string, number[]>,
    peek: "" as string,
    wipe: 0,
  };
  let raf = 0;
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), render()));
  };
  const writable = () => caps.canWrite !== false;

  // Drawing without flicker. A box is redrawn only when its HTML changed. A list
  // keeps the DOM node of every item that did not change, so only new items
  // animate, and what a person typed or ticked inside an item stays.
  const drawn = new WeakMap<Element, string>();
  const filled = new WeakSet<Element>();
  const put = (el: Element | null, html: string): boolean => {
    if (!el || drawn.get(el) === html) return false;
    drawn.set(el, html);
    el.innerHTML = html;
    return true;
  };
  function keyed(box: HTMLElement, list: [string, string][], empty: string): boolean {
    if (!list.length) return put(box, empty);
    const seenKeys = new Map<string, number>();
    const items = list.map(([k, h]): [string, string] => {
      const n = seenKeys.get(k) ?? 0;
      seenKeys.set(k, n + 1);
      return [n ? `${k}#${n}` : k, h];
    });
    const old = new Map<string, HTMLElement>();
    for (const el of [...box.children] as HTMLElement[]) {
      if (el.dataset.k !== undefined && !old.has(el.dataset.k)) old.set(el.dataset.k, el);
      else el.remove();
    }
    drawn.delete(box);
    const keep = new Set(items.map(([k]) => k));
    for (const [k, el] of old) if (!keep.has(k)) el.remove();
    const animate = filled.has(box) && items.filter(([k]) => !old.has(k)).length <= 3;
    filled.add(box);
    let changed = false;
    items.forEach(([k, html], i) => {
      let el = old.get(k);
      if (!el || drawn.get(el) !== html) {
        const t = document.createElement("template");
        t.innerHTML = html.trim();
        const fresh = t.content.firstElementChild as HTMLElement;
        fresh.dataset.k = k;
        drawn.set(fresh, html);
        if (!el && animate) {
          fresh.classList.add("new");
          fresh.addEventListener("animationend", () => fresh.classList.remove("new"), { once: true });
        }
        el?.replaceWith(fresh);
        el = fresh;
        changed = true;
      }
      if (box.children[i] !== el) {
        box.insertBefore(el, box.children[i] ?? null);
        changed = true;
      }
    });
    return changed;
  }

  function toast(msg: string, kind = "") {
    let box = $("vx-toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "vx-toasts";
      document.body.append(box);
    }
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.remove(), 5200);
  }

  async function act<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
    try {
      const r = await p;
      if (ok) toast(ok, "good");
      return r;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "invalid_argument" && caps.canWrite === null) {
        caps.canWrite = false;
        toast("You can look, but this view cannot change the AI's data.", "bad");
      } else toast(`Could not save: ${(e as Error)?.message ?? e}`, "bad");
      schedule();
      return undefined;
    }
  }

  function header() {
    const m = $("vx-model");
    const badge = $("vx-queue-badge");
    if (!live || !ready) return;
    const s = live.stats();
    if (m) m.textContent = `model v${s.version} · ${s.vocabulary.toLocaleString("en")} features · ${s.phrases} phrases learned at work`;
    if (badge) {
      badge.hidden = !s.queue;
      badge.textContent = String(s.queue);
    }
  }

  function placeholder() {
    for (const id of ["vx-live", "vx-crm", "vx-training", "vx-knowledge", "vx-data"]) {
      const el = $(id);
      if (el && !el.dataset.mounted) el.innerHTML = failed ? `<div class="card bad">${esc(failed)}</div>` : `<div class="card loading"><span class="spin"></span>${live ? "Rebuilding the model from the saved data…" : "Connecting to the site's database…"}</div>`;
    }
  }

  function render() {
    header();
    if (!live || !ready) return placeholder();
    if (current === "live") renderLive();
    else if (current === "crm") renderCrm();
    else if (current === "training") renderTraining();
    else if (current === "knowledge") renderKnowledge();
    else if (current === "data") renderData();
  }

  function mount(id: string, html: string, bind: (el: HTMLElement) => void): HTMLElement | null {
    const el = $(id);
    if (!el) return null;
    if (!el.dataset.mounted) {
      el.dataset.mounted = "1";
      el.innerHTML = html;
      bind(el);
    }
    return el;
  }

  // ---------------------------------------------------------------- Live
  function renderLive() {
    const L = live!;
    mount(
      "vx-live",
      `<div class="lv-hero"><div><h1>VoroniX AI at work</h1><p class="lead">Messages from Instagram, Telegram and WhatsApp arrive on the left. On the right: what the AI understood, what it did in the CRM and what it learned from it, the moment it happens.</p></div><div id="lv-store"></div></div>
<div class="kpis" id="lv-kpis"></div>
<div class="lv-grid">
<div class="card lv-inbox">
<div class="lv-head"><h2>Social inbox</h2><div class="seg" id="lv-chan"><button data-c="all" class="on">All</button><button data-c="instagram">Instagram</button><button data-c="telegram">Telegram</button><button data-c="whatsapp">WhatsApp</button></div></div>
<div class="lv-body"><div class="lv-clients" id="lv-clients"></div>
<div class="lv-chat"><div class="lv-chat-head" id="lv-chat-head"></div><div class="lv-thread" id="lv-thread"></div>
<form class="lv-compose" id="lv-compose" autocomplete="off"><div class="lv-who" id="lv-who"><input id="lv-name" placeholder="New client's name" maxlength="40"><select id="lv-ch"><option value="instagram">Instagram</option><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></div>
<div class="lv-row"><input id="lv-text" placeholder="Write as the client…" maxlength="500"><button type="submit">Send</button></div>
<div class="chips" id="lv-ex">${EXAMPLES.map((e) => `<button type="button" class="chip">${esc(e)}</button>`).join("")}</div></form></div></div>
<div class="lv-play"><button id="lv-play" type="button">▶ Play the demo stream</button><select id="lv-speed" aria-label="Speed"><option value="1600">Slow</option><option value="800" selected>Normal</option><option value="200">Fast</option></select><label class="check"><input type="checkbox" id="lv-op" checked> Simulated operator answers the AI's queue</label><span id="lv-prog" class="note"></span></div>
<p class="note small">The demo stream: ${STREAM.length} clients, ${STREAM.reduce((s, d) => s + d.turns.length, 0)} messages in Russian, Kazakh and English, with words the AI has never seen («фейд», «кезек», «squeeze me in»). Each message carries its right answer, used only to measure the AI.</p>
</div>
<div class="lv-side">
<div class="card"><div class="lv-head"><h2>Learning in real time</h2></div><svg id="lv-chart" viewBox="0 0 600 230" role="img" aria-label="How often the AI understood the messages, with and without learning"></svg>
<div class="legend"><span><i class="sw on"></i>VoroniX AI, learning as it works</span><span><i class="sw off"></i>The same model, frozen</span></div><p class="note small" id="lv-chart-note"></p>
<div class="intents" id="lv-intents"></div></div>
<div class="card"><div class="lv-head"><h2>What the AI is doing</h2><span class="note small">newest first</span></div><div class="feed" id="lv-feed"></div></div>
</div></div>`,
      (el) => {
        el.querySelector("#lv-chan")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("button");
          if (!b) return;
          st.chan = b.dataset.c!;
          el.querySelectorAll("#lv-chan button").forEach((x) => x.classList.toggle("on", x === b));
          schedule();
        });
        el.querySelector("#lv-clients")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("button");
          if (!b) return;
          st.client = b.dataset.id ?? "";
          schedule();
          if (!st.client) $("lv-name")?.focus();
          else $("lv-text")?.focus();
        });
        el.querySelector("#lv-ex")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest(".chip");
          if (b) ($("lv-text") as HTMLInputElement).value = b.textContent ?? "";
        });
        el.querySelector("#lv-compose")!.addEventListener("submit", (e) => {
          e.preventDefault();
          void send();
        });
        el.querySelector("#lv-play")!.addEventListener("click", () => void play());
        el.querySelector("#lv-chat-head")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("[data-open]") as HTMLElement | null;
          if (!b) return;
          st.crm = "clients";
          st.detail = b.dataset.open!;
          location.hash = "#crm";
        });
      },
    );
    const s = L.stats();
    put(
      $("lv-store"),
      caps.kind === "site"
        ? `<span class="pill good"><i class="dot"></i>Live · saved in this site's database${caps.canWrite === false ? " · view only" : ""}</span>`
        : `<span class="pill warn"><i class="dot"></i>Preview · nothing is saved in this view</span>`,
    );
    put($("lv-kpis"), [
      [s.messages, "messages handled"],
      [s.phrases, `phrases learned at work`, `${s.bySource.client} from conversations · ${s.bySource.operator} checked by people · ${s.bySource.auto + s.bySource.business} from business data`],
      [s.bookings, "bookings in the CRM"],
      [s.clients, "clients remembered"],
      [`v${s.version}`, "model version", `${s.pending} of ${L.retrainEvery} new phrases until the next retrain`],
      [`+${(s.vocabulary - s.startVocabulary).toLocaleString("en")}`, "new features learned", `${s.startVocabulary.toLocaleString("en")} at the start, ${s.vocabulary.toLocaleString("en")} now`],
    ]
      .map(([v, t, h]) => `<div class="kpi"${h ? ` title="${esc(h)}"` : ""}><b>${esc(v)}</b><span>${esc(t)}</span>${h ? `<small>${esc(h)}</small>` : ""}</div>`)
      .join(""));

    const clients = [...L.clients.values()].filter((c) => st.chan === "all" || c.channel === st.chan).sort((a, b) => b.last - a.last);
    put(
      $("lv-clients"),
      `<button class="cl add${st.client ? "" : " on"}" data-id=""><span class="av">＋</span><span class="cl-main"><b>New client</b><small>write as someone new</small></span></button>` +
      clients
        .map((c) => {
          const last = c.history.filter((t) => t.from === "client").at(-1);
          return `<button class="cl${c.id === st.client ? " on" : ""}${st.typing === c.id ? " busy" : ""}" data-id="${esc(c.id)}"><span class="av">${esc(initials(c.name))}</span><span class="cl-main"><b>${esc(c.name)}</b><small>${esc(last?.text ?? "")}</small></span><span class="cl-meta">${chan(c.channel)}<small>${clock(c.last)}</small></span></button>`;
        })
        .join(""),
    );
    const c = st.client ? L.clients.get(st.client) : undefined;
    ($("lv-who") as HTMLElement).hidden = !!c;
    put(
      $("lv-chat-head"),
      c
        ? `<div><b>${esc(c.name)}</b> ${chan(c.channel)} <span class="note small">${esc(c.handle)} · writes in ${esc(LANG_NAME[c.lang])}</span></div><div class="facts">${facts(c, L.business)
            .slice(1, 4)
            .map((f) => `<span>${esc(f)}</span>`)
            .join("")}<button class="lnk" data-open="${esc(c.id)}">Memory card →</button></div>`
        : `<div><b>New client</b> <span class="note small">Type a name and a message, as if it came from a social network.</span></div>`,
    );
    const thread = $("lv-thread")!;
    const turns: [string, string][] = c
      ? c.history.map((t): [string, string] => [`${c.id}|${t.at}|${t.from}|${t.text.slice(0, 24)}`, `<div class="msg ${t.from}"><p>${esc(t.text)}</p>${t.labels?.length ? `<div class="msg-l">${t.labels.map((l) => lb(l)).join("")}</div>` : ""}<small>${t.from === "ai" ? "VoroniX AI · " : ""}${clock(t.at)}</small></div>`])
      : [];
    if (c && st.typing === c.id) turns.push([`${c.id}|typing`, `<div class="msg ai typing"><p><i></i><i></i><i></i></p></div>`]);
    if (keyed(thread, turns, `<div class="empty">No messages yet. Write the first one below, or play the demo stream.</div>`)) thread.scrollTop = thread.scrollHeight;
    const playBtn = $("lv-play") as HTMLButtonElement;
    playBtn.textContent = st.playing ? "■ Stop the stream" : "▶ Play the demo stream";
    playBtn.disabled = !writable();
    ($("lv-compose")!.querySelector("button[type=submit]") as HTMLButtonElement).disabled = !writable();
    $("lv-prog")!.textContent = st.progress;
    drawChart(s.stream);
    drawIntents();
    drawFeed($("lv-feed")!, L.events.slice(-40).reverse());
  }

  async function send() {
    const L = live!;
    const input = $("lv-text") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return input.focus();
    let who = st.client ? L.clients.get(st.client) : undefined;
    const nm = who?.name ?? ($("lv-name") as HTMLInputElement).value.trim();
    if (!nm) {
      toast("Give the new client a name first.");
      return $("lv-name")?.focus();
    }
    const channel = (who?.channel ?? ($("lv-ch") as HTMLSelectElement).value) as "instagram";
    who = who ?? L.clientFor(nm, channel);
    st.client = who.id;
    st.typing = who.id;
    input.value = "";
    schedule();
    await new Promise((ok) => setTimeout(ok, 450));
    const r = await act(L.receive({ name: nm, channel, text }));
    st.typing = "";
    if (r) st.client = r.client.id;
    schedule();
  }

  async function play() {
    const L = live!;
    if (st.playing) {
      st.playing.abort();
      return;
    }
    const ac = new AbortController();
    st.playing = ac;
    const total = STREAM.reduce((s, d) => s + d.turns.length, 0);
    let i = 0;
    st.progress = "Starting: the business adds its first texts and the new service «Fade»…";
    schedule();
    await act(
      L.play({
        delay: Number(($("lv-speed") as HTMLSelectElement).value),
        operator: ($("lv-op") as HTMLInputElement).checked,
        signal: ac.signal,
        onTurn: (r) => {
          i++;
          st.client = r.client.id;
          st.progress = `Message ${i} of ${total}`;
          schedule();
        },
      }),
    );
    st.playing = null;
    st.progress = ac.signal.aborted ? `Stopped after ${i} messages.` : `Done: ${i} messages.`;
    schedule();
  }

  function drawChart(stream: { ok: boolean; frozenOk: boolean }[]) {
    const svg = $("lv-chart") as unknown as SVGSVGElement;
    const note = $("lv-chart-note")!;
    const W = 600,
      H = 230,
      P = { l: 40, r: 14, t: 14, b: 26 };
    if (stream.length < 2) {
      put(svg, `<text x="300" y="115" text-anchor="middle" class="muted">Play the demo stream: every message with a known answer adds a point here</text>`);
      note.textContent = "";
      return;
    }
    const win = 12;
    const roll = (k: "ok" | "frozenOk") => stream.map((_, i) => {
      const a = stream.slice(Math.max(0, i - win + 1), i + 1);
      return a.filter((x) => x[k]).length / a.length;
    });
    const on = roll("ok");
    const off = roll("frozenOk");
    const x = (i: number) => P.l + ((W - P.l - P.r) * i) / (stream.length - 1);
    const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v);
    const path = (v: number[]) => v.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join("");
    const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" class="gl"/><text x="${P.l - 6}" y="${y(g) + 4}" text-anchor="end" class="ax">${g * 100}%</text>`).join("");
    put(svg, `<defs><linearGradient id="lvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent2)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent2)" stop-opacity="0"/></linearGradient></defs>${grid}
<path d="${path(on)}L${x(on.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="url(#lvg)"/>
<path d="${path(off)}" class="ln off"/><path d="${path(on)}" class="ln on"/>
<circle cx="${x(on.length - 1)}" cy="${y(on.at(-1)!)}" r="4.5" class="pt on"/><circle cx="${x(off.length - 1)}" cy="${y(off.at(-1)!)}" r="4" class="pt off"/>
<text x="${P.l}" y="${H - 6}" class="ax">message 1</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end" class="ax">message ${stream.length}</text>`);
    const all = (k: "ok" | "frozenOk") => stream.filter((s) => s[k]).length / stream.length;
    note.textContent = `Share of messages understood exactly right, over the last ${win} with a known answer, measured before the AI learns from each one. Now ${pct(on.at(-1)!)} vs ${pct(off.at(-1)!)} without learning; over all ${stream.length}: ${pct(all("ok"))} vs ${pct(all("frozenOk"))}.`;
  }

  let lastFlash = "";
  const latestLesson = () => [...live!.events].reverse().find((e) => e.kind === "message" || e.kind === "learn");
  function drawIntents() {
    const L = live!;
    const counts: Record<string, number> = {};
    for (const e of L.events) if (e.kind === "message") for (const l of ((e.detail?.labels as string[]) ?? [])) counts[l] = (counts[l] ?? 0) + 1;
    const box = $("lv-intents")!;
    keyed(box, LABELS.map((l) => [l, `<span class="node lb-${l}"><b>${counts[l] ?? 0}</b>${esc(name(l))}</span>`]), "");
    // The meanings of the newest message light up; a lesson glows in green.
    const fresh = latestLesson();
    if (!fresh || fresh.id === lastFlash) return;
    lastFlash = fresh.id;
    for (const l of (fresh.detail?.labels as string[]) ?? []) {
      const node = box.querySelector(`[data-k="${l}"]`) as HTMLElement | null;
      if (!node) continue;
      node.classList.remove("hit", "learned");
      void node.offsetWidth;
      node.classList.add(fresh.kind === "learn" ? "learned" : "hit");
    }
  }

  function drawFeed(box: HTMLElement, events: LiveEvent[]) {
    keyed(box, events.map((e) => [e.id, feedItem(e)]), `<div class="empty">Nothing yet. Every message, action and lesson will appear here.</div>`);
  }

  function feedItem(e: LiveEvent): string {
    const d = (e.detail ?? {}) as Detail;
    if (e.kind === "message") {
      const intents = (d.intents as { label: string; score: number }[]) ?? [];
      const truth = d.truth as string[] | undefined;
      const check = truth ? (d.ok ? `<span class="ok">✓ understood right</span>` : `<span class="no">✗ right answer: ${truth.map(name).join(" + ")}</span>`) : "";
      return `<div class="ev evm"><div class="ev-top">${chan(String(d.channel))}<b>${esc(d.name)}</b><small>${clock(e.at)}</small>${d.unsure ? `<span class="tag k-unsure">unsure</span>` : ""}</div>
<p class="ev-text">«${esc(d.text)}»</p>
<div class="ev-row"><span class="k">Understood</span>${intents.map((i) => lb(i.label, i.score)).join("")} <span class="note small">${esc(LANG_NAME[String(d.lang)] ?? "")}</span> ${check}</div>
${((d.actions as { type: string; text: string }[]) ?? []).map((a) => `<div class="ev-row"><span class="k">${a.type === "book" || a.type === "cancel" || a.type === "offer" ? "In the CRM" : a.type === "knowledge" ? "Knowledge" : a.type === "unknown" || a.type === "handoff" ? "To a person" : "Did"}</span>${esc(a.text)}</div>`).join("")}
<div class="ev-reply">${esc(d.reply)}</div>
${Number(d.learned) ? `<div class="ev-row"><span class="k">Learned</span>${d.learned} phrase${Number(d.learned) > 1 ? "s" : ""} from this conversation</div>` : ""}${((d.queued as string[]) ?? []).length ? `<div class="ev-row"><span class="k">Queue</span>asked a person to check (${(d.queued as string[]).join(", ")})</div>` : ""}</div>`;
    }
    if (e.kind === "learn") {
      const was = (d.was ?? {}) as Record<string, number>;
      const after = (d.after ?? {}) as Record<string, number>;
      const ch = (d.changes as { f: string; l: string; from: number; to: number }[]) ?? [];
      return `<div class="ev learn"><div class="ev-top"><span class="tag k-learn">learned</span><b>${esc(SOURCE[String(d.source)] ?? d.source)}</b><small>${clock(e.at)}</small></div>
<p class="ev-text">«${esc(d.text)}» → ${((d.labels as string[]) ?? []).map((l) => lb(l)).join("")}</p>
<div class="ev-row"><span class="k">Why</span>${esc(d.why)}</div>
<div class="ev-row"><span class="k">Change</span>${Object.keys(after).map((l) => `<span class="delta">${esc(name(l))}: ${pct(was[l] ?? 0)} → <b>${pct(after[l])}</b></span>`).join("")} <span class="note small">${d.steps} step${Number(d.steps) > 1 ? "s" : ""}${Number(d.newFeatures) ? `, ${d.newFeatures} new features` : ""}${d.correct ? ", it was already right" : ""}</span></div>
${ch.length ? `<div class="ev-row w"><span class="k">Weights</span>${ch.slice(0, 4).map((c) => `<span class="wt"><code>${esc(c.f)}</code> → ${esc(name(c.l))} <b class="${c.to > c.from ? "pos" : "neg"}">${c.to > c.from ? "+" : ""}${(c.to - c.from).toFixed(2)}</b></span>`).join("")}</div>` : ""}</div>`;
    }
    if (e.kind === "retrain") return `<div class="ev retrain"><div class="ev-top"><span class="tag k-${d.status === "rejected" ? "bad" : "good"}">${d.status === "rejected" ? "kept old version" : "new version"}</span><b>${esc(e.title)}</b><small>${clock(e.at)}</small></div><div class="ev-row">Trained on ${esc(d.phrases)} learned phrases plus the start phrases, tested on ${esc(d.holdout)} phrases kept aside, ${Math.round(Number(d.ms) / 100) / 10} s.</div></div>`;
    return `<div class="ev small"><div class="ev-top"><span class="tag">${esc(e.kind)}</span><b>${esc(e.title)}</b><small>${clock(e.at)}</small></div></div>`;
  }

  // ---------------------------------------------------------------- CRM
  function renderCrm() {
    const L = live!;
    mount(
      "vx-crm",
      `<h1>The CRM, run by the AI</h1><p class="lead">Bookings the AI makes in the chats appear here at once. You can also tell it what to do in plain words, in Russian, Kazakh or English: it shows what it understood and acts after you confirm.</p>
<div class="card cmd"><form id="cr-form" autocomplete="off"><input id="cr-text" maxlength="300" placeholder="For example: Запиши Алию на завтра в 15:00 на стрижку"><button type="submit">Ask the AI</button></form>
<div class="chips" id="cr-ex">${COMMAND_EXAMPLES.map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join("")}</div><div id="cr-plan"></div></div>
<div class="cr-bar"><div class="seg big" id="cr-views"><button data-v="calendar">Calendar</button><button data-v="clients">Clients and memory</button><button data-v="business">Business data</button></div><input id="cr-search" type="search" placeholder="Search clients" hidden></div>
<div id="cr-view"></div>`,
      (el) => {
        const run = () => {
          const text = ($("cr-text") as HTMLInputElement).value.trim();
          if (!text) return;
          st.plan = live!.command(text);
          st.planNote = "";
          applyShow(st.plan);
          schedule();
        };
        el.querySelector("#cr-form")!.addEventListener("submit", (e) => {
          e.preventDefault();
          run();
        });
        el.querySelector("#cr-ex")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest(".chip");
          if (!b) return;
          ($("cr-text") as HTMLInputElement).value = b.textContent ?? "";
          run();
        });
        el.querySelector("#cr-views")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("button");
          if (!b) return;
          st.crm = b.dataset.v!;
          st.filter = null;
          schedule();
        });
        el.addEventListener("click", async (e) => {
          const t = e.target as HTMLElement;
          const go = t.closest("[data-go]") as HTMLElement | null;
          if (go?.dataset.go === "confirm" && st.plan?.confirm) {
            const plan = st.plan;
            go.setAttribute("disabled", "");
            const id = await act(plan.confirm!.run());
            if (id) {
              st.hl = [id];
              st.planNote = "Done.";
              st.plan = { ...plan, confirm: undefined };
              applyShow(plan);
            }
            schedule();
          } else if (go?.dataset.go === "dismiss") {
            st.plan = null;
            schedule();
          } else if (go?.dataset.go === "all") {
            st.filter = null;
            schedule();
          }
          const row = t.closest("[data-client]") as HTMLElement | null;
          if (row) {
            st.detail = row.dataset.client!;
            schedule();
          }
        });
        el.addEventListener("input", (e) => {
          const t = e.target as HTMLInputElement;
          if (t.id === "cr-search") {
            st.search = t.value;
            schedule();
          }
        });
        el.addEventListener("submit", (e) => {
          const f = e.target as HTMLFormElement;
          if (f.id !== "cr-add") return;
          e.preventDefault();
          const n = (f.elements.namedItem("n") as HTMLInputElement).value.trim();
          const p = Number((f.elements.namedItem("p") as HTMLInputElement).value);
          const m = Number((f.elements.namedItem("m") as HTMLInputElement).value) || 60;
          if (!n || !p) return toast("Write the service's name and price.");
          void act(live!.addService(makeService(n, p, m, (ruleLang(n) ?? "en") as Lang)), `«${n}» added. The AI wrote 6 training phrases about it and learned them.`).then(() => f.reset());
        });
      },
    );
    $("cr-views")!.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === st.crm));
    const plan = st.plan;
    put($("cr-plan"), plan
      ? `<div class="plan"><div><span class="k">VoroniX AI</span> ${esc(plan.say)}</div><div class="plan-act">${plan.confirm ? `<button data-go="confirm"${writable() ? "" : " disabled"}>${esc(plan.confirm.label)}</button><button class="ghost" data-go="dismiss">Cancel</button>` : `<span class="ok">${esc(st.planNote)}</span><button class="ghost" data-go="dismiss">Close</button>`}</div><small class="note">Understood as: <code>${esc(plan.cmd.kind)}</code> ${esc(JSON.stringify({ ...plan.cmd, kind: undefined }))}</small></div>`
      : "");
    ($("cr-search") as HTMLElement).hidden = st.crm !== "clients";
    const view = $("cr-view")!;
    const changed = put(view, st.crm === "calendar" ? calendar(L) : st.crm === "clients" ? clientsView(L) : businessView(L));
    if (changed) view.querySelector(".hl")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  function applyShow(plan: CommandPlan) {
    if (!plan.show) return;
    if (plan.show.view === "knowledge") return;
    st.crm = plan.show.view;
    st.hl = plan.show.ids ?? st.hl;
    if (plan.show.view === "clients") {
      st.filter = plan.cmd.kind === "inactive" ? (plan.show.ids ?? []) : null;
      if (plan.cmd.kind === "open" && plan.show.ids?.[0]) st.detail = plan.show.ids[0];
    }
    if (plan.show.day) st.day = plan.show.day;
  }

  function calendar(L: Live): string {
    const b = L.business;
    const today = new Date();
    const all = [...L.bookings.values()];
    const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(today, i)));
    if (st.day && !days.includes(st.day)) days.push(st.day);
    return `<div class="cal">${days
      .map((d) => {
        const list = all.filter((k) => k.start.startsWith(d)).sort((x, y) => x.start.localeCompare(y.start));
        const booked = list.filter((k) => k.status === "booked");
        return `<div class="day${d === st.day ? " sel" : ""}"><div class="dh"><b>${esc(when(`${d}T00:00`, "en").split(",")[0])}</b><small>${booked.length} booking${booked.length === 1 ? "" : "s"} · ${money(b, booked.reduce((s, k) => s + k.price, 0))}</small></div>${
          list.length ? list.map((k) => bookingCard(L, k)).join("") : `<div class="empty small">Free</div>`
        }</div>`;
      })
      .join("")}</div><p class="note small">The AI checks each master's working hours and existing bookings before it offers a time, so it never offers a busy one.</p>`;
  }

  function bookingCard(L: Live, k: Booking): string {
    return `<div class="bk${st.hl.includes(k.id) ? " hl" : ""}${k.status === "cancelled" ? " off" : ""}" data-client="${esc(k.client)}"><div><b>${esc(k.start.slice(11, 16))}</b> ${esc(k.clientName)}</div><small>${esc(serviceName(L.business, k.service, "en"))} · ${esc(staffName(L.business, k.staff))}</small><div class="bk-f">${chan(k.source)}<small>${k.status === "cancelled" ? "cancelled" : money(L.business, k.price)}</small></div></div>`;
  }

  function clientsView(L: Live): string {
    const q = st.search.trim().toLowerCase();
    let list = [...L.clients.values()].sort((a, b) => b.last - a.last);
    if (st.filter) list = list.filter((c) => st.filter!.includes(c.id));
    if (q) list = list.filter((c) => `${c.name} ${c.handle}`.toLowerCase().includes(q));
    const sel = st.detail ? L.clients.get(st.detail) : undefined;
    const mood = (m: number) => (m > 0.25 ? "happy" : m < -0.25 ? "unhappy" : "neutral");
    return `${st.filter ? `<div class="banner">Showing ${st.filter.length} client${st.filter.length === 1 ? "" : "s"} found by the AI. <button class="lnk" data-go="all">Show all</button></div>` : ""}
<div class="cr-split"><div class="card table"><table><tr><th>Client</th><th>Language</th><th>Messages</th><th>Bookings</th><th>Mood</th><th>Last seen</th></tr>${
      list.map((c) => `<tr class="${c.id === st.detail ? "on" : ""}${st.hl.includes(c.id) ? " hl" : ""}" data-client="${esc(c.id)}"><td>${chan(c.channel)} <b>${esc(c.name)}</b></td><td>${esc(LANG_NAME[c.lang])}</td><td>${c.messages}</td><td>${c.bookings}</td><td><span class="mood ${mood(c.mood)}">${mood(c.mood)}</span></td><td>${ago(c.last)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No clients yet</td></tr>`
    }</table></div>${sel ? memoryCard(L, sel) : `<div class="card note">Pick a client to see what the AI remembers.</div>`}</div>`;
  }

  function memoryCard(L: Live, c: ClientMemory): string {
    const b = L.business;
    const intents = Object.entries(c.intents).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0));
    const max = Math.max(1, ...intents.map((x) => x[1] ?? 0));
    const theirs = [...L.bookings.values()].filter((k) => k.client === c.id).sort((x, y) => y.start.localeCompare(x.start));
    return `<div class="card mem"><div class="mem-top"><span class="av big">${esc(initials(c.name))}</span><div><h3>${esc(c.name)}</h3><span class="note small">${chan(c.channel)} ${esc(c.handle)} · first message ${ago(c.first)}</span></div></div>
<h4>What the AI knows</h4><div class="facts">${facts(c, b).map((f) => `<span>${esc(f)}</span>`).join("")}</div>
<h4>What they write about</h4>${intents.map(([l, n]) => `<div class="bar"><span>${esc(name(l))}</span><div class="track"><div class="fill" style="width:${((n ?? 0) / max) * 100}%"></div></div><span>${n}</span></div>`).join("") || `<p class="note">Nothing yet</p>`}
<h4>Bookings</h4>${theirs.map((k) => `<div class="mini${k.status === "cancelled" ? " off" : ""}">${esc(when(k.start, "en"))} · ${esc(serviceName(b, k.service, "en"))} · ${esc(staffName(b, k.staff))}${k.status === "cancelled" ? " · cancelled" : ""}</div>`).join("") || `<p class="note">None</p>`}
<h4>Last messages</h4>${c.history.slice(-6).map((t) => `<div class="mini ${t.from}"><b>${t.from === "ai" ? "AI" : esc(c.name.split(" ")[0])}:</b> ${esc(t.text)}</div>`).join("")}</div>`;
  }

  function businessView(L: Live): string {
    const b = L.business;
    const days = (d: number[]) => d.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(" ");
    return `<div class="card table"><h2>Services</h2><p class="note">The words in the last column are what the AI looks for in a message to know which service a client means.</p><table><tr><th>Russian</th><th>Kazakh</th><th>English</th><th>Price</th><th>Time</th><th>The AI looks for</th></tr>${b.services
      .map((s) => `<tr class="${st.hl.includes(s.id) ? "hl" : ""}"><td>${esc(s.names.ru)}</td><td>${esc(s.names.kk)}</td><td>${esc(s.names.en)}</td><td>${money(b, s.price)}</td><td>${s.minutes} min</td><td class="small">${s.stems.map((x) => `<code>${esc(x.trim())}</code>`).join(" ")}</td></tr>`)
      .join("")}</table>
<form id="cr-add" class="row-form"><input name="n" placeholder="New service, e.g. Фейд" maxlength="40"><input name="p" type="number" min="100" step="100" placeholder="Price"><input name="m" type="number" min="10" step="5" placeholder="Minutes"><button${writable() ? "" : " disabled"}>Add service</button></form>
<p class="note small">When you add a service, the AI writes 6 training phrases about it (price and booking, in three languages) and learns them on the spot. You will see them in the Training tab.</p></div>
<div class="card table"><h2>Masters</h2><table><tr><th>Name</th><th>Role</th><th>Days</th><th>Hours</th><th>Services</th></tr>${b.staff
      .map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td><td>${days(m.days)}</td><td>${m.from}–${m.to}</td><td class="small">${m.services.map((id) => esc(serviceName(b, id, "en"))).join(", ")}</td></tr>`)
      .join("")}</table></div>
<div class="card"><h2>${esc(b.name)}</h2><div class="pairs"><span>Address</span><b>${esc(b.address.en)}</b><span>Hours</span><b>Every day ${b.from}–${b.to}</b><span>Currency</span><b>${esc(b.currency)}</b></div></div>`;
  }

  // ---------------------------------------------------------------- Training
  function renderTraining() {
    const L = live!;
    mount(
      "vx-training",
      `<p class="lead">VoroniX AI learns while it works. Here you check what it was unsure about, teach it new phrases and watch new versions of the model being trained and tested. Every answer you give is learned the same second.</p>
<div class="grid2"><div class="card"><h2>Review queue <span class="count" id="tr-qn"></span></h2><p class="note">Messages the AI was unsure about, questions it could not answer yet and complaints.</p><div id="tr-queue" class="queue"></div></div>
<div class="card"><h2>Teach a phrase</h2><p class="note">Write how a client might say something and pick what it means.</p><form id="tr-teach" autocomplete="off"><input id="tr-text" maxlength="300" placeholder="For example: Ертеңге орын бар ма?"><div class="tgs" id="tr-lbs">${toggles([])}</div><button type="submit">Teach</button></form><div id="tr-res"></div></div></div>
<div class="card"><h2>Model versions</h2><div class="vr-ctl"><label>Retrain automatically every <select id="tr-every"><option>25</option><option>50</option><option>100</option></select> new phrases</label><span id="tr-pending" class="note"></span><button id="tr-retrain" type="button">Retrain now</button></div>
<p class="note small">A retrain trains two models without a fifth of the data, one on the old data and one on the new, and tests both on that fifth. The new version goes live only if it is not worse (one test phrase less still counts as equal: that much is chance). Then the final model is trained on everything.</p><div id="tr-prog"></div><div class="table" id="tr-versions"></div></div>
<div class="card"><h2>Learning log</h2><p class="note">Every phrase the AI learned at work, newest first, with the reason.</p><div id="tr-log" class="feed"></div></div>`,
      (el) => {
        el.addEventListener("click", (e) => {
          const t = e.target as HTMLElement;
          const tg = t.closest(".tg");
          if (tg) tg.classList.toggle("on");
          const b = t.closest("[data-act]") as HTMLElement | null;
          if (!b) return;
          const item = b.closest("[data-q]") as HTMLElement | null;
          const id = item?.dataset.q;
          if (!id) {
            if (b.dataset.act === "retrain") void act(live!.retrain("manual"));
            return;
          }
          b.setAttribute("disabled", "");
          if (b.dataset.act === "teach") {
            const labels = picked(item!.querySelector(".tgs"));
            if (!labels.length) return (b.removeAttribute("disabled"), toast("Pick at least one meaning."));
            void act(live!.review(id, labels), "Learned. The AI uses it from now on.");
          } else if (b.dataset.act === "answer") {
            const text = (item!.querySelector("textarea") as HTMLTextAreaElement).value.trim();
            if (!text) return (b.removeAttribute("disabled"), toast("Write the answer first."));
            void act(live!.answer(id, text), "Saved to the knowledge. The AI answers this question from now on.");
          } else if (b.dataset.act === "resolve") void act(live!.resolve(id));
          else if (b.dataset.act === "skip") void act(live!.dismiss(id));
        });
        el.querySelector("#tr-teach")!.addEventListener("submit", async (e) => {
          e.preventDefault();
          const input = $("tr-text") as HTMLInputElement;
          const labels = picked($("tr-lbs"));
          if (!input.value.trim() || !labels.length) return toast("Write a phrase and pick at least one meaning.");
          const r = await act(live!.teach(input.value.trim(), labels));
          if (!r) return;
          $("tr-res")!.innerHTML = `<div class="plan"><div><b>Learned in ${r.steps} step${r.steps > 1 ? "s" : ""}${r.newFeatures ? `, ${r.newFeatures} new feature${r.newFeatures > 1 ? "s" : ""}` : ""}.</b>${r.correct ? " It already read this phrase right; the lesson makes it surer." : ""}</div><div class="ev-row"><span class="k">Before</span>${r.before.intents.map((i) => lb(i.label, i.score)).join("")}</div><div class="ev-row"><span class="k">After</span>${labels.map((l) => lb(l, r.after[l])).join("")}</div></div>`;
          input.value = "";
          $("tr-lbs")!.querySelectorAll(".tg").forEach((x) => x.classList.remove("on"));
        });
        el.querySelector("#tr-every")!.addEventListener("change", (e) => void act(live!.setRetrainEvery(Number((e.target as HTMLSelectElement).value))));
        el.querySelector("#tr-retrain")!.setAttribute("data-act", "retrain");
      },
    );
    const queue = [...L.queue.values()].sort((a, b) => b.at - a.at);
    $("tr-qn")!.textContent = queue.length ? String(queue.length) : "";
    keyed($("tr-queue")!, queue.map((q) => [q.id, queueItem(q)]), `<div class="empty">Nothing to check. The AI puts messages here when it is not sure.</div>`);
    ($("tr-every") as HTMLSelectElement).value = String(L.retrainEvery);
    const pending = L.learner.pending;
    $("tr-pending")!.textContent = `${pending} new phrase${pending === 1 ? "" : "s"} since ${L.learner.versions.length ? "the last retrain" : "the start"}`;
    ($("tr-retrain") as HTMLButtonElement).disabled = !!L.retraining || !writable();
    const r = L.retraining;
    if (r) {
      (st.loss[r.stage] ??= []).push(r.loss);
      const stage = { old: "1 of 3 · the old data, without the test fifth", new: "2 of 3 · the new data, without the test fifth", final: "3 of 3 · the final model on everything" }[r.stage] ?? r.stage;
      const ls = st.loss[r.stage];
      const max = Math.max(...ls, 0.01);
      put($("tr-prog"), `<div class="prog"><div class="prog-top"><b>Training ${esc(stage)}</b><span>epoch ${r.epoch} of 60 · error ${r.loss.toFixed(3)}</span></div><div class="track"><div class="fill" style="width:${(r.epoch / 60) * 100}%"></div></div><svg viewBox="0 0 300 40" class="spark"><path d="${ls.map((v, i) => `${i ? "L" : "M"}${(i / 59) * 300},${38 - (v / max) * 34}`).join("")}"/></svg></div>`);
    } else {
      st.loss = {};
      put($("tr-prog"), "");
    }
    put($("tr-versions"), versionsTable(L));
    const logs = L.events.filter((e) => e.kind === "learn").slice(-30).reverse();
    drawFeed($("tr-log")!, logs);
  }

  function queueItem(q: QueueItem): string {
    const kind = { unsure: "Unsure", unanswered: "No answer yet", complaint: "Complaint" }[q.kind];
    const top = `<div class="qi-top"><span class="tag k-${q.kind}">${kind}</span>${q.channel ? chan(q.channel) : ""}<b>${esc(q.clientName ?? "")}</b><small>${clock(q.at)}</small></div><p class="qi-text">«${esc(q.text)}»</p>`;
    const off = writable() ? "" : " disabled";
    if (q.kind === "unanswered")
      return `<div class="qi" data-q="${esc(q.id)}">${top}<textarea maxlength="2000" placeholder="Your answer. The AI will give it to every client who asks this."></textarea><div class="qi-act"><button data-act="answer"${off}>Save to knowledge</button><button class="ghost" data-act="skip"${off}>Skip</button></div></div>`;
    if (q.kind === "complaint") return `<div class="qi" data-q="${esc(q.id)}">${top}<p class="note small">The AI handed this to a manager. When it is handled, the AI learns the message as a complaint.</p><div class="qi-act"><button data-act="resolve"${off}>Handled</button></div></div>`;
    return `<div class="qi" data-q="${esc(q.id)}">${top}<p class="note small">The AI's reading (${pct(q.score)} sure): ${q.guess.map((l) => esc(name(l))).join(" + ")}. Fix it if needed:</p><div class="tgs">${toggles(q.guess)}</div><div class="qi-act"><button data-act="teach"${off}>Teach this</button><button class="ghost" data-act="skip"${off}>Skip</button></div></div>`;
  }

  function versionsTable(L: Live): string {
    const vs = [...L.learner.versions].sort((a, b) => b.n - a.n);
    const row = (v: Version) => `<tr><td><b>v${v.n}</b></td><td>${ago(v.at)}</td><td>${v.phrases}</td><td><b>${pct1(v.metrics.exact)}</b></td><td>${v.prev ? `${pct1(v.prev.exact)} → <b class="${v.metrics.exact >= v.prev.exact ? "pos" : "neg"}">${v.metrics.exact >= v.prev.exact ? "+" : ""}${((v.metrics.exact - v.prev.exact) * 100).toFixed(1)}</b>` : "-"}</td><td>${pct1(v.metrics.f1)}</td><td><span class="tag k-${v.status === "live" ? "good" : v.status === "rejected" ? "bad" : "old"}">${v.status}</span></td><td class="small">${esc(v.trigger)} · ${Math.round(v.ms / 100) / 10} s</td></tr>`;
    return `<table><tr><th>Version</th><th>When</th><th>Learned phrases</th><th>Exactly right</th><th>Old data → new data</th><th>F1</th><th>Status</th><th>Why</th></tr>${vs.map(row).join("")}<tr><td><b>v0</b></td><td>start</td><td>0</td><td>${pct1(brain.report.holdout.exact_match)}</td><td>-</td><td>${pct1(brain.report.holdout.micro.f1)}</td><td><span class="tag k-${L.learner.live ? "old" : "good"}">${L.learner.live ? "old" : "live"}</span></td><td class="small">the ${L.learner.seed.length} start phrases</td></tr></table>`;
  }

  // ---------------------------------------------------------------- Knowledge
  function renderKnowledge() {
    const L = live!;
    mount(
      "vx-knowledge",
      `<h1>Knowledge</h1><p class="lead">What the business tells the AI: rules, answers to frequent questions, any text or file. A new text works the moment it is saved: the AI finds the right piece with a search index (BM25), the ranking formula search engines are built on. No retraining is needed.</p>
<div class="grid2"><div class="card"><h2>Add knowledge</h2><form id="kn-add" autocomplete="off"><input name="t" maxlength="200" placeholder="Title, e.g. Gift certificates"><textarea name="x" maxlength="60000" placeholder="The text, in any language. For example: Подарочные сертификаты от 10 000 ₸, действуют 6 месяцев."></textarea><div class="row-form"><button type="submit">Save</button><label class="file">or a file (.txt, .md, .csv, .json)<input type="file" id="kn-file" accept=".txt,.md,.csv,.json,.html,.htm,text/plain"></label></div></form>
<p class="note small">CSV with two columns (question, answer) becomes one entry per row.</p></div>
<div class="card"><h2>Ask the knowledge</h2><form id="kn-ask" autocomplete="off"><input id="kn-q" maxlength="300" placeholder="Есть парковка? / Do you sell gift cards?"><button type="submit">Search</button></form><div id="kn-res"></div></div></div>
<div class="card"><h2>Saved knowledge <span class="count" id="kn-n"></span></h2><div id="kn-list" class="kn-list"></div></div>
<div class="card"><h2>Known from the CRM data</h2><p class="note">Made from the business data automatically, always up to date.</p><div id="kn-biz" class="kn-list"></div></div>`,
      (el) => {
        el.querySelector("#kn-add")!.addEventListener("submit", (e) => {
          e.preventDefault();
          const f = e.target as HTMLFormElement;
          const t = (f.elements.namedItem("t") as HTMLInputElement).value.trim();
          const x = (f.elements.namedItem("x") as HTMLTextAreaElement).value.trim();
          if (!t || !x) return toast("Write a title and a text.");
          void act(live!.addKnowledge(t, x, "business"), "Saved. The AI already uses it.").then((r) => r && f.reset());
        });
        el.querySelector("#kn-file")!.addEventListener("change", async (e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          if (file.size > 400_000) return toast("The file is too big (more than 400 KB).", "bad");
          const items = parseFile(file.name, await file.text());
          if (!items.length) return toast("Found no text in the file.", "bad");
          for (const it of items.slice(0, 60)) await act(live!.addKnowledge(it.title, it.text, "file", file.name));
          toast(`${Math.min(items.length, 60)} entr${items.length === 1 ? "y" : "ies"} from ${file.name} saved.`, "good");
        });
        el.querySelector("#kn-ask")!.addEventListener("submit", (e) => {
          e.preventDefault();
          const q = ($("kn-q") as HTMLInputElement).value.trim();
          if (!q) return;
          const hits = live!.knowledge.search(q, 3);
          const best = live!.knowledge.answer(q);
          $("kn-res")!.innerHTML = hits.length
            ? `<p class="note small">${best ? "The AI would answer with the first one." : "Not a clear match: the AI would ask a person and put the question in the review queue."}</p>${hits.map((h, i) => `<div class="hit${i === 0 && best ? " best" : ""}"><div class="qi-top"><b>${esc(h.entry.title)}</b><small>score ${h.score}</small></div><p>${esc(h.chunk)}</p><small class="note">matched: ${h.matched.map((m) => `<code>${esc(m)}</code>`).join(" ")}</small></div>`).join("")}`
            : `<p class="note">Nothing found. A client asking this would go to the review queue.</p>`;
        });
        el.querySelector("#kn-list")!.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("[data-del]") as HTMLElement | null;
          if (b) void act(live!.removeKnowledge(b.dataset.del!), "Deleted.");
        });
      },
    );
    const list = [...L.entries].sort((a, b) => b.at - a.at);
    $("kn-n")!.textContent = String(list.length);
    const src = { business: "added by the business", operator: "an answer from the review queue", file: "from a file" } as Record<string, string>;
    put($("kn-list"), list.length
      ? list.map((k) => `<div class="kn"><div class="qi-top"><b>${esc(k.title)}</b><span class="tag">${esc(src[k.source] ?? k.source)}${k.file ? `: ${esc(k.file)}` : ""}</span><small>${ago(k.at)}</small>${writable() ? `<button class="lnk" data-del="${esc(k.id)}">Delete</button>` : ""}</div><p>${esc(k.text.length > 400 ? `${k.text.slice(0, 400)}…` : k.text)}</p></div>`).join("")
      : `<div class="empty">No texts yet. Add the answers to the questions your clients ask most.</div>`);
    put($("kn-biz"), businessFacts(L.business).map((k) => `<div class="kn"><div class="qi-top"><b>${esc(k.title)}</b></div><p>${esc(k.text)}</p></div>`).join(""));
  }

  function parseFile(file: string, text: string): { title: string; text: string }[] {
    const base = file.replace(/\.[^.]+$/, "");
    if (/\.json$/i.test(file)) {
      try {
        const data = JSON.parse(text) as unknown;
        const arr = Array.isArray(data) ? data : [data];
        return arr
          .map((o, i) => {
            const r = (o ?? {}) as Record<string, unknown>;
            const title = String(r.title ?? r.question ?? r.q ?? `${base} ${i + 1}`);
            const body = String(r.text ?? r.answer ?? r.a ?? (typeof o === "string" ? o : JSON.stringify(o)));
            return { title, text: body };
          })
          .filter((x) => x.text.trim());
      } catch {
        return [{ title: base, text }];
      }
    }
    if (/\.csv$/i.test(file)) {
      const rows = text.split(/\r?\n/).filter((l) => l.trim());
      const sep = (rows[0]?.match(/;/g)?.length ?? 0) > (rows[0]?.match(/,/g)?.length ?? 0) ? ";" : rows[0]?.includes("\t") ? "\t" : ",";
      const cells = rows.map((r) => r.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
      if (cells.every((c) => c.length >= 2)) return cells.slice(/question|вопрос|title/i.test(cells[0][0]) ? 1 : 0).map((c) => ({ title: c[0], text: c.slice(1).join(" ") }));
    }
    const plain = /\.html?$/i.test(file) ? text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : text;
    return plain.trim() ? [{ title: base, text: plain.trim() }] : [];
  }

  // ---------------------------------------------------------------- Data
  const ABOUT: Record<Collection, string> = {
    phrases: "Every phrase learned at work, with its source and reason",
    queue: "Messages waiting for a person",
    knowledge: "Texts and files from the business",
    clients: "One memory card per client, with the last 14 messages",
    bookings: "Bookings made by the AI or the staff",
    versions: "Retrains: metrics, decision, what they were trained on",
    events: "The live feed (the newest 1,500 are kept)",
    settings: "Business data and training settings",
  };

  function rowsOf(L: Live, c: Collection): unknown[] {
    switch (c) {
      case "phrases":
        return L.learner.phrases;
      case "queue":
        return [...L.queue.values()];
      case "knowledge":
        return L.entries;
      case "clients":
        return [...L.clients.values()];
      case "bookings":
        return [...L.bookings.values()];
      case "versions":
        return L.learner.versions;
      case "events":
        return L.events;
      default:
        return [{ id: "business", ...L.business }, { id: "prefs", retrainEvery: L.retrainEvery }];
    }
  }

  function renderData() {
    const L = live!;
    mount(
      "vx-data",
      `<p class="lead">Everything VoroniX AI learns at work is saved in this site's own database, one document per record. The model itself is not saved: every page rebuilds it from the saved phrases in about a second, so all pages always run the same model.</p>
<div class="pipe live"><div class="box"><b>1. Your browser</b><span>the model in memory, rebuilt from the data; the AI's logic runs here</span><em id="dt-mem"></em></div><div class="arrow">⇄</div>
<div class="box"><b>2. The site's database</b><span>8 collections, shared live by everyone who opens the site</span><em id="dt-db"></em></div><div class="arrow dim">⇢</div>
<div class="box next"><b>3. Next: our own server</b><span>the same 5 operations (read all, save, change, delete, watch) on a server database; the AI's code stays the same</span><em>planned</em></div></div>
<div class="card table"><h2>Collections</h2><div id="dt-cols"></div><div id="dt-peek"></div></div>
<div class="grid2"><div class="card"><h2>Limits</h2><div class="pairs"><span>Documents</span><b>up to 25,000 per site</b><span>One document</span><b>up to 256 KB</b><span>Live feed</span><b>the newest 1,500 events are kept</b><span>Client memory</span><b>the last 14 messages per client</b></div><p class="note small">Limits of the claude.ai site database. Anyone you share the site with can read this data, so use demo data or real data only with the clients' consent.</p></div>
<div class="card"><h2>Take the data with you</h2><p class="note">One JSON file with every collection: ready to load into a server database later.</p><div class="row-form"><button id="dt-export" type="button">Download all data (JSON)</button><button id="dt-copy" type="button" class="ghost">Copy JSON</button></div>
<h3 class="h3">Start over</h3><p class="note small">Deletes everything the AI learned and saved here: phrases, clients, bookings, knowledge, versions. The start phrases stay. This cannot be undone.</p><button id="dt-wipe" type="button" class="danger">Delete all saved data</button><span id="dt-wipe-note" class="note small"></span></div></div>`,
      (el) => {
        el.addEventListener("click", async (e) => {
          const t = e.target as HTMLElement;
          const peek = t.closest("[data-peek]") as HTMLElement | null;
          if (peek) {
            st.peek = st.peek === peek.dataset.peek ? "" : peek.dataset.peek!;
            schedule();
          }
          if (t.id === "dt-export" || t.id === "dt-copy") {
            const dump = JSON.stringify({ exported: new Date().toISOString(), site: "VoroniX AI", ...Object.fromEntries(COLLECTIONS.map((c) => [c, rowsOf(live!, c)])) }, null, 1);
            if (t.id === "dt-copy" || !caps.save) {
              await navigator.clipboard?.writeText(dump).then(
                () => toast("Copied to the clipboard.", "good"),
                () => toast("The browser did not allow copying.", "bad"),
              );
            } else await caps.save(`voronix-ai-data-${ymd(new Date())}.json`, dump).catch(() => toast("The download was not saved.", "bad"));
          }
          if (t.id === "dt-wipe") {
            if (st.wipe === 0) {
              st.wipe = 1;
              t.textContent = "Click again to delete everything";
              setTimeout(() => {
                if (st.wipe === 1) {
                  st.wipe = 0;
                  t.textContent = "Delete all saved data";
                }
              }, 5000);
              return;
            }
            st.wipe = 2;
            t.setAttribute("disabled", "");
            await wipe();
            st.wipe = 0;
            t.removeAttribute("disabled");
            t.textContent = "Delete all saved data";
          }
        });
      },
    );
    const sizes = COLLECTIONS.map((c) => {
      const rows = rowsOf(L, c);
      return { c, n: rows.length, kb: new TextEncoder().encode(JSON.stringify(rows)).length / 1024 };
    });
    const total = sizes.reduce((s, x) => s + x.n, 0);
    $("dt-mem")!.textContent = `${L.learner.model.vocabularySize.toLocaleString("en")} features × 13 rows = ${(L.learner.model.weightCount / 1e6).toFixed(2)} M numbers`;
    $("dt-db")!.textContent = caps.kind === "site" ? `${total.toLocaleString("en")} documents, ${sizes.reduce((s, x) => s + x.kb, 0).toFixed(0)} KB` : "not connected in this view";
    put($("dt-cols"), `<table><tr><th>Collection</th><th>What is inside</th><th>Documents</th><th>Size</th><th></th></tr>${sizes
      .map((x) => `<tr><td><code>${x.c}</code></td><td>${esc(ABOUT[x.c])}</td><td>${x.n}</td><td>${x.kb < 1 ? "<1" : x.kb.toFixed(0)} KB</td><td><button class="lnk" data-peek="${x.c}">${st.peek === x.c ? "Hide" : "Look inside"}</button></td></tr>`)
      .join("")}</table>`);
    put($("dt-peek"), st.peek ? `<p class="note small">The 3 newest documents of <code>${st.peek}</code>, exactly as saved:</p><pre class="peek">${esc(JSON.stringify(rowsOf(L, st.peek as Collection).slice(-3).reverse(), null, 2))}</pre>` : "");
    ($("dt-wipe") as HTMLButtonElement).hidden = !writable();
  }

  async function wipe() {
    const L = live!;
    const note = $("dt-wipe-note")!;
    let n = 0;
    for (const c of COLLECTIONS) {
      const rows = await L.store.all(c);
      for (const r of rows) {
        await L.store.remove(c, r.id).catch(() => {});
        n++;
        if (n % 10 === 0) {
          note.textContent = `Deleted ${n}…`;
          await new Promise((ok) => setTimeout(ok, 30));
        }
      }
    }
    note.textContent = `Deleted ${n} documents. Reloading…`;
    setTimeout(() => location.reload(), 900);
  }

  function attach(l: Live, c: Caps) {
    live = l;
    caps = c;
    l.on("ready", () => {
      ready = true;
      lastFlash = latestLesson()?.id ?? "";
      schedule();
    });
    l.on("change", schedule);
    l.on("progress", schedule);
    l.on("learned", schedule);
    schedule();
  }

  return {
    show(name: string) {
      current = name;
      render();
    },
    attach,
    error(msg: string) {
      failed = msg;
      toast(msg, "bad");
      if (!ready) placeholder();
    },
  };
}
