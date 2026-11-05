// The real-time view: one message through VoroniX AI, drawn while it is
// computed. Left to right: the words, the features cut from them, every
// weight that carries a feature's vote to an intent or a language, the
// scores, the decision and the action. A lesson runs right to left: the
// error goes back along the lines and the weights change.
// Every number comes from IntentModel.forward(), the same arithmetic as
// predict(). Canvas 2D: the lines are drawn once per scene into layers, and
// each frame only reveals them and moves the pulses.
import { LABELS, LANGS, type Label, type Lang } from "../data.js";
import type { Forward } from "../model.js";
import { LABEL_NAMES } from "../page.js";

export interface Scene {
  kind: "message" | "lesson" | "example";
  text: string;
  /** Who wrote it, or what the lesson came from. */
  who: string;
  /** The pass that is drawn (for a lesson: before learning). */
  fwd: Forward;
  /** Lesson only: the same phrase after learning. */
  after?: Forward;
  /** Message: the intents the model itself picked. Lesson: the intents it learns. */
  picked: Label[];
  /** Message: intents the dialog rules added (for example «Иә» while choosing a time means agrees). */
  added?: Label[];
  lang: Lang;
  unsure?: boolean;
  truth?: { ok: boolean; labels: Label[] };
  actions?: { type: string; text: string }[];
  reply?: string;
  why?: string;
  steps?: number;
  newFeatures?: number;
  ms?: { model: number; agent: number };
}

export type Speed = "slow" | "normal" | "fast" | "rapid";
export const SPEEDS: [Speed, string][] = [
  ["slow", "Slow motion"],
  ["normal", "Normal"],
  ["fast", "Fast"],
  ["rapid", "Very fast"],
];
const UNIT: Record<Speed, number> = { slow: 1500, normal: 800, fast: 320, rapid: 70 };
/** Pause between demo-stream messages while the view is not on screen (it cannot say when it is done). */
export const STREAM_DELAY: Record<Speed, number> = { slow: 3000, normal: 1600, fast: 800, rapid: 300 };

type Stage = "read" | "cut" | "weigh" | "decide" | "act" | "recall" | "error" | "update" | "hold";
const MESSAGE: [Stage, number][] = [["read", 0.6], ["cut", 0.8], ["weigh", 1.6], ["decide", 0.9], ["act", 0.9], ["hold", 1.3]];
const LESSON: [Stage, number][] = [["recall", 0.7], ["error", 1.2], ["update", 1.4], ["hold", 1.1]];
const PILLS: Record<"message" | "lesson", [Stage, string][]> = {
  message: [["read", "1 · Message"], ["cut", "2 · Features"], ["weigh", "3 · Weights"], ["decide", "4 · Scores"], ["act", "5 · Action"]],
  lesson: [["recall", "1 · The phrase"], ["error", "2 · The error goes back"], ["update", "3 · Weights change"]],
};

type Kind = "word" | "pair" | "start" | "piece" | "other";
const kindOf = (f: string): Kind => (f.startsWith("w:") ? "word" : f.startsWith("b:") ? "pair" : f.startsWith("p:") ? "start" : f.startsWith("c:") ? "piece" : "other");
const KIND_COLOR: Record<Kind, string> = { word: "#8fdcff", pair: "#c9a2ff", start: "#ffd27a", piece: "#7ff7d4", other: "#a9b3d6" };
const KIND_NAME: Record<Kind, string> = { word: "word", pair: "pair of words", start: "start of a word", piece: "piece of letters", other: "length of the message" };
/** A feature as people read it: «сто…» starts a word, «…ет» ends one, a pair keeps its space. */
const shown = (f: string) => {
  const t = f.replace(/^[wbpc]:/, "").replace(/_/g, " ");
  if (f.startsWith("p:")) return `${t}…`;
  if (!f.startsWith("c:")) return t;
  const core = t.replace(/^</, "").replace(/>$/, "");
  return t.startsWith("<") && t.endsWith(">") ? core : t.startsWith("<") ? `${core}…` : t.endsWith(">") ? `…${core}` : core;
};
const LANG_NAMES: Record<Lang, string> = { ru: "Russian", kk: "Kazakh", en: "English" };
const SHORT: Record<string, string> = { greeting: "Hi", price: "Price", booking: "Book", cancel: "Cancel", complaint: "Complaint", address: "Address", hours: "Hours", confirm: "Agrees", thanks: "Thanks", other: "Other", ru: "RU", kk: "KZ", en: "EN" };
const nameOf = (l: string) => LABEL_NAMES[l] ?? LANG_NAMES[l as Lang] ?? l;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const sgn = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const sig = (z: number) => 1 / (1 + Math.exp(-z));
function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** A soft round glow in one colour, drawn once and reused (colours are #rrggbb). */
const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, `${color}cc`);
    rg.addColorStop(0.4, `${color}44`);
    rg.addColorStop(1, `${color}00`);
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    sprites.set(color, c);
  }
  return c;
}

type ActKey = "reply" | "crm" | "knowledge" | "person";
const ACTS: { key: ActKey; name: string; letter: string }[] = [
  { key: "reply", name: "Reply", letter: "R" },
  { key: "crm", name: "CRM", letter: "C" },
  { key: "knowledge", name: "Knowledge", letter: "K" },
  { key: "person", name: "A person", letter: "P" },
];
// answer: prices, address and hours read from the CRM; ask: a question back, the reply alone.
const ACT_OF: Record<string, ActKey> = { offer: "crm", book: "crm", cancel: "crm", answer: "crm", knowledge: "knowledge", unknown: "person", handoff: "person" };

/** The intents a set of scores means, by the same rule as IntentModel.predict(). */
export function picks(score: number[]): Label[] {
  let out = LABELS.filter((_, k) => score[k] >= 0.5);
  if (out.length > 1) out = out.filter((l) => l !== "other");
  if (!out.length) {
    const k = score.indexOf(Math.max(...score));
    out = [score[k] >= 0.3 ? LABELS[k] : "other"];
  }
  return out;
}

