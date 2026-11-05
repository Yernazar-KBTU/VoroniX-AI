// VoroniX AI at work: takes client messages from the social networks, answers
// them, acts in the CRM, remembers each client, learns from what the
// conversations prove and from what people teach it, and keeps everything in
// the store. Every open page runs the same code on the same saved data, so
// they all see the same AI, live.
import type { Example, Label, Lang } from "../data.js";
import type { Forward, IntentModel } from "../model.js";
import { respond, type Outcome } from "./agent.js";
import { parseCommand, type Command } from "./commands.js";
import { DEMO_BUSINESS, money, nextFree, serviceName, staffName, upcoming, when } from "./crm.js";
import { addDays, ruleLang, sameName, ymd } from "./entities.js";
import { Knowledge } from "./knowledge.js";
import { isRight, Learner, RETRAIN_EVERY, type LearnResult } from "./learner.js";
import { habits, newClient, rememberBooking } from "./memory.js";
import { newId, type Collection, type Row, type Store } from "./store.js";
import { FADE, STARTER_KNOWLEDGE, STREAM } from "./stream.js";
import type { Booking, Business, Channel, ClientMemory, KnowledgeEntry, LiveEvent, Phrase, QueueItem, Service, Version } from "./types.js";

type Topic = "ready" | "change" | "learned" | "progress" | "error" | "processed" | "lesson";
type Fn = (data?: unknown) => void;

export interface Incoming {
  name: string;
  channel: Channel;
  text: string;
  handle?: string;
  /** Known right answer (demo stream only): used to measure the AI, never to answer. */
  truth?: Label[];
}

export interface Received {
  outcome: Outcome;
  client: ClientMemory;
  learned: LearnResult[];
  queued: QueueItem[];
}

/** A message as the model saw it, for the real-time view. Sent before anything is learned from it. */
export interface Processed {
  name: string;
  channel: Channel;
  text: string;
  fwd: Forward;
  outcome: Outcome;
  /** Real time it took, in milliseconds: the model alone, and the whole answer (model, knowledge, CRM). */
  ms: { model: number; agent: number };
  truth?: Label[];
}

/** One lesson: the phrase through the model before and after learning it. */
export interface Lesson {
  phrase: Phrase;
  before: Forward;
  after: Forward;
  result: LearnResult;
}

export interface CommandPlan {
  cmd: Command;
  say: string;
  /** Writes in the CRM wait for a click. */
  confirm?: { label: string; run: () => Promise<string> };
  show?: { view: "calendar" | "clients" | "business" | "knowledge"; ids?: string[]; day?: string };
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
const toRow = (o: object) => o as unknown as Row;

export class Live {
  readonly learner: Learner;
  readonly knowledge = new Knowledge();
  business: Business = DEMO_BUSINESS;
  retrainEvery = RETRAIN_EVERY;
  clients = new Map<string, ClientMemory>();
  bookings = new Map<string, Booking>();
  queue = new Map<string, QueueItem>();
  entries: KnowledgeEntry[] = [];
  events: LiveEvent[] = [];
  ready = false;
  retraining: { stage: string; epoch: number; loss: number } | null = null;
  private listeners = new Map<Topic, Set<Fn>>();
  private chain: Promise<unknown> = Promise.resolve();
  private stops: (() => void)[] = [];

  constructor(
    readonly store: Store,
    seed: Example[],
    private readonly now: () => Date = () => new Date(),
    /** The start model, when it is already trained (the site trains it once for all tabs). */
    start?: IntentModel,
  ) {
    this.learner = new Learner(seed, start);
  }

