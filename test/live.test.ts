// VoroniX AI at work: reading messages, answering in three languages, acting
// in the CRM, learning from conversations and rebuilding the same model on
// every page from the saved data.
import { describe, expect, it } from "vitest";
import { augment, loadExamples } from "../src/data.js";
import { score } from "../src/evaluate.js";
import { IntentModel } from "../src/model.js";
import { COMMAND_EXAMPLES, parseCommand } from "../src/live/commands.js";
import { DEMO_BUSINESS, freeSlots } from "../src/live/crm.js";
import { parseDay, parseTime, sameName } from "../src/live/entities.js";
import { Knowledge } from "../src/live/knowledge.js";
import { isRight, Learner, SETTINGS } from "../src/live/learner.js";
import { Live } from "../src/live/runtime.js";
import { MemoryStore } from "../src/live/store.js";
import { STARTER_KNOWLEDGE, STREAM } from "../src/live/stream.js";
import type { Phrase } from "../src/live/types.js";

const seed = loadExamples();
const start = IntentModel.train(augment(seed), SETTINGS);
// Thursday 5 November 2026, 12:00: every date below is counted from here.
const NOW = new Date(2026, 10, 5, 12, 0);
const now = () => new Date(NOW);
async function open(store = new MemoryStore()) {
  const live = new Live(store, seed, now, start);
  await live.start();
  return live;
}
const PROBES = ["Сколько стоит фейд?", "Ертеңге орын бар ма?", "Can you squeeze me in tomorrow?", "Отмените запись, пожалуйста", "Рахмет!", "Where are you located?"];
const SLOW = { timeout: 120_000 };

describe("reading a message", () => {
  it("finds the day in Russian, Kazakh and English", () => {
    expect(parseDay("Можно завтра?", NOW)).toBe("2026-11-06");
    expect(parseDay("Ертең бола ма?", NOW)).toBe("2026-11-06");
    expect(parseDay("tomorrow please", NOW)).toBe("2026-11-06");
    expect(parseDay("в субботу", NOW)).toBe("2026-11-07");
    expect(parseDay("на 12.11", NOW)).toBe("2026-11-12");
    expect(parseDay("на 01.01", NOW)).toBe("2027-01-01");
    expect(parseDay("Сколько стоит?", NOW)).toBeNull();
  });

  it("finds the time: exact or a part of the day", () => {
    expect(parseTime("в 15:00")).toEqual({ exact: "15:00" });
    expect(parseTime("at 6pm")).toEqual({ exact: "18:00" });
    expect(parseTime("сағат 3-те")).toEqual({ exact: "15:00" });
    expect(parseTime("кешке")).toEqual({ from: 17 * 60 });
    expect(parseTime("после 6")).toEqual({ from: 18 * 60 });
  });

  it("matches a name written in another script or case", () => {
    expect(sameName("Алию", "Aliya")).toBe(true);
    expect(sameName("Армана", "Arman T.")).toBe(true);
    expect(sameName("Алию", "Arman K.")).toBe(false);
  });
});

describe("knowledge", () => {
  const k = new Knowledge();
  k.set(STARTER_KNOWLEDGE.map((e, i) => ({ id: `k${i}`, ...e, source: "business" as const, at: i })), DEMO_BUSINESS);

  it("finds the right text, even for another form of the word", () => {
    expect(k.answer("Есть где припарковаться?")?.entry.title).toBe("Парковка / Parking");
    expect(k.answer("Можно оплатить через Kaspi QR?")?.entry.title).toBe("Оплата / Payment");
  });

  it("does not answer from a text that shares only one word with the question", () => {
    expect(k.answer("Do you sell gift cards?")).toBeNull();
  });
});

