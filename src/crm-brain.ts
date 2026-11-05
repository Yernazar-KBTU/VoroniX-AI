// The VoroniX AI "brain" for a CRM page: one object that reads a client's
// message with our own model, decides what to do in the CRM (offer times,
// book, cancel, answer from the knowledge, hand over to a person), and keeps
// learning on its own:
//   - a phrase is learned the moment a conversation proves what it meant
//     (a booking, a cancel, a thank-you after an answer);
//   - a question it could not answer waits for a person, and the person's
//     answer becomes knowledge at once and a lesson for the model;
//   - every RETRAIN_EVERY new phrases it retrains on everything and keeps the
//     new version only if it is not worse on phrases it did not train on.
// No outside AI service is used. The CRM owns its data; the brain only keeps
// what it learned (phrases, versions, client memory, open questions) and hands
// that to the page to save.
import { parseExamples, type Example, type Label, type Lang } from "./data.js";
import type { IntentModel } from "./model.js";
import { respond, type Outcome } from "./live/agent.js";
import { DEMO_BUSINESS, makeService } from "./live/crm.js";
import { Knowledge, type Hit } from "./live/knowledge.js";
import { Learner, RETRAIN_EVERY, type LearnResult } from "./live/learner.js";
import { newClient } from "./live/memory.js";
import type { Booking, Business, Channel, ClientMemory, KnowledgeEntry, Phrase, Version } from "./live/types.js";

/** What the brain learned, as plain JSON for the page to save. */
export interface BrainState {
  v: 1;
  phrases: Phrase[];
  versions: Version[];
  clients: Record<string, ClientMemory>;
  questions: Question[];
}

/** A question the AI could not answer, waiting for a person. */
export interface Question {
  id: string;
  text: string;
  lang: Lang;
  guess: Label[];
  at: number;
  client?: string;
  clientName?: string;
  kind: "unanswered" | "unsure" | "complaint";
}

/** A service as the CRM page keeps it. */
export interface CrmService {
  id: string;
  name: string;
  minutes: number;
  price: number;
  active?: boolean;
}
export interface CrmStaff {
  id: string;
  name: string;
  role?: string;
  days: number[];
  from: string;
  to: string;
  services: string[];
  active?: boolean;
}
export interface CrmBusiness {
  name: string;
  city?: string;
  address: string;
  from: string;
  to: string;
  phone?: string;
  currency?: string;
  services: CrmService[];
  staff: CrmStaff[];
}
export interface CrmBooking {
  id: string;
  client: string;
  clientName?: string;
  service: string;
  staff: string;
  /** "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM". */
  start: string;
  minutes?: number;
  price?: number;
  cancelled?: boolean;
}

export interface Turn {
  /** The client as the brain remembers them, for example the chat id. */
  client: { id: string; name: string; channel?: string; handle?: string };
  text: string;
  business: CrmBusiness;
  bookings: CrmBooking[];
  knowledge: { id: string; title: string; text: string }[];
  now?: Date;
}

export interface TurnResult {
  outcome: Outcome;
  /** "YYYY-MM-DD HH:MM" of a booking the client just agreed to, ready for the CRM. */
  book?: { service: string; staff: string; start: string; name: string };
  cancel?: { id: string };
  handoff?: string;
  lessons: LearnResult[];
  question?: Question;
  retrain?: Promise<Version | null>;
}

const id = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const channelOf = (c?: string): Channel | "crm" => {
  const k = (c ?? "").toLowerCase();
  return k === "instagram" || k === "telegram" || k === "whatsapp" ? k : "crm";
};
const dayKey = (s: string) => s.replace(" ", "T").slice(0, 16);

/** Maps the CRM's business to the one the agent works with; known demo services keep their Russian and Kazakh names and stems. */
export function toBusiness(c: CrmBusiness): Business {
  const known = new Map(DEMO_BUSINESS.services.map((s) => [s.id, s]));
  return {
    name: c.name,
    city: c.city ?? "",
    address: { ru: c.address, kk: c.address, en: c.address },
    from: c.from,
    to: c.to,
    phone: c.phone ?? "",
    currency: c.currency ?? "₸",
    services: c.services
      .filter((s) => s.active !== false)
      .map((s) => {
        const k = known.get(s.id);
        const base = k ?? { ...makeService(s.name, s.price, s.minutes, "en"), id: s.id };
        return { ...base, id: s.id, minutes: s.minutes, price: s.price, names: k ? k.names : { ru: s.name, kk: s.name, en: s.name } };
      }),
    staff: c.staff.filter((s) => s.active !== false).map((s) => ({ id: s.id, name: s.name, role: s.role ?? "", days: s.days, from: s.from, to: s.to, services: s.services })),
  };
}

export class CrmBrain {
  readonly learner: Learner;
  readonly knowledge = new Knowledge();
  clients: Record<string, ClientMemory> = {};
  questions: Question[] = [];
  retrainEvery = RETRAIN_EVERY;
  retraining = false;
  private job: Promise<Version | null> | undefined;
  /** Called after anything the page should save. */
  onChange: (state: BrainState) => void = () => {};

  constructor(seed: Example[], model?: IntentModel) {
    this.learner = new Learner(seed, model);
  }

  /** Builds the brain from the start phrases (data/phrases.tsv as text). */
  static fromPhrases(tsv: string, model?: IntentModel): CrmBrain {
    return new CrmBrain(parseExamples(tsv), model);
  }

  get model(): IntentModel {
    return this.learner.model;
  }

  /** Puts back what was learned before: the model is rebuilt from the saved phrases, step by step, exactly as it was. */
  async load(state: Partial<BrainState> | null | undefined): Promise<void> {
    if (!state) return;
    await this.learner.load(state.phrases ?? [], state.versions ?? []);
    this.clients = { ...(state.clients ?? {}) };
    this.questions = [...(state.questions ?? [])];
  }