  on(topic: Topic, fn: Fn): () => void {
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(topic: Topic, data?: unknown) {
    for (const fn of this.listeners.get(topic) ?? [])
      try {
        fn(data);
      } catch (e) {
        // The page failing to draw something must not stop the AI's work.
        console.error(e);
      }
  }

  /** Runs store work one step at a time, so two messages never write the same client at once. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private ctx() {
    return { model: this.learner.model, knowledge: this.knowledge, business: this.business, bookings: [...this.bookings.values()], now: this.now(), newId };
  }

  async start(): Promise<void> {
    const [phrases, versions, clients, bookings, queue, knowledge, events, settings] = await Promise.all(
      (["phrases", "versions", "clients", "bookings", "queue", "knowledge", "events", "settings"] as Collection[]).map((c) => this.store.all(c)),
    );
    this.applySettings(settings);
    this.clients = new Map((clients as unknown as ClientMemory[]).map((c) => [c.id, c]));
    this.bookings = new Map((bookings as unknown as Booking[]).map((b) => [b.id, b]));
    this.queue = new Map((queue as unknown as QueueItem[]).map((q) => [q.id, q]));
    this.entries = knowledge as unknown as KnowledgeEntry[];
    this.knowledge.set(this.entries, this.business);
    this.events = (events as unknown as LiveEvent[]).sort((a, b) => a.at - b.at);
    await this.learner.load(phrases as unknown as Phrase[], versions as unknown as Version[]);
    this.ready = true;
    this.watch();
    this.emit("ready");
  }

  stop() {
    this.stops.forEach((s) => s());
    this.stops = [];
  }

  /** Changes made by other pages (or by this one) come back here and update the AI. */
  private watch() {
    const w = (c: Collection, fn: (rows: Row[]) => void) => this.stops.push(this.store.watch(c, (rows) => (fn(rows), this.emit("change", c))));
    w("phrases", (rows) => {
      for (const p of (rows as unknown as Phrase[]).sort((a, b) => a.at - b.at)) if (!this.learner.has(p.id)) this.emit("learned", { ...this.learner.learn(p), remote: true });
    });
    w("versions", (rows) => {
      for (const v of (rows as unknown as Version[]).sort((a, b) => a.n - b.n))
        if (!this.learner.versions.some((x) => x.id === v.id)) void this.learner.apply(v).then(() => this.emit("change", "model"));
    });
    w("clients", (rows) => (this.clients = new Map((rows as unknown as ClientMemory[]).map((c) => [c.id, c]))));
    w("bookings", (rows) => (this.bookings = new Map((rows as unknown as Booking[]).map((b) => [b.id, b]))));
    w("queue", (rows) => (this.queue = new Map((rows as unknown as QueueItem[]).map((q) => [q.id, q]))));
    w("knowledge", (rows) => {
      this.entries = rows as unknown as KnowledgeEntry[];
      this.knowledge.set(this.entries, this.business);
    });
    w("events", (rows) => (this.events = (rows as unknown as LiveEvent[]).sort((a, b) => a.at - b.at)));
    w("settings", (rows) => {
      this.applySettings(rows);
      this.knowledge.set(this.entries, this.business);
    });
  }

  private applySettings(rows: Row[]) {
    const biz = rows.find((r) => r.id === "business") as unknown as Business | undefined;
    if (biz?.services?.length) this.business = { ...DEMO_BUSINESS, ...biz };
    const prefs = rows.find((r) => r.id === "prefs") as { retrainEvery?: number } | undefined;
    if (prefs?.retrainEvery) this.retrainEvery = prefs.retrainEvery;
  }

  private async log(kind: LiveEvent["kind"], title: string, detail?: Record<string, unknown>): Promise<LiveEvent> {
    const e: LiveEvent = { id: newId("ev"), at: Date.now(), kind, title, ...(detail ? { detail: JSON.parse(JSON.stringify(detail)) } : {}) };
    this.events.push(e);
    await this.store.put("events", toRow(e));
    // The site's database holds at most 25 000 documents: keep the newest 1 500 events.
    if (this.events.length > 1500) for (const old of this.events.splice(0, this.events.length - 1500).slice(0, 5)) await this.store.remove("events", old.id);
    return e;
  }

  clientFor(name: string, channel: Channel | "crm", handle?: string, lang?: Lang): ClientMemory {
    const id = `c-${channel}-${slug(name)}`;
    return this.clients.get(id) ?? newClient(id, name, channel, handle ?? `@${slug(name).replace(/-/g, "_")}`, lang ?? "ru", Date.now());
  }

  /** A client message from a social network. */
  receive(input: Incoming): Promise<Received> {
    return this.serial(async () => {
      const at = Date.now();
      const client = this.clientFor(input.name, input.channel, input.handle, ruleLang(input.text) ?? "ru");
      const t0 = performance.now();
      const outcome = respond(this.ctx(), client, input.text, at);
      const agent = performance.now() - t0;
      if (this.listeners.get("processed")?.size) {
        const t1 = performance.now();
        this.learner.model.predict(input.text);
        const model = performance.now() - t1;
        const p: Processed = { name: outcome.client.name, channel: input.channel, text: input.text, fwd: this.learner.model.forward(input.text), outcome, ms: { model, agent }, ...(input.truth ? { truth: input.truth } : {}) };
        this.emit("processed", p);
      }
      if (outcome.booking) await this.saveBooking(outcome.booking);
      if (outcome.cancelled) await this.saveBooking(outcome.cancelled);
      this.clients.set(outcome.client.id, outcome.client);
      await this.store.put("clients", toRow(outcome.client));
      const learned: LearnResult[] = [];
      for (const l of outcome.learn) learned.push(await this.learnNow({ text: l.text, lang: l.lang, labels: l.labels, source: "client", why: l.why, client: client.id }));
      const queued: QueueItem[] = [];
      for (const q of outcome.queue) {
        const item: QueueItem = { ...q, id: newId("q"), at, ...(input.truth ? { truth: input.truth } : {}) };
        this.queue.set(item.id, item);
        await this.store.put("queue", toRow(item));
        queued.push(item);
      }
      const truth = input.truth;
      await this.log("message", `${outcome.client.name}: ${input.text}`, {
        client: client.id,
        name: outcome.client.name,
        channel: input.channel,
        text: input.text,
        lang: outcome.lang,
        intents: outcome.prediction.intents.map((i) => ({ label: i.label, score: Math.round(i.score * 1000) / 1000 })),
        labels: outcome.labels,
        unsure: outcome.unsure,
        reply: outcome.reply,
        actions: outcome.actions,
        learned: learned.length,
        queued: queued.map((q) => q.kind),
        ...(outcome.hit ? { source: outcome.hit.entry.title } : {}),
        ...(truth ? { truth, ok: isRight(outcome.prediction, truth), frozenOk: isRight(this.learner.frozen.predict(input.text), truth) } : {}),
      });
      this.maybeRetrain();
      return { outcome, client: outcome.client, learned, queued };
    });
  }

  private async saveBooking(b: Booking) {
    this.bookings.set(b.id, b);
    await this.store.put("bookings", toRow(b));
  }

  /** Learns a phrase now and saves it. */
  private async learnNow(p: Omit<Phrase, "id" | "at">): Promise<LearnResult> {
    const phrase: Phrase = { ...p, id: newId("p"), at: Date.now() };
    const before = this.listeners.get("lesson")?.size ? this.learner.model.forward(p.text) : null;
    const r = this.learner.learn(phrase);
    if (before) this.emit("lesson", { phrase, before, after: this.learner.model.forward(p.text), result: r } satisfies Lesson);
    await this.store.put("phrases", toRow(phrase));
    const best = r.before.intents[0];
    await this.log("learn", `Learned «${p.text}» → ${p.labels.join(" + ")}`, {
      text: p.text,
      labels: p.labels,
      source: p.source,
      why: p.why,
      steps: r.steps,
      newFeatures: r.newFeatures,
      correct: r.correct,
      before: { label: best.label, score: Math.round(best.score * 1000) / 1000, labels: r.before.intents.map((i) => i.label) },
      after: Object.fromEntries(p.labels.map((l) => [l, Math.round(r.after[l] * 1000) / 1000])),
      was: Object.fromEntries(p.labels.map((l) => [l, Math.round(r.before.scores[l] * 1000) / 1000])),
      changes: r.changes.slice(0, 6).map((c) => ({ f: c.feature, l: c.label, from: Math.round(c.from * 1000) / 1000, to: Math.round(c.to * 1000) / 1000 })),
    });
    this.emit("learned", r);
    return r;
  }

  private maybeRetrain() {
    if (!this.retraining && this.learner.pending >= this.retrainEvery) void this.retrain(`auto: ${this.learner.pending} new phrases`);
  }

  /** Retrains on all data; the new version goes live only if it is not worse. */
  async retrain(trigger = "manual"): Promise<Version | null> {
    if (this.retraining) return null;
    this.retraining = { stage: "old", epoch: 0, loss: 0 };
    this.emit("progress", this.retraining);
    try {
      const r = await this.learner.retrain(trigger, (stage, epoch, loss) => {
        this.retraining = { stage, epoch, loss };
        this.emit("progress", this.retraining);
      });
      const before = this.learner.live;
      await this.learner.apply(r.version, r.model);
      if (r.accepted && before) await this.store.patch("versions", before.id, { status: "old" }).catch(() => {});
      await this.store.put("versions", toRow(r.version));
      const m = (x: { exact: number } | null) => (x ? `${(x.exact * 100).toFixed(1)}%` : "-");
      await this.log("retrain", r.accepted ? `Version ${r.version.n} is live: ${m(r.version.metrics)} vs ${m(r.version.prev)}` : `Version ${r.version.n} rejected: ${m(r.version.metrics)} vs ${m(r.version.prev)}`, { ...r.version });
      return r.version;
    } finally {
      this.retraining = null;
      this.emit("progress", null);
      this.emit("change", "model");
    }
  }

  /** A person checked an item of the queue. labels: the right intents. */
  review(id: string, labels: Label[]): Promise<LearnResult | null> {
    return this.serial(async () => {
      const q = this.queue.get(id);
      if (!q) return null;
      const same = labels.length === q.guess.length && labels.every((l) => q.guess.includes(l));
      const r = await this.learnNow({ text: q.text, lang: q.lang, labels, source: "operator", why: same ? "A person confirmed the AI's reading" : `A person corrected the AI (it thought ${q.guess.join(" + ")})`, client: q.client });
      await this.dropQueue(id);
      await this.log("review", `${same ? "Confirmed" : "Corrected"}: «${q.text}»`, { labels, guess: q.guess });
      return r;
    });
  }

  /** A person answered a question the AI could not: the answer becomes knowledge right away. */
  answer(id: string, text: string): Promise<KnowledgeEntry | null> {
    return this.serial(async () => {
      const q = this.queue.get(id);
      if (!q || !text.trim()) return null;
      const entry = await this.saveKnowledge(q.text, text.trim(), "operator");
      await this.dropQueue(id);
      return entry;
    });
  }

  /** A manager handled a complaint: the AI learns that this message was one. */
  resolve(id: string): Promise<void> {
    return this.serial(async () => {
      const q = this.queue.get(id);
      if (!q) return;
      if (q.kind === "complaint") await this.learnNow({ text: q.text, lang: q.lang, labels: ["complaint"], source: "operator", why: "A manager handled it as a complaint", client: q.client });
      await this.dropQueue(id);
      await this.log("review", `Resolved: «${q.text}»`);
    });
  }

  dismiss(id: string): Promise<void> {
    return this.serial(() => this.dropQueue(id));
  }

  private async dropQueue(id: string) {
    this.queue.delete(id);
    await this.store.remove("queue", id);
  }

  /** The owner teaches a phrase by hand. */
  teach(text: string, labels: Label[], lang?: Lang): Promise<LearnResult> {
    return this.serial(() => this.learnNow({ text, lang: lang ?? this.learner.model.predict(text).lang, labels, source: "business", why: "Taught by hand in the Training tab" }));
  }

  addKnowledge(title: string, text: string, source: KnowledgeEntry["source"] = "business", file?: string): Promise<KnowledgeEntry> {
    return this.serial(() => this.saveKnowledge(title, text, source, file));
  }

  private async saveKnowledge(title: string, text: string, source: KnowledgeEntry["source"], file?: string): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = { id: newId("k"), title: title.slice(0, 200), text: text.slice(0, 60000), source, at: Date.now(), ...(file ? { file } : {}) };
    this.entries = [...this.entries, entry];
    this.knowledge.set(this.entries, this.business);
    await this.store.put("knowledge", toRow(entry));
    await this.log("knowledge", `New knowledge: «${entry.title}»`, { source, chars: entry.text.length, ...(file ? { file } : {}) });
    return entry;
  }