describe("conversations", () => {
  it("books a client in Kazakh and learns the first message as a booking request", async () => {
    const live = await open();
    const ask = await live.receive({ name: "Aliya", channel: "telegram", text: "Сәлем! Ертең кешке шаш қиюға жазылуға бола ма?" });
    expect(ask.outcome.lang).toBe("kk");
    expect(ask.outcome.reply).toMatch(/бос уақыт/);
    const yes = await live.receive({ name: "Aliya", channel: "telegram", text: "Иә, біріншісі" });
    const booking = yes.outcome.booking!;
    expect(booking.start.slice(0, 10)).toBe("2026-11-06");
    expect(Number(booking.start.slice(11, 13))).toBeGreaterThanOrEqual(17);
    expect(yes.outcome.reply).toMatch(/Дайын/);
    expect(yes.learned.map((l) => l.phrase.text)).toContain("Сәлем! Ертең кешке шаш қиюға жазылуға бола ма?");
    expect(live.clients.get(yes.client.id)?.bookings).toBe(1);
    // The AI never offers a time that is already taken.
    const free = freeSlots(DEMO_BUSINESS, [...live.bookings.values()], booking.service, "2026-11-06", { now: NOW, staff: booking.staff, limit: 100 });
    expect(free.some((s) => s.start === booking.start && s.staff === booking.staff)).toBe(false);
  });

  it("answers a price question in English with the price from the CRM", async () => {
    const live = await open();
    const r = await live.receive({ name: "Dana", channel: "instagram", text: "How much is a men's haircut?" });
    expect(r.outcome.lang).toBe("en");
    expect(r.outcome.labels).toContain("price");
    expect(r.outcome.reply).toContain("7");
    expect(r.outcome.reply).toContain("₸");
  });

  it("cancels the booking when a client writes that they cannot come", async () => {
    const live = await open();
    await live.receive({ name: "Bekzat", channel: "whatsapp", text: "Хочу записаться на стрижку завтра" });
    const yes = await live.receive({ name: "Bekzat", channel: "whatsapp", text: "Да, первый" });
    expect(yes.outcome.booking).toBeDefined();
    const no = await live.receive({ name: "Bekzat", channel: "whatsapp", text: "Не смогу прийти, отмените" });
    expect(no.outcome.cancelled?.id).toBe(yes.outcome.booking!.id);
    expect(live.bookings.get(yes.outcome.booking!.id)?.status).toBe("cancelled");
  });

  it("hands a complaint to a person, then learns it once it is handled", async () => {
    const live = await open();
    const r = await live.receive({ name: "Timur", channel: "instagram", text: "Мастер испортил мне стрижку, это ужас" });
    const item = r.queued.find((q) => q.kind === "complaint")!;
    expect(item).toBeDefined();
    await live.resolve(item.id);
    expect(live.queue.has(item.id)).toBe(false);
    expect(live.learner.phrases.at(-1)).toMatchObject({ text: item.text, labels: ["complaint"], source: "operator" });
  });

  it("puts an unknown question in the queue, and gives a person's answer to the next client who asks", async () => {
    const live = await open();
    const r = await live.receive({ name: "Aigerim", channel: "telegram", text: "Do you sell gift cards?" });
    const item = r.queued.find((q) => q.kind === "unanswered")!;
    expect(item).toBeDefined();
    await live.answer(item.id, "Yes: gift cards from 10 000 ₸, valid for 6 months.");
    const next = await live.receive({ name: "Olzhas", channel: "instagram", text: "Do you sell gift cards?" });
    expect(next.outcome.reply).toContain("gift cards from 10 000 ₸");
    expect(next.queued.some((q) => q.kind === "unanswered")).toBe(false);
  });
});