  state(): BrainState {
    return { v: 1, phrases: this.learner.phrases, versions: this.learner.versions, clients: this.clients, questions: this.questions };
  }

  stats() {
    const live = this.learner.live;
    return {
      phrases: this.learner.phrases.length,
      pending: this.learner.pending,
      retrainEvery: this.retrainEvery,
      version: live?.id ?? "v0000",
      versions: this.learner.versions.length,
      metrics: live?.metrics ?? null,
      clients: Object.keys(this.clients).length,
      questions: this.questions.length,
      retraining: this.retraining,
    };
  }

  read(text: string) {
    return this.model.predict(text);
  }

  private setKnowledge(entries: Turn["knowledge"], b: Business) {
    this.knowledge.set(
      entries.map((e, i): KnowledgeEntry => ({ id: e.id, title: e.title, text: e.text, source: "operator", at: entries.length - i })),
      b,
    );
  }

  /** Handles one client message: what it means, the reply, and what the CRM should do. Learns what the conversation proved. */
  reply(t: Turn): TurnResult {
    const now = t.now ?? new Date();
    const at = now.getTime();
    const b = toBusiness(t.business);
    this.setKnowledge(t.knowledge, b);
    const bookings: Booking[] = t.bookings.map((k) => ({
      id: k.id,
      client: k.client,
      clientName: k.clientName ?? "",
      service: k.service,
      staff: k.staff,
      start: dayKey(k.start),
      minutes: k.minutes ?? b.services.find((s) => s.id === k.service)?.minutes ?? 60,
      price: k.price ?? 0,
      status: k.cancelled ? "cancelled" : "booked",
      source: "crm",
      at: 0,
    }));
    const known = this.clients[t.client.id];
    const client = known ? { ...known, name: t.client.name || known.name } : newClient(t.client.id, t.client.name, channelOf(t.client.channel), t.client.handle ?? "", "ru", at);
    const outcome = respond({ model: this.model, knowledge: this.knowledge, business: b, bookings, now, newId: id }, client, t.text, at);
    this.clients[t.client.id] = outcome.client;

    const res: TurnResult = { outcome, lessons: [] };
    if (outcome.booking) res.book = { service: outcome.booking.service, staff: outcome.booking.staff, start: outcome.booking.start.replace("T", " "), name: outcome.client.name };
    if (outcome.cancelled) res.cancel = { id: outcome.cancelled.id };
    const handoff = outcome.actions.find((a) => a.type === "handoff");
    if (handoff) res.handoff = handoff.text;
    for (const q of outcome.queue) {
      const item: Question = { id: id("q"), at, ...q, kind: q.kind };
      // A complaint is handed to a person in the chat; only questions wait in the queue.
      if (q.kind !== "complaint" && !this.questions.some((x) => x.text === q.text)) {
        this.questions.unshift(item);
        this.questions = this.questions.slice(0, 200);
      }
      if (q.kind === "unanswered") res.question = item;
    }
    for (const l of outcome.learn) res.lessons.push(this.lesson({ text: l.text, lang: l.lang, labels: l.labels, why: l.why, source: "client", client: t.client.id }, at));
    res.retrain = this.maybeRetrain();
    this.onChange(this.state());
    return res;
  }

  /** A person checked a phrase (or taught one by hand): the model learns it now. */
  teach(text: string, labels: Label[], why = "Taught by a person", source: Phrase["source"] = "operator"): LearnResult {
    const lang = this.model.predict(text).lang as Lang;
    const r = this.lesson({ text, lang, labels, why, source }, Date.now());
    void this.maybeRetrain();
    this.onChange(this.state());
    return r;
  }

  /** Answers a waiting question: the answer becomes knowledge (returned for the CRM to save), the question is learned as «other». */
  answer(questionId: string, answer: string): { title: string; text: string } | null {
    const q = this.questions.find((x) => x.id === questionId);
    if (!q || !answer.trim()) return null;
    this.questions = this.questions.filter((x) => x.id !== questionId);
    const labels = q.guess.filter((l) => l !== "other");
    if (q.kind === "unsure" && labels.length) this.lesson({ text: q.text, lang: q.lang, labels, why: "A person confirmed the reading", source: "operator" }, Date.now());
    this.onChange(this.state());
    return { title: q.text.slice(0, 80), text: answer.trim() };
  }

  dismiss(questionId: string) {
    this.questions = this.questions.filter((x) => x.id !== questionId);
    this.onChange(this.state());
  }

  /** The best piece of knowledge for a question, or the business facts (prices, address, hours). */
  ask(question: string, business: CrmBusiness, entries: Turn["knowledge"]): Hit | null {
    const b = toBusiness(business);
    this.setKnowledge(entries, b);
    return this.knowledge.answer(question) ?? this.knowledge.search(question, 1)[0] ?? null;
  }

  private lesson(p: Omit<Phrase, "id" | "at">, at: number): LearnResult {
    return this.learner.learn({ ...p, id: id("ph"), at: at + this.learner.phrases.length / 1000 });
  }

  /** Retrains in the background once enough new phrases are learned. Resolves with the new version, or null. */
  maybeRetrain(force = false): Promise<Version | null> | undefined {
    if (this.retraining) return this.job;
    if (!force && this.learner.pending < this.retrainEvery) return undefined;
    this.retraining = true;
    return (this.job = (async () => {
      try {
        const r = await this.learner.retrain(force ? "by hand" : `auto: ${this.learner.pending} new phrases`);
        await this.learner.apply(r.version, r.model);
        this.onChange(this.state());
        return r.version;
      } finally {
        this.retraining = false;
      }
    })());
  }
}