/** The numbers a scene shows, straight from the forward pass. Used by the panel and by the tests. */
export function facts(s: Scene) {
  const f = s.fwd;
  const kinds: Record<Kind, number> = { word: 0, pair: 0, start: 0, piece: 0, other: 0 };
  for (const x of f.features) kinds[kindOf(x.f)]++;
  const known = f.features.filter((x) => x.index !== null).length;
  const intents = LABELS.map((label, k) => ({ label, bias: f.intent.bias[k], sum: f.intent.z[k] - f.intent.bias[k], z: f.intent.z[k], score: f.intent.score[k] })).sort((a, b) => b.score - a.score);
  const langs = LANGS.map((lang, k) => ({ lang, z: f.lang.z[k], p: f.lang.p[k] })).sort((a, b) => b.p - a.p);
  const knownFeats = f.features.filter((x) => x.index !== null);
  const votes = (label: Label) =>
    knownFeats
      .map((x, j) => ({ f: x.f, v: f.intent.contrib[LABELS.indexOf(label)][j] }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  return { features: f.features.length, kinds, known, unknown: f.features.length - known, lines: known * (LABELS.length + LANGS.length), scale: f.scale, intents, langs, votes };
}

interface Feat {
  f: string;
  kind: Kind;
  y: number;
  word: number;
  /** Column of this feature in fwd's votes (-1: unknown to the model then). */
  jb: number;
  /** Column in after's votes (lessons). */
  ja: number;
}
interface Out {
  head: "intent" | "lang";
  k: number;
  key: string;
  y: number;
}
interface Act {
  key: ActKey;
  name: string;
  letter: string;
  y: number;
}
interface Layout {
  wx: number;
  fx: number;
  ox: number;
  ax: number;
  words: { text: string; y: number }[];
  feats: Feat[];
  outs: Out[];
  acts: Act[];
  narrow: boolean;
  r: number;
  gap: number;
}
interface Pulse {
  f: Feat;
  o: Out;
  v: number;
  n: number;
  phase: number;
}

function layout(s: Scene, W: number, H: number): Layout {
  const narrow = W < 640;
  const wx = narrow ? 8 : Math.max(14, W * 0.025);
  const fx = W * (narrow ? 0.44 : 0.38);
  const ox = W * (narrow ? 0.79 : 0.71);
  const ax = W * (narrow ? 0.95 : 0.885);
  const top = 42;
  const bottom = H - 16;
  const fs = s.fwd.features;
  const after = s.after?.features;
  let jb = 0;
  let ja = 0;
  const words: { text: string; y: number }[] = [];
  const feats: Feat[] = fs.map((x, i) => {
    const kind = kindOf(x.f);
    if (kind === "word" || !words.length) words.push({ text: kind === "word" ? x.f.slice(2) : "·", y: 0 });
    const a = after?.[i];
    return {
      f: x.f,
      kind,
      word: words.length - 1,
      y: fs.length === 1 ? (top + bottom) / 2 : top + ((bottom - top) * i) / (fs.length - 1),
      jb: x.index === null ? -1 : jb++,
      ja: a && a.index !== null ? ja++ : -1,
    };
  });
  words.forEach((w, i) => {
    const mine = feats.filter((f) => f.word === i);
    w.y = mine.reduce((sum, f) => sum + f.y, 0) / Math.max(1, mine.length);
  });
  const gap = Math.min(narrow ? 26 : 34, (bottom - top) / 14.5);
  const mid = (top + bottom) / 2;
  const outs: Out[] = [
    ...LABELS.map((key, k) => ({ head: "intent" as const, k, key, y: mid + (k - 6.5) * gap })),
    ...LANGS.map((key, k) => ({ head: "lang" as const, k, key, y: mid + (k + 4.5) * gap })),
  ];
  const acts = ACTS.map((a, i) => ({ ...a, y: mid + (i - 1.5) * gap * 2.4 }));
  return { wx, fx, ox, ax, words, feats, outs, acts, narrow, r: narrow ? 6 : 8, gap };
}

const vote = (fw: Forward, o: Out, j: number) => (o.head === "intent" ? fw.intent.contrib[o.k][j] : fw.lang.contrib[o.k][j]);
const lineColor = (v: number, a: number) => (v >= 0 ? `rgba(92,255,172,${a})` : `rgba(255,108,86,${a})`);

function curve(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(x1 + dx * 0.45, y1, x1 + dx * 0.55, y2, x2, y2);
}
function point(x1: number, y1: number, x2: number, y2: number, t: number): [number, number] {
  const dx = x2 - x1;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * x1 + b * (x1 + dx * 0.45) + c * (x1 + dx * 0.55) + d * x2, (a + b) * y1 + (c + d) * y2];
}

export class FlowView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly screen: HTMLElement;
  private readonly tip: HTMLElement;
  private queue: Scene[] = [];
  private scene: Scene | null = null;
  private L: Layout | null = null;
  private layers: { bg?: HTMLCanvasElement; cut?: HTMLCanvasElement; before?: HTMLCanvasElement; after?: HTMLCanvasElement } = {};
  private units = 0;
  private stage: Stage | "done" | "" = "";
  private speed: Speed = "normal";
  private paused = false;
  private visible = false;
  private raf = 0;
  private last = 0;
  private dpr = 1;
  private W = 0;
  private H = 0;
  private pulses: Pulse[] = [];
  private back: Pulse[] = [];
  private hover: { kind: "feat" | "out"; i: number } | null = null;
  private pinned = false;
  private skipped = 0;
  private norm = { intent: 1, lang: 1 };
  /** Fewer moving things for people who asked their system for less motion. */
  private reduced = false;

  constructor(private readonly root: HTMLElement) {
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("vx-flow-speed");
    } catch {
      /* the page works without saved settings */
    }
    if (saved && saved in UNIT) this.speed = saved as Speed;
    else if (this.reduced) this.speed = "rapid";
    root.innerHTML = `<div class="card fl-card"><div class="fl-slot" id="fl-slot"></div>
<div class="fl-top"><div class="fl-msg" id="fl-msg"><span class="note">Waiting for a message…</span></div>
<div class="fl-ctl"><label class="fl-speed">Speed <select id="fl-speed">${SPEEDS.map(([v, t]) => `<option value="${v}"${v === this.speed ? " selected" : ""}>${t}</option>`).join("")}</select></label><button type="button" class="ghost" id="fl-pause">Pause</button><button type="button" class="ghost" id="fl-step" disabled>Next step</button><button type="button" class="ghost" id="fl-replay">Replay</button><span class="note small" id="fl-queue"></span></div></div>
<ol class="fl-stages" id="fl-stages"></ol>
<div class="fl-screen" id="fl-screen"><canvas id="fl-canvas" role="img" aria-label="The message going through the model: words, features, weights, intents and language, action"></canvas><div class="fl-caps" id="fl-caps"></div><div class="fl-tip" id="fl-tip" hidden></div></div>
<div class="fl-legend"><span><i class="sw pos"></i>votes for</span><span><i class="sw neg"></i>votes against</span><span>brighter and thicker: a stronger vote</span><span><i class="sw err"></i>the error going back while learning</span><span class="note small">Point at a dot or an intent to see its weights; click to keep it open.</span></div></div>
<div class="fl-steps" id="fl-steps"></div>`;
    this.screen = root.querySelector("#fl-screen")!;
    this.canvas = root.querySelector("#fl-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.tip = root.querySelector("#fl-tip")!;
    root.querySelector("#fl-speed")!.addEventListener("change", (e) => {
      this.speed = (e.target as HTMLSelectElement).value as Speed;
      try {
        localStorage.setItem("vx-flow-speed", this.speed);
      } catch {
        /* not saved, still works */
      }
    });
    root.querySelector("#fl-pause")!.addEventListener("click", () => this.setPaused(!this.paused));
    root.querySelector("#fl-step")!.addEventListener("click", () => this.stepOnce());
    root.querySelector("#fl-replay")!.addEventListener("click", () => {
      if (!this.scene) return;
      this.units = 0;
      this.markStage();
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.pinned) return;
      this.hover = this.hit(e);
      this.showTip(e);
    });
    this.canvas.addEventListener("pointerleave", () => {
      if (this.pinned) return;
      this.hover = null;
      this.tip.hidden = true;
    });
    this.canvas.addEventListener("click", (e) => {
      const h = this.hit(e);
      this.pinned = !!h;
      this.hover = h;
      this.showTip(e);
    });
    new ResizeObserver(() => this.resize()).observe(this.screen);
  }

  get streamDelay(): number {
    return STREAM_DELAY[this.speed];
  }

  get hasScene(): boolean {
    return !!this.scene || this.queue.length > 0;
  }

  /** A new message or lesson. It waits for the ones before it; a long queue plays faster. */
  push(s: Scene) {
    const cap = this.visible ? 14 : 3;
    while (this.queue.length >= cap) {
      this.queue.shift();
      this.skipped++;
    }
    this.queue.push(s);
    // A hidden view only keeps the newest few; it starts them when it is opened.
    // An example is only there while nothing real has come, so real data replaces it at once.
    if (this.visible && (!this.scene || this.scene.kind === "example" || this.units >= this.total())) this.next();
    this.updateQueue();
  }

  /**
   * For the demo stream: resolves when the view has shown what it was given
   * (up to the pause at the end of the last scene), so the next message comes
   * when the person has seen this one. A hidden view waits the usual pause.
   */
  async settled(signal?: AbortSignal): Promise<void> {
    const t0 = performance.now();
    const busy = () => {
      if (!this.visible) return performance.now() - t0 < STREAM_DELAY[this.speed];
      if (this.queue.length) return true;
      if (!this.scene) return false;
      const hold = this.stages().at(-1)![1];
      return this.units < this.total() - hold;
    };
    while (busy() && !signal?.aborted) await new Promise((ok) => setTimeout(ok, 100));
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) {
      this.resize();
      if (!this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame((t) => this.loop(t));
      }
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.root.querySelector("#fl-pause")!.textContent = p ? "Resume" : "Pause";
    (this.root.querySelector("#fl-step") as HTMLButtonElement).disabled = !p;
  }

  /** While paused: finish the stage on screen, so the next one is about to start. */
  private stepOnce() {
    if (!this.scene) return;
    let acc = 0;
    for (const [, len] of this.stages()) {
      acc += len;
      if (acc > this.units + 1e-6) {
        this.units = acc;
        return this.markStage();
      }
    }
    if (this.queue.length) this.next();
  }

  /** Lights the stage that is on now (the animation does it by itself while it runs). */
  private markStage() {
    this.stage = this.stageNow();
    this.updateStage();
  }

  private stages(): [Stage, number][] {
    return this.scene?.kind === "lesson" ? LESSON : MESSAGE;
  }

  private total(): number {
    return this.stages().reduce((s, [, len]) => s + len, 0);
  }

  /** How far a stage has gone: 0 before it, 1 after it. */
  private prog(name: Stage): number {
    let acc = 0;
    for (const [n, len] of this.stages()) {
      if (n === name) return clamp01((this.units - acc) / len);
      acc += len;
    }
    return 0;
  }

  private stageNow(): Stage | "done" {
    let acc = 0;
    for (const [n, len] of this.stages()) {
      if (this.units < acc + len) return n;
      acc += len;
    }
    return "done";
  }

  private next() {
    const s = this.queue.shift();
    if (!s) return;
    this.scene = s;
    this.units = 0;
    this.stage = "";
    this.hover = null;
    this.pinned = false;
    this.tip.hidden = true;
    this.build();
    this.renderInfo();
    this.updateQueue();
  }

  private updateQueue() {
    const q = this.root.querySelector("#fl-queue");
    if (q) q.textContent = `${this.queue.length ? `${this.queue.length} waiting` : ""}${this.skipped ? `${this.queue.length ? " · " : ""}${this.skipped} skipped to keep up` : ""}`;
  }

  private resize() {
    const W = this.screen.clientWidth;
    const H = this.screen.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.layers.bg = this.paint((ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0a0f3d");
      g.addColorStop(0.55, "#060a2b");
      g.addColorStop(1, "#0b1a5c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      for (const [x, y, r, c] of [
        [W * 0.92, 0, W * 0.45, "rgba(170,90,190,0.28)"],
        [W * 0.08, H * 0.05, W * 0.35, "rgba(120,80,200,0.18)"],
        [W * 0.45, H * 1.1, W * 0.6, "rgba(40,90,255,0.22)"],
      ] as [number, number, number, string][]) {
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, c);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
      }
    });
    this.build();
  }

  /** A transparent layer the size of the screen. */
  private paint(draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.round(this.W * this.dpr);
    c.height = Math.round(this.H * this.dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    draw(ctx);
    return c;
  }

  /** Lays the scene out and draws its lines once. */
  private build() {
    const s = this.scene;
    if (!s || !this.W) return;
    const L = (this.L = layout(s, this.W, this.H));
    const maxAbs = (head: "intent" | "lang") => {
      let m = 1e-9;
      for (const fw of [s.fwd, s.after]) if (fw) for (const row of fw[head].contrib) for (const v of row) m = Math.max(m, Math.abs(v));
      return m;
    };
    this.norm = { intent: maxAbs("intent"), lang: maxAbs("lang") };
    this.layers.cut = this.paint((ctx) => {
      ctx.lineWidth = 0.7;
      for (const f of L.feats) {
        ctx.beginPath();
        curve(ctx, L.wx + 5, L.words[f.word].y, L.fx, f.y);
        ctx.strokeStyle = f.kind === "word" ? "rgba(150,210,255,0.4)" : "rgba(120,160,255,0.2)";
        ctx.stroke();
      }
    });
    this.layers.before = this.paint((ctx) => this.weights(ctx, s.fwd, "jb"));
    this.layers.after = s.after ? this.paint((ctx) => this.weights(ctx, s.after!, "ja")) : undefined;
    const all: Pulse[] = [];
    for (const f of L.feats) if (f.jb >= 0) for (const o of L.outs) {
      const v = vote(s.fwd, o, f.jb);
      all.push({ f, o, v, n: Math.abs(v) / this.norm[o.head], phase: Math.random() * 0.55 });
    }
    this.pulses = all.sort((a, b) => b.n - a.n).slice(0, L.narrow ? 120 : 240);
    this.back = [];
    if (s.kind === "lesson") {
      for (const o of L.outs) {
        const err = this.target(o) - this.scoreAt(o, s.fwd);
        if (Math.abs(err) < 0.05) continue;
        for (const f of L.feats) if (f.jb >= 0 && Math.random() < 0.6) this.back.push({ f, o, v: err, n: Math.min(1, Math.abs(err)), phase: Math.random() * 0.55 });
      }
      this.back = this.back.slice(0, 520);
    }
    this.captions();
  }

  private weights(ctx: CanvasRenderingContext2D, fw: Forward, col: "jb" | "ja") {
    const L = this.L!;
    const items: { f: Feat; o: Out; v: number; n: number }[] = [];
    for (const f of L.feats) {
      const j = f[col];
      if (j < 0) continue;
      for (const o of L.outs) {
        const v = vote(fw, o, j);
        const n = Math.abs(v) / this.norm[o.head];
        if (n > 0.008) items.push({ f, o, v, n });
      }
    }
    items.sort((a, b) => a.n - b.n);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const it of items) {
      ctx.beginPath();
      curve(ctx, L.fx, it.f.y, L.ox, it.o.y);
      ctx.strokeStyle = lineColor(it.v, 0.05 + 0.8 * it.n ** 0.8);
      ctx.lineWidth = 0.35 + 2.4 * it.n;
      ctx.stroke();
    }
  }

  private captions() {
    const L = this.L;
    const s = this.scene;
    const box = this.root.querySelector("#fl-caps");
    if (!L || !s || !box) return;
    const fc = facts(s);
    // On a phone the weights go on a second row, so the names do not overlap.
    const caps: [number, string, "left" | "mid", number][] = [
      [L.wx, "Words", "left", 0],
      [L.fx, `${fc.features} features`, "mid", 0],
      [(L.fx + L.ox) / 2, `${fc.lines.toLocaleString("en")} weights${L.narrow ? "" : " (lines)"}`, "mid", L.narrow ? 1 : 0],
      [L.ox, L.narrow ? "Intents" : "Intents · language", "mid", 0],
      [Math.min(L.ax, this.W - (L.narrow ? 16 : 30)), L.narrow ? "Act" : "Action", "mid", 0],
    ];
    box.innerHTML = caps.map(([x, t, a, row]) => `<span class="fl-cap ${a}${row ? " row2" : ""}" style="left:${x.toFixed(0)}px">${esc(t)}</span>`).join("");
  }

  private loop(t: number) {
    const dt = Math.min(100, t - this.last);
    this.last = t;
    if (!this.paused) this.advance(dt);
    this.draw(t);
    this.raf = requestAnimationFrame((x) => this.loop(x));
  }

  private advance(dt: number) {
    if (!this.scene) {
      if (this.queue.length) this.next();
      return;
    }
    const total = this.total();
    if (this.units >= total) {
      if (this.queue.length) this.next();
      return;
    }
    const unit = Math.max(30, UNIT[this.speed] / (1 + 0.6 * this.queue.length));
    this.units = Math.min(total, this.units + dt / unit);
    const now = this.stageNow();
    if (now !== this.stage) {
      this.stage = now;
      this.updateStage();
    }
  }

  // ------------------------------------------------------------ drawing
  private draw(now: number) {
    const { ctx, W, H } = this;
    if (!W) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (this.layers.bg) ctx.drawImage(this.layers.bg, 0, 0, W, H);
    const s = this.scene;
    const L = this.L;
    if (!s || !L) {
      ctx.fillStyle = "rgba(200,210,255,0.7)";
      ctx.font = "15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for a message…", W / 2, H / 2);
      return;
    }
    if (s.kind === "lesson") this.drawLesson();
    else this.drawMessage(now);
    this.drawHover();
  }

  private reveal(layer: HTMLCanvasElement | undefined, x0: number, x1: number, alpha = 1) {
    if (!layer || x1 <= x0 || alpha <= 0.001) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, this.H);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0, this.W, this.H);
    ctx.restore();
  }

  /** The bright band where the signal is right now. */
  private front(x: number, color = "rgba(190,220,255,0.16)") {
    const { ctx } = this;
    const g = ctx.createLinearGradient(x - 40, 0, x + 6, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, color);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(x - 40, 0, 46, this.H);
    ctx.restore();
  }

  private dot(x: number, y: number, r: number, color: string, alpha: number, glow = 0) {
    const { ctx } = this;
    if (glow > 0) {
      const R = r * (2 + 1.2 * glow);
      ctx.globalAlpha = alpha * Math.min(1, 0.55 * glow);
      ctx.drawImage(glowSprite(color), x - R, y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private pill(text: string, x: number, y: number, align: "left" | "right", color = "#e8edff", size = 12, bg = "rgba(6,9,36,0.78)") {
    const { ctx } = this;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 10;
    const x0 = align === "left" ? x : x - w;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x0, y - size * 0.75 - 2, w, size * 1.5 + 2, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x0 + 5, y + 0.5);
  }

  private pulseAlong(list: Pulse[], p: number, forward: boolean, color: (pl: Pulse) => string, loop = false, now = 0) {
    const { ctx } = this;
    const L = this.L!;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const pl of list) {
      const t = loop ? (now / 2600 + pl.phase * 3) % 1 : clamp01(p * 1.55 - pl.phase);
      if (!loop && (t <= 0 || t >= 1)) continue;
      const [x, y] = point(L.fx, pl.f.y, L.ox, pl.o.y, forward ? t : 1 - t);
      const r = 0.9 + 2.1 * pl.n;
      const c = color(pl);
      ctx.fillStyle = c;
      ctx.globalAlpha = loop ? 0.18 : 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = loop ? 0.55 : 0.95;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private target(o: Out): number {
    const s = this.scene!;
    return o.head === "intent" ? (s.picked.includes(o.key as Label) ? 1 : 0) : s.lang === o.key ? 1 : 0;
  }

  private scoreAt(o: Out, fw: Forward, t = 1): number {
    if (o.head === "intent") return t >= 1 ? fw.intent.score[o.k] : sig(fw.intent.bias[o.k] + (fw.intent.z[o.k] - fw.intent.bias[o.k]) * t);
    if (t >= 1) return fw.lang.p[o.k];
    return softmax(fw.lang.z.map((z, k) => fw.lang.bias[k] + (z - fw.lang.bias[k]) * t))[o.k];
  }

  private words(alpha: (i: number) => number) {
    const L = this.L!;
    const size = L.narrow ? 10 : 12;
    L.words.forEach((w, i) => {
      const a = alpha(i);
      if (a <= 0) return;
      this.dot(L.wx, w.y, L.narrow ? 2.5 : 3.2, "#bfe6ff", a, 1);
      this.ctx.globalAlpha = a;
      const text = w.text.length > (L.narrow ? 8 : 14) ? `${w.text.slice(0, L.narrow ? 7 : 13)}…` : w.text;
      this.pill(text, L.wx + 7, w.y, "left", "#e8f3ff", size);
      this.ctx.globalAlpha = 1;
    });
  }

  private feats(alpha: (i: number) => number, col: "jb" | "ja", sparkle = 0) {
    const L = this.L!;
    const { ctx } = this;
    L.feats.forEach((f, i) => {
      const a = alpha(i);
      if (a <= 0) return;
      const r = (L.narrow ? 1.6 : 2.2) + (f.kind === "word" ? 0.9 : 0);
      const known = f[col] >= 0;
      const born = sparkle > 0 && f.jb < 0 && f.ja >= 0;
      if (known || born) this.dot(L.fx, f.y, r + (born ? Math.sin(sparkle * Math.PI) : 0), born ? "#fff1b8" : KIND_COLOR[f.kind], a, born ? 1.1 : 0.6);
      else {
        ctx.globalAlpha = a * 0.6;
        ctx.strokeStyle = KIND_COLOR[f.kind];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(L.fx, f.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
  }

  private outs(score: (o: Out) => number, lit: (o: Out) => number, ring: (o: Out) => string | null, note?: (o: Out) => string | null) {
    const L = this.L!;
    const { ctx } = this;
    for (const o of L.outs) {
      const p = score(o);
      const glow = lit(o);
      const col = o.head === "lang" ? "#8fb8ff" : "#7dffb4";
      if (glow > 0) this.dot(L.ox, o.y, L.r + 2, col, 0.9 * glow, 1.2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(10,14,48,0.95)";
      ctx.beginPath();
      ctx.arc(L.ox, o.y, L.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(160,180,255,0.4)";
      ctx.stroke();
      if (p > 0.001) {
        ctx.lineWidth = L.narrow ? 2.5 : 3;
        ctx.strokeStyle = glow > 0 ? col : "rgba(215,225,255,0.85)";
        ctx.beginPath();
        ctx.arc(L.ox, o.y, L.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();
      }
      const rc = ring(o);
      if (rc) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = rc;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(L.ox, o.y, L.r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const label = `${L.narrow ? SHORT[o.key] : nameOf(o.key)} ${pct(p)}`;
      this.pill(label, L.ox - L.r - 6, o.y, "right", glow > 0 ? "#ffffff" : "rgba(220,228,255,0.85)", L.narrow ? 10 : 12, glow > 0 ? "rgba(20,70,60,0.85)" : "rgba(6,9,36,0.72)");
      const extra = note?.(o);
      if (extra && !L.narrow) this.pill(extra, L.ox + L.r + 8, o.y, "left", "#ffe08a", 11);
    }
  }

  private acts(used: Set<ActKey>, a: number) {
    const L = this.L!;
    const { ctx } = this;
    const size = L.narrow ? 18 : 24;
    for (const act of L.acts) {
      const on = used.has(act.key) ? a : 0;
      if (on > 0) this.dot(L.ax, act.y, size * 0.5, "#5cf2c8", 0.7 * on, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = on > 0 ? `rgba(40,190,150,${0.35 + 0.6 * on})` : "rgba(20,26,70,0.9)";
      ctx.strokeStyle = on > 0 ? "#7dffd8" : "rgba(150,170,255,0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(L.ax - size / 2, act.y - size / 2, size, size, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = on > 0 ? "#ffffff" : "rgba(200,210,255,0.6)";
      ctx.font = `700 ${L.narrow ? 10 : 12}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(act.letter, L.ax, act.y + 0.5);
      if (!L.narrow) {
        ctx.fillStyle = on > 0 ? "#dffff4" : "rgba(200,210,255,0.55)";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.fillText(act.name, L.ax, act.y + size / 2 + 10);
      }
    }
  }

  private usedActs(): Set<ActKey> {
    const s = this.scene!;
    const used = new Set<ActKey>();
    if (s.kind === "message") {
      used.add("reply");
      for (const a of s.actions ?? []) if (ACT_OF[a.type]) used.add(ACT_OF[a.type]);
    }
    return used;
  }

  private drawMessage(now: number) {
    const L = this.L!;
    const s = this.scene!;
    const { ctx } = this;
    const pRead = this.prog("read");
    const pCut = this.prog("cut");
    const pW = this.prog("weigh");
    const pD = this.prog("decide");
    const pA = this.prog("act");
    const nWords = Math.max(1, L.words.length);
    const nFeats = Math.max(1, L.feats.length);
    const xCut = L.wx + (L.fx - L.wx) * ease(pCut);
    const xW = L.fx + (L.ox - L.fx) * ease(pW);
    this.reveal(this.layers.cut, 0, xCut + 2);
    this.reveal(this.layers.before, L.fx - 3, xW + 3);
    if (pCut > 0 && pCut < 1) this.front(xCut);
    if (pW > 0 && pW < 1) {
      this.front(xW);
      this.pulseAlong(this.pulses, pW, true, (pl) => (pl.v >= 0 ? "#7dffb8" : "#ff8a6e"));
    }
    if (this.units >= this.total() && !this.queue.length && !this.reduced) this.pulseAlong(this.pulses.slice(0, 70), 0, true, (pl) => (pl.v >= 0 ? "#7dffb8" : "#ff8a6e"), true, now);
    this.words((i) => clamp01(pRead * (nWords + 1) - i));
    this.feats((i) => clamp01(pCut * 1.6 - (i / nFeats) * 0.6), "jb");
    const picked = new Set<string>([...s.picked, s.lang]);
    const added = new Set<string>(s.added ?? []);
    this.outs(
      (o) => this.scoreAt(o, s.fwd, ease(pW)),
      (o) => (picked.has(o.key) ? ease(pD) : 0),
      (o) => (added.has(o.key) && pD > 0 ? "rgba(255,224,138,0.9)" : null),
      (o) => (added.has(o.key) && pD > 0.5 ? "added by the dialog rules" : null),
    );
    // The strongest votes for the winning intent, named.
    const top = s.picked[0];
    // On a phone there is no room between the columns: the strongest votes are in the panel below.
    if (pD > 0 && top && !L.narrow) {
      // Neighbouring features sit a few pixels apart: the names are moved down so they do not overlap.
      const strongest = facts(s)
        .votes(top)
        .slice(0, 5)
        .flatMap((v) => {
          const f = L.feats.find((x) => x.f === v.f);
          return f ? [{ v, f }] : [];
        })
        .sort((a, b) => a.f.y - b.f.y);
      const step = 17;
      let y = -Infinity;
      ctx.globalAlpha = ease(pD);
      for (const { v, f } of strongest) {
        y = Math.max(f.y, y + step);
        if (y - f.y > 1) {
          ctx.strokeStyle = "rgba(220,230,255,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(L.fx + 3, f.y);
          ctx.lineTo(L.fx + 9, y);
          ctx.stroke();
        }
        this.pill(`«${shown(v.f)}» ${sgn(v.v)}`, L.fx + 10, y, "left", v.v >= 0 ? "#9dffc9" : "#ffad99", 11);
      }
      ctx.globalAlpha = 1;
    }
    const used = this.usedActs();
    if (pD > 0 && used.size) {
      const from = L.outs.filter((o) => picked.has(o.key));
      const xEnd = L.ox + (L.ax - L.ox) * ease(pD);
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.ox, 0, xEnd - L.ox + 2, this.H);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "rgba(125,255,200,0.65)";
      for (const o of from)
        for (const a of L.acts)
          if (used.has(a.key)) {
            ctx.beginPath();
            curve(ctx, L.ox + L.r, o.y, L.ax - 14, a.y);
            ctx.stroke();
          }
      ctx.restore();
    }
    this.acts(used, ease(pA));
  }

  private drawLesson() {
    const L = this.L!;
    const s = this.scene!;
    const after = s.after ?? s.fwd;
    const pR = this.prog("recall");
    const pE = this.prog("error");
    const pU = this.prog("update");
    const a = ease(pR);
    const u = ease(pU);
    this.reveal(this.layers.cut, 0, this.W, a * 0.8);
    this.reveal(this.layers.before, L.fx - 3, L.ox + 3, a * (1 - u));
    if (u > 0) {
      const x = L.ox - (L.ox - L.fx) * u;
      this.reveal(this.layers.after, x - 3, L.ox + 3);
      if (u < 1) this.front(x, "rgba(255,214,110,0.22)");
    }
    if (pE > 0 && pE < 1) this.pulseAlong(this.back, pE, false, (pl) => (pl.v >= 0 ? "#ffd166" : "#b98cff"));
    this.words(() => a);
    this.feats(() => a, u >= 1 ? "ja" : "jb", pU > 0 && pU < 1 ? pU : 0);
    const errShow = pE > 0 ? 1 - u : 0;
    this.outs(
      (o) => {
        const b = this.scoreAt(o, s.fwd);
        const c = this.scoreAt(o, after);
        return b + (c - b) * u;
      },
      (o) => (this.target(o) ? 0.4 + 0.6 * u : 0),
      (o) => (o.head === "intent" && this.target(o) ? "rgba(255,209,102,0.95)" : null),
      (o) => {
        if (errShow <= 0) return null;
        const err = this.target(o) - this.scoreAt(o, s.fwd);
        return Math.abs(err) >= 0.05 ? `error ${sgn(err)}` : null;
      },
    );
    this.acts(new Set(), 0);
  }

  private drawHover() {
    const h = this.hover;
    const L = this.L;
    const s = this.scene;
    if (!h || !L || !s) return;
    const fw = s.kind === "lesson" && this.units >= this.total() - 1.1 && s.after ? s.after : s.fwd;
    const col = fw === s.after ? "ja" : "jb";
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const line = (f: Feat, o: Out) => {
      const j = f[col];
      if (j < 0) return;
      const v = vote(fw, o, j);
      const n = Math.abs(v) / this.norm[o.head];
      ctx.beginPath();
      curve(ctx, L.fx, f.y, L.ox, o.y);
      ctx.strokeStyle = v >= 0 ? `rgba(200,255,225,${0.25 + 0.75 * n})` : `rgba(255,200,190,${0.25 + 0.75 * n})`;
      ctx.lineWidth = 1 + 2.5 * n;
      ctx.stroke();
    };
    if (h.kind === "feat") for (const o of L.outs) line(L.feats[h.i], o);
    else for (const f of L.feats) line(f, L.outs[h.i]);
    ctx.restore();
    if (h.kind === "feat") this.dot(L.fx, L.feats[h.i].y, 4.5, "#ffffff", 1, 2);
  }

  // ------------------------------------------------------------ pointing
  private hit(e: PointerEvent | MouseEvent): { kind: "feat" | "out"; i: number } | null {
    const L = this.L;
    if (!L) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (Math.abs(x - L.fx) < 16) {
      let best = -1;
      let d = 7;
      L.feats.forEach((f, i) => {
        if (Math.abs(f.y - y) < d) {
          d = Math.abs(f.y - y);
          best = i;
        }
      });
      if (best >= 0) return { kind: "feat", i: best };
    }
    if (x > L.ox - (L.narrow ? 70 : 150) && x < L.ox + L.r + 10) {
      const i = L.outs.findIndex((o) => Math.abs(o.y - y) < L.gap / 2);
      if (i >= 0) return { kind: "out", i };
    }
    return null;
  }

  private showTip(e: PointerEvent | MouseEvent) {
    const h = this.hover;
    const L = this.L;
    const s = this.scene;
    if (!h || !L || !s) {
      this.tip.hidden = true;
      return;
    }
    const fw = s.kind === "lesson" && this.units >= this.total() - 1.1 && s.after ? s.after : s.fwd;
    const col = fw === s.after ? "ja" : "jb";
    let html = "";
    if (h.kind === "feat") {
      const f = L.feats[h.i];
      const j = f[col];
      html = `<b>«${esc(shown(f.f))}»</b> <span class="k">${KIND_NAME[f.kind]}</span><br>`;
      if (j < 0) html += "New to the model: no weights yet. It gets them when the AI learns a phrase with it.";
      else {
        const votes = L.outs.map((o) => ({ o, v: vote(fw, o, j) })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
        html += `Its vote = weight × ${fw.scale.toFixed(3)}<br>${votes
          .slice(0, 7)
          .map(({ o, v }) => `${esc(nameOf(o.key))} <b class="${v >= 0 ? "pos" : "neg"}">${sgn(v, 3)}</b> <span class="k">weight ${sgn(v / fw.scale, 3)}</span>`)
          .join("<br>")}`;
      }
    } else {
      const o = L.outs[h.i];
      const head = fw[o.head];
      const z = head.z[o.k];
      const bias = head.bias[o.k];
      const votes = L.feats.flatMap((f) => (f[col] < 0 ? [] : [{ f, v: vote(fw, o, f[col]) }])).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
      html = `<b>${esc(nameOf(o.key))}</b><br>start ${sgn(bias)} + ${votes.length} votes ${sgn(z - bias)} = z ${sgn(z)}<br>${o.head === "intent" ? `sigmoid(z) = <b>${pct(this.scoreAt(o, fw))}</b>` : `softmax over 3 languages = <b>${pct(this.scoreAt(o, fw))}</b>`}<br>${votes
        .slice(0, 6)
        .map(({ f, v }) => `«${esc(shown(f.f))}» <b class="${v >= 0 ? "pos" : "neg"}">${sgn(v, 3)}</b>`)
        .join("<br>")}`;
    }
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = this.tip.offsetWidth;
    const hgt = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(6, Math.min(this.W - w - 6, x + 14))}px`;
    this.tip.style.top = `${Math.max(6, Math.min(this.H - hgt - 6, y - 10))}px`;
  }

  // ------------------------------------------------------------ text around the picture
  private renderInfo() {
    const s = this.scene;
    if (!s) return;
    const fc = facts(s);
    const msg = this.root.querySelector("#fl-msg")!;
    const check = s.truth ? (s.truth.ok ? `<span class="ok">✓ understood right</span>` : `<span class="no">✗ right answer: ${s.truth.labels.map((l) => esc(nameOf(l))).join(" + ")}</span>`) : "";
    const real = s.ms ? `<span class="note small">Really took ${s.ms.agent.toFixed(1)} ms (the model ${s.ms.model.toFixed(2)} ms)</span>` : "";
    msg.innerHTML = `<div class="fl-who">${s.kind === "lesson" ? `<span class="tag k-learn">lesson</span>` : s.kind === "example" ? `<span class="tag">example, not saved</span>` : `<span class="tag k-msg">new message</span>`} <b>${esc(s.who)}</b> ${check} ${real}</div><q>${esc(s.text)}</q>`;
    const pills = PILLS[s.kind === "lesson" ? "lesson" : "message"];
    this.root.querySelector("#fl-stages")!.innerHTML = pills.map(([st, t]) => `<li data-s="${st}">${esc(t)}</li>`).join("");
    const steps = this.root.querySelector("#fl-steps")!;
    if (s.kind === "lesson") {
      const after = s.after ?? s.fwd;
      const right = picks(after.intent.score).sort().join(",") === [...s.picked].sort().join(",");
      const errs = LABELS.map((l, k) => ({ l, b: s.fwd.intent.score[k], a: after.intent.score[k], t: s.picked.includes(l) ? 1 : 0 })).filter((x) => x.t === 1 || x.b >= 0.5);
      const both = this.L?.feats.filter((f) => f.jb >= 0 && f.ja >= 0) ?? [];
      const changes = both
        .flatMap((f) => LABELS.map((l, k) => ({ f: f.f, l, d: after.intent.contrib[k][f.ja] / after.scale - s.fwd.intent.contrib[k][f.jb] / s.fwd.scale })))
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
        .slice(0, 4);
      steps.innerHTML = [
        ["recall", "1 · The phrase", `<q>${esc(s.text)}</q><br>should mean ${s.picked.map((l) => `<span class="lb lb-${l}">${esc(nameOf(l))}</span>`).join(" ")}<br><span class="note small">${esc(s.why ?? "")}</span>`],
        ["error", "2 · The error goes back", errs.map((x) => `${esc(nameOf(x.l))}: the model said <b>${pct(x.b)}</b>, should be <b>${x.t ? "100%" : "0%"}</b> → error ${sgn(x.t - x.b)}`).join("<br>") + `<br><span class="note small">Every known feature of the phrase gets its weight to each intent moved by error × ${s.fwd.scale.toFixed(3)} × learning rate.</span>`],
        ["update", "3 · Weights change", `${s.steps ?? 1} small step${(s.steps ?? 1) > 1 ? "s" : ""}${s.newFeatures ? `, ${s.newFeatures} new feature${s.newFeatures > 1 ? "s" : ""} joined the model` : ""}.<br>${changes.map((c) => `«${esc(shown(c.f))}» → ${esc(nameOf(c.l))} <b class="${c.d >= 0 ? "pos" : "neg"}">${sgn(c.d, 3)}</b>`).join("<br>")}`],
        ["hold", "4 · After", `${errs.map((x) => `${esc(nameOf(x.l))}: ${pct(x.b)} → <b>${pct(x.a)}</b>`).join("<br>")}<br>${right ? `<span class="ok">✓ now reads it right</span>` : `<span class="note small">still learning: more phrases like this will settle it</span>`}`],
      ]
        .map(([st, h, b]) => `<div class="fl-step" data-s="${st}"><h3>${h}</h3><div>${b}</div></div>`)
        .join("");
    } else {
      const top = fc.intents[0];
      const second = fc.intents[1];
      const used = [...(s.actions ?? [])];
      const unsure = s.unsure ?? top.score < 0.7;
      const sure = unsure
        ? `<span class="no">unsure (below 70%): a person checks it in the Training tab</span>`
        : top.score >= 0.7
          ? `<span class="ok">sure (70% or more)</span>`
          : `<span class="ok">below 70%, but the dialog settles it: the client is answering the AI's offer</span>`;
      steps.innerHTML = [
        ["cut", "1 · Message → features", `<b>${fc.features} features</b>: ${fc.kinds.word} words, ${fc.kinds.pair} pairs of words, ${fc.kinds.start} word starts, ${fc.kinds.piece} pieces of letters${fc.kinds.other ? `, ${fc.kinds.other} length mark` : ""}.<br>${fc.unknown ? `${fc.unknown} of them the model has never seen: no lines yet.` : "The model knows all of them."}`],
        ["weigh", "2 · Weights", `${fc.known} known features × 13 outputs = <b>${fc.lines.toLocaleString("en")} lines</b>. Each carries weight × ${fc.scale.toFixed(3)} (1/√${fc.known}).<br>Strongest votes for ${esc(nameOf(top.label))}: ${fc
          .votes(top.label)
          .slice(0, 4)
          .map((v) => `«${esc(shown(v.f))}» <b class="${v.v >= 0 ? "pos" : "neg"}">${sgn(v.v)}</b>`)
          .join(", ")}`],
        ["decide", "3 · Sum → score", `${esc(nameOf(top.label))}: start ${sgn(top.bias)} + votes ${sgn(top.sum)} = z ${sgn(top.z)} → sigmoid → <b>${pct(top.score)}</b><br>next: ${esc(nameOf(second.label))} ${pct(second.score)}<br>Language: <b>${esc(nameOf(fc.langs[0].lang))} ${pct(fc.langs[0].p)}</b><br>${sure}`],
        ["act", "4 · Decision → action", s.kind === "example" ? `Only the model's reading: nothing is sent or saved, so there is no reply and nothing is done in the CRM. Send a message or play the demo stream to see the whole way.` : `${(s.added ?? []).length ? `Dialog rules added: ${(s.added ?? []).map((l) => esc(nameOf(l))).join(", ")}.<br>` : ""}${used.map((a) => `<b>${esc(a.type)}</b>: ${esc(a.text)}`).join("<br>")}${s.reply ? `<div class="fl-reply">${esc(s.reply)}</div>` : ""}`],
      ]
        .map(([st, h, b]) => `<div class="fl-step" data-s="${st}"><h3>${h}</h3><div>${b}</div></div>`)
        .join("");
    }
    this.updateStage();
  }

  private updateStage() {
    const s = this.scene;
    if (!s) return;
    const order = this.stages().map(([n]) => n);
    const now = this.stageNow();
    const at = now === "done" ? order.length : order.indexOf(now);
    const mark = (el: Element) => {
      const i = order.indexOf((el as HTMLElement).dataset.s as Stage);
      el.classList.toggle("on", i === at);
      el.classList.toggle("done", i < at);
    };
    this.root.querySelectorAll("#fl-stages li").forEach(mark);
    this.root.querySelectorAll("#fl-steps .fl-step").forEach(mark);
  }
}