describe("learning at work", () => {
  it("fixes a phrase it got wrong in a few steps, without forgetting the start phrases", async () => {
    const learner = new Learner(seed, start);
    await learner.load([], []);
    const miss = STREAM.flatMap((d) => d.turns.map((t) => ({ ...t, lang: d.lang }))).find((t) => !isRight(start.predict(t.text), t.labels))!;
    const p: Phrase = { id: "p-test-0001", text: miss.text, lang: miss.lang, labels: miss.labels, source: "business", why: "test", at: 1 };
    const before = score(learner.model, seed).exact_match;
    const r = learner.learn(p);
    expect(r.correct).toBe(false);
    expect(r.steps).toBeLessThanOrEqual(8);
    expect(isRight(learner.model.predict(miss.text), miss.labels)).toBe(true);
    expect(isRight(learner.frozen.predict(miss.text), miss.labels)).toBe(false);
    expect(score(learner.model, seed).exact_match).toBeGreaterThanOrEqual(before - 0.01);
  });

  it(
    "over the demo stream: learns from conversations, beats the frozen model, and a page opened later rebuilds exactly the same model",
    SLOW,
    async () => {
      const store = new MemoryStore();
      const a = await open(store);
      a.retrainEvery = 10_000;
      await a.play({ delay: 0, operator: true });
      const s = a.stats();
      const share = (k: "ok" | "frozenOk") => s.stream.filter((x) => x[k]).length / s.stream.length;
      expect(s.stream.length).toBe(STREAM.reduce((n, d) => n + d.turns.length, 0));
      expect(share("ok")).toBeGreaterThan(share("frozenOk"));
      expect(s.bySource.client).toBeGreaterThanOrEqual(25);
      expect(s.bySource.auto).toBe(6);
      expect(s.bookings).toBeGreaterThanOrEqual(10);
      expect(s.knowledge).toBeGreaterThanOrEqual(STARTER_KNOWLEDGE.length);
      // What it learned does not break what it knew.
      expect(score(a.learner.model, seed).exact_match).toBeGreaterThanOrEqual(score(start, seed).exact_match - 0.02);

      const b = await open(store);
      expect(b.learner.phrases.map((p) => p.id)).toEqual(a.learner.phrases.map((p) => p.id));
      expect(b.learner.model.vocabularySize).toBe(a.learner.model.vocabularySize);
      for (const t of PROBES) expect(b.learner.model.predict(t).scores).toEqual(a.learner.model.predict(t).scores);
      expect(b.clients.size).toBe(a.clients.size);
      expect(b.bookings.size).toBe(a.bookings.size);

      // A retrain: the new version goes live only if it is not worse, and new pages load it.
      const v = (await a.retrain("test"))!;
      expect(v.metrics.exact).toBeGreaterThan(0.6);
      const tie = Math.max(0.005, 1 / v.holdout);
      if (v.status === "live") expect(v.metrics.exact).toBeGreaterThanOrEqual(v.prev!.exact - tie - 1e-9);
      else expect(v.metrics.exact).toBeLessThan(v.prev!.exact - tie);
      // Kept or not, the next automatic retrain waits for new phrases.
      expect(a.learner.pending).toBe(0);
      const c = await open(store);
      expect(c.learner.live?.id).toBe(a.learner.live?.id);
      for (const t of PROBES) expect(c.learner.model.predict(t).scores).toEqual(a.learner.model.predict(t).scores);
    },
  );
});

describe("staff commands", () => {
  it("reads every example command", () => {
    const kinds = COMMAND_EXAMPLES.map((c) => parseCommand(c, DEMO_BUSINESS, NOW).kind);
    expect(kinds).toEqual(["book", "book", "move", "cancel", "inactive", "stats", "remember", "service", "open"]);
    expect(parseCommand("Добавь услугу Фейд 8000 45 мин", DEMO_BUSINESS, NOW)).toMatchObject({ name: "Фейд", price: 8000, minutes: 45 });
    expect(parseCommand("что-то непонятное", DEMO_BUSINESS, NOW).kind).toBe("help");
  });

  it("books and cancels only after the confirm click", async () => {
    const live = await open();
    const plan = live.command("Запиши Алию на завтра в 15:00 на мужскую стрижку");
    expect(plan.cmd.kind).toBe("book");
    expect(live.bookings.size).toBe(0);
    const id = await plan.confirm!.run();
    const booking = live.bookings.get(id)!;
    expect(booking).toMatchObject({ start: "2026-11-06T15:00", service: "HC-01", status: "booked", source: "crm" });
    const cancel = live.command("Отмени запись Алии");
    expect(cancel.cmd.kind).toBe("cancel");
    expect(live.bookings.get(id)?.status).toBe("booked");
    await cancel.confirm!.run();
    expect(live.bookings.get(id)?.status).toBe("cancelled");
  });
});

describe("storage", () => {
  it("saves, changes, deletes and tells every watcher", async () => {
    const store = new MemoryStore();
    const seen: number[] = [];
    const stop = store.watch("knowledge", (rows) => seen.push(rows.length));
    await store.put("knowledge", { id: "k1", title: "A", text: "a" });
    await store.patch("knowledge", "k1", { text: "b" });
    expect(await store.all("knowledge")).toEqual([{ id: "k1", title: "A", text: "b" }]);
    await store.remove("knowledge", "k1");
    await new Promise((ok) => setTimeout(ok, 0));
    stop();
    expect(await store.all("knowledge")).toEqual([]);
    expect(seen.at(-1)).toBe(0);
  });
});