  removeKnowledge(id: string): Promise<void> {
    return this.serial(async () => {
      this.entries = this.entries.filter((e) => e.id !== id);
      this.knowledge.set(this.entries, this.business);
      await this.store.remove("knowledge", id);
    });
  }

  saveBusiness(b: Business): Promise<void> {
    return this.serial(async () => {
      this.business = b;
      this.knowledge.set(this.entries, b);
      await this.store.put("settings", toRow({ ...b, id: "business" }));
    });
  }

  /**
   * The business adds a service. The AI learns it from the data: the name
   * becomes a word it recognises, and it writes its own training phrases
   * about the new service in three languages.
   */
  addService(s: Service): Promise<LearnResult[]> {
    return this.serial(async () => {
      if (this.business.services.some((x) => x.id === s.id || x.names.en.toLowerCase() === s.names.en.toLowerCase())) return [];
      const staff = this.business.staff.map((m) => (m.services.includes("HC-01") ? { ...m, services: [...m.services, s.id] } : m));
      this.business = { ...this.business, services: [...this.business.services, s], staff };
      this.knowledge.set(this.entries, this.business);
      await this.store.put("settings", toRow({ ...this.business, id: "business" }));
      await this.log("business", `New service: ${s.names.en}, ${money(this.business, s.price)}, ${s.minutes} min`, { service: s.id });
      const n = { ru: s.names.ru.toLowerCase(), kk: s.names.kk.toLowerCase(), en: s.names.en.toLowerCase() };
      const made: [string, Lang, Label][] = [
        [`Сколько стоит ${n.ru}?`, "ru", "price"],
        [`Хочу записаться на ${n.ru}`, "ru", "booking"],
        [`${s.names.kk} қанша тұрады?`, "kk", "price"],
        [`${s.names.kk} жасатқым келеді, жазып қойыңызшы`, "kk", "booking"],
        [`How much is a ${n.en}?`, "en", "price"],
        [`Can I book a ${n.en}?`, "en", "booking"],
      ];
      const out: LearnResult[] = [];
      for (const [text, lang, label] of made) out.push(await this.learnNow({ text, lang, labels: [label], source: "auto", why: `Made by the AI from the new service «${s.names.en}»` }));
      return out;
    });
  }

  setRetrainEvery(n: number): Promise<void> {
    this.retrainEvery = n;
    return this.serial(() => this.store.put("settings", { id: "prefs", retrainEvery: n }));
  }

  /** Loads the demo starter knowledge (texts a business would type on day one). */
  loadStarterKnowledge(): Promise<void> {
    return this.serial(async () => {
      for (const k of STARTER_KNOWLEDGE) if (!this.entries.some((e) => e.title === k.title)) await this.saveKnowledge(k.title, k.text, "business");
    });
  }

  /** Plays the demo stream: the AI answers each client, a simulated operator checks its queue. */
  async play(opts: { delay: number; operator: boolean; signal?: AbortSignal; pace?: () => Promise<void>; onTurn?: (r: Received, d: (typeof STREAM)[number]) => void }): Promise<void> {
    // pace: the real-time view says when the next message may come (when the person has seen this one).
    const wait = (ms: number) => (opts.pace ? opts.pace() : new Promise<void>((ok) => setTimeout(ok, ms)));
    // Day one of the demo business: its first texts (payment, parking, being late) and a new service.
    await this.loadStarterKnowledge();
    if (!this.business.services.some((s) => s.id === FADE.id)) {
      await this.addService(FADE);
      await wait(opts.delay);
    }
    for (const d of STREAM) {
      for (const turn of d.turns) {
        if (opts.signal?.aborted) return;
        const r = await this.receive({ name: d.client, channel: d.channel, text: turn.text, truth: turn.labels });
        opts.onTurn?.(r, d);
        await wait(opts.delay);
        if (opts.operator)
          for (const q of r.queued) {
            if (q.kind === "unsure") await this.review(q.id, turn.labels);
            else if (q.kind === "unanswered" && turn.answer) await this.answer(q.id, turn.answer);
            else if (q.kind === "complaint") await this.resolve(q.id);
          }
      }
    }
  }

  /** Reads a staff command and prepares what to do. Writes wait for confirm.run(). */
  command(text: string): CommandPlan {
    const now = this.now();
    const b = this.business;
    const cmd = parseCommand(text, b, now);
    const find = (name: string) => [...this.clients.values()].find((c) => sameName(name, c.name));
    const bookings = [...this.bookings.values()];
    switch (cmd.kind) {
      case "book": {
        const known = find(cmd.name);
        const name = known?.name ?? cmd.name.replace(/ю$/u, "я").replace(/у$/u, "а");
        const client = known ?? this.clientFor(name, "crm");
        const h = habits(client);
        const svcId = cmd.service ?? h.service ?? b.services[0].id;
        const svc = b.services.find((s) => s.id === svcId)!;
        const slot = nextFree(b, bookings, svcId, cmd.day, { now, pref: cmd.time, staff: h.staff })[0];
        if (!slot) return { cmd, say: `No free time for ${svc.names.en} in the coming week.` };
        const exact = !cmd.time?.exact || slot.start.endsWith(cmd.time.exact);
        const say = `Book ${client.name}: ${svc.names.en}, ${when(slot.start, "en")} with ${staffName(b, slot.staff)} (${money(b, svc.price)}).${exact ? "" : ` ${cmd.time?.exact} is taken, this is the nearest free time.`}${known ? "" : " New client."}`;
        return {
          cmd,
          say,
          confirm: {
            label: "Book",
            run: () =>
              this.serial(async () => {
                const booking: Booking = { id: newId("bk"), client: client.id, clientName: client.name, service: svcId, staff: slot.staff, start: slot.start, minutes: svc.minutes, price: svc.price, status: "booked", source: "crm", at: Date.now() };
                await this.saveBooking(booking);
                const mem = rememberBooking(this.clients.get(client.id) ?? client, booking);
                this.clients.set(mem.id, mem);
                await this.store.put("clients", toRow(mem));
                await this.log("command", `Staff: booked ${client.name}, ${svc.names.en}, ${when(slot.start, "en")}`, { text, booking: booking.id });
                return booking.id;
              }),
          },
          show: { view: "calendar", day: slot.start.slice(0, 10) },
        };
      }
      case "cancel":
      case "move": {
        const client = find(cmd.name);
        const next = client && upcoming(bookings, client.id, now)[0];
        if (!client || !next) return { cmd, say: client ? `${client.name} has no upcoming booking.` : `I don't know a client called ${cmd.name}.` };
        if (cmd.kind === "cancel")
          return {
            cmd,
            say: `Cancel ${client.name}'s booking: ${serviceName(b, next.service, "en")}, ${when(next.start, "en")}?`,
            confirm: {
              label: "Cancel booking",
              run: () =>
                this.serial(async () => {
                  await this.saveBooking({ ...next, status: "cancelled" });
                  await this.log("command", `Staff: cancelled ${client.name}, ${when(next.start, "en")}`, { text, booking: next.id });
                  return next.id;
                }),
            },
            show: { view: "calendar", day: next.start.slice(0, 10), ids: [next.id] },
          };
        const others = bookings.filter((k) => k.id !== next.id);
        const slot = nextFree(b, others, next.service, cmd.day, { now, pref: cmd.time, staff: next.staff })[0];
        if (!slot) return { cmd, say: "No free time for that move." };
        return {
          cmd,
          say: `Move ${client.name}: ${when(next.start, "en")} → ${when(slot.start, "en")} with ${staffName(b, slot.staff)}?`,
          confirm: {
            label: "Move",
            run: () =>
              this.serial(async () => {
                await this.saveBooking({ ...next, start: slot.start, staff: slot.staff });
                await this.log("command", `Staff: moved ${client.name} to ${when(slot.start, "en")}`, { text, booking: next.id });
                return next.id;
              }),
          },
          show: { view: "calendar", day: slot.start.slice(0, 10), ids: [next.id] },
        };
      }
      case "inactive": {
        const limit = addDays(now, -cmd.days).getTime();
        const lastVisit = (c: ClientMemory) => Math.max(c.last, ...bookings.filter((k) => k.client === c.id && k.status === "booked").map((k) => new Date(k.start).getTime()));
        const ids = [...this.clients.values()].filter((c) => lastVisit(c) < limit).map((c) => c.id);
        return { cmd, say: ids.length ? `${ids.length} client${ids.length > 1 ? "s have" : " has"} not been in touch for ${cmd.days} days.` : `Every client was in touch in the last ${cmd.days} days.`, show: { view: "clients", ids } };
      }
      case "stats": {
        const from = cmd.day ?? ymd(now);
        const to = cmd.week ? ymd(addDays(new Date(`${from}T00:00`), 6)) : from;
        const list = bookings.filter((k) => k.status === "booked" && k.start.slice(0, 10) >= from && k.start.slice(0, 10) <= to);
        const sum = list.reduce((s, k) => s + k.price, 0);
        const period = cmd.week ? `${from} to ${to}` : from;
        return { cmd, say: cmd.what === "revenue" ? `Expected revenue for ${period}: ${money(b, sum)} from ${list.length} bookings.` : `${list.length} booking${list.length === 1 ? "" : "s"} for ${period} (${money(b, sum)}).`, show: { view: "calendar", day: from, ids: list.map((k) => k.id) } };
      }
      case "remember":
        return {
          cmd,
          say: `Save to the knowledge: «${cmd.text}»?`,
          confirm: { label: "Save", run: () => this.addKnowledge(cmd.text.split(/[.!?]/)[0].slice(0, 80), cmd.text, "business").then((e) => e.id) },
          show: { view: "knowledge" },
        };
      case "service": {
        const exists = b.services.find((s) => Object.values(s.names).some((n) => n.toLowerCase() === cmd.name.toLowerCase()));
        if (exists) return { cmd, say: `${cmd.name} is already a service.` };
        const s: Service = { id: `SV-${Date.now().toString(36).slice(-5).toUpperCase()}`, names: { ru: cmd.name, kk: cmd.name, en: cmd.name }, minutes: cmd.minutes, price: cmd.price, stems: [cmd.name.toLowerCase().slice(0, Math.max(4, cmd.name.length - 1))] };
        return { cmd, say: `Add the service ${cmd.name}: ${money(b, cmd.price)}, ${cmd.minutes} min? The AI will write 6 training phrases about it.`, confirm: { label: "Add service", run: () => this.addService(s).then(() => s.id) }, show: { view: "business" } };
      }
      case "open": {
        const client = find(cmd.name);
        return client ? { cmd, say: `${client.name}: ${client.messages} messages, ${client.bookings} bookings.`, show: { view: "clients", ids: [client.id] } } : { cmd, say: `I don't know a client called ${cmd.name}.` };
      }
      default:
        return { cmd, say: "I can book, move and cancel bookings, find clients, count bookings and revenue, remember facts and add services. Try one of the examples." };
    }
  }

  /** Numbers for the dashboard. */
  stats() {
    const phrases = this.learner.phrases;
    const bySource = Object.fromEntries(["client", "operator", "business", "auto"].map((s) => [s, phrases.filter((p) => p.source === s).length]));
    const stream = this.events.filter((e) => e.kind === "message" && e.detail && "ok" in e.detail).map((e) => ({ at: e.at, ok: !!e.detail!.ok, frozenOk: !!e.detail!.frozenOk }));
    const live = this.learner.live;
    return {
      phrases: phrases.length,
      bySource,
      seed: this.learner.seed.length,
      vocabulary: this.learner.model.vocabularySize,
      startVocabulary: this.learner.frozen.vocabularySize,
      version: live?.n ?? 0,
      pending: this.learner.pending,
      clients: this.clients.size,
      bookings: [...this.bookings.values()].filter((b) => b.status === "booked").length,
      knowledge: this.entries.length,
      chunks: this.knowledge.size,
      queue: this.queue.size,
      messages: this.events.filter((e) => e.kind === "message").length,
      stream,
    };
  }
}
