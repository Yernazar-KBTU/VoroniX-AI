// The brain a CRM page uses: it answers from the CRM's own data, tells the CRM
// what to do, learns what conversations prove, and comes back the same after a reload.
import { describe, expect, it } from "vitest";
import { CrmBrain, type CrmBusiness, type CrmBooking, type CrmLiveMessage } from "../src/crm-brain.js";
import { Live } from "../src/live/runtime.js";
import { MemoryStore } from "../src/live/store.js";
import { loadTraining } from "../src/data.js";
import { DEMO_BUSINESS } from "../src/live/crm.js";

const seed = loadTraining();
// The business as the CRM demo keeps it: English names, its own fields.
const business: CrmBusiness = {
  name: "Barberista",
  address: "98 Panfilov St, Almaty",
  from: "10:00",
  to: "21:00",
  services: DEMO_BUSINESS.services.map((s) => ({ id: s.id, name: s.names.en, minutes: s.minutes, price: s.price })),
  staff: DEMO_BUSINESS.staff.map((s) => ({ id: s.id, name: s.name, days: s.days, from: s.from, to: s.to, services: s.services })),
};
const kb = [{ id: "KB-1", title: "Parking", text: "Parking in front of the barbershop for 4 cars, free for clients." }];
const now = new Date(2026, 10, 9, 11, 0); // Monday 11:00

describe("CRM brain", () => {
  const brain = new CrmBrain(seed);
  const bookings: CrmBooking[] = [];
  const turn = (client: string, text: string) => brain.reply({ client: { id: client, name: "", channel: "Telegram" }, text, business, bookings, knowledge: kb, now });

  it("answers a price from the CRM data in Russian", () => {
    const r = turn("c1", "Сколько стоит VIP ритуал?");
    expect(r.outcome.lang).toBe("ru");
    expect(r.outcome.reply).toMatch(/VIP-ритуал стоит 22 000 ₸/);
  });

  it("offers free times, then books when the client agrees, and learns the request", () => {
    const offer = turn("c2", "Хочу записаться на стрижку завтра вечером");
    expect(offer.outcome.reply).toMatch(/свободно/);
    const before = brain.stats().phrases;
    const ok = turn("c2", "Давайте первый вариант");
    expect(ok.book).toMatchObject({ service: "HC-01" });
    expect(ok.book!.start).toMatch(/^2026-11-10 \d\d:\d\d$/);
    expect(ok.lessons.length).toBeGreaterThan(0);
    expect(brain.stats().phrases).toBeGreaterThan(before);
    bookings.push({ id: "AP-1", client: "c2", service: ok.book!.service, staff: ok.book!.staff, start: ok.book!.start });
  });

  it("tells the client their own bookings", () => {
    expect(turn("c2", "когда я записан?").outcome.reply).toMatch(/^Ваши записи: Мужская стрижка, .*10\.11/);
    expect(turn("c9", "my bookings").outcome.reply).toMatch(/no upcoming bookings/);
  });

  it("a short answer during a booking continues it, and an offered time can be named", () => {
    const first = turn("c6", "хочу записаться на бороду");
    expect(first.outcome.reply).toMatch(/свободно/);
    const next = turn("c6", "завтра");
    expect(next.outcome.reply).toMatch(/свободно .*10\.11/);
    const time = /10\.11, (\d\d:\d\d)/.exec(next.outcome.reply)![1];
    const ok = turn("c6", `давайте в ${time}`);
    expect(ok.book?.start).toBe(`2026-11-10 ${time}`);
  });

  it("cancels the client's own booking", () => {
    const r = turn("c2", "Извините, отмените мою запись");
    expect(r.cancel).toEqual({ id: "AP-1" });
  });

  it("hands a complaint to a person", () => {
    const r = turn("c3", "Маған мүлдем ұнамады, қызмет нашар");
    expect(r.handoff).toBeTruthy();
  });

  it("answers from the owner's knowledge, and queues what it cannot answer", () => {
    expect(turn("c4", "Is there parking near you?").outcome.reply).toMatch(/Parking in front/);
    const q = turn("c5", "Можно ли прийти с собакой?");
    expect(q.question?.text).toBe("Можно ли прийти с собакой?");
    expect(brain.questions.some((x) => x.text === "Можно ли прийти с собакой?")).toBe(true);
    const k = brain.answer(q.question!.id, "Да, с маленькими собаками можно.");
    expect(k?.text).toBe("Да, с маленькими собаками можно.");
    expect(brain.questions.some((x) => x.id === q.question!.id)).toBe(false);
  });

  it("comes back with exactly the same model after a reload", async () => {
    const saved = JSON.parse(JSON.stringify(brain.state()));
    const again = new CrmBrain(seed);
    await again.load(saved);
    const text = "Хочу записаться на стрижку завтра вечером";
    expect(again.read(text).scores).toEqual(brain.read(text).scores);
    expect(again.stats().phrases).toBe(brain.stats().phrases);
    expect(again.questions).toEqual(brain.questions);
  });

  it("retrains by itself after enough new phrases and keeps a version that is not worse", async () => {
    const b = new CrmBrain(seed);
    b.retrainEvery = 3;
    const words = ["Подскажите цену на бритьё", "Сколько стоит борода", "Цена детской стрижки"];
    let job: Promise<unknown> | undefined;
    for (const w of words) {
      b.teach(w, ["price"]);
      job = job ?? b.maybeRetrain();
    }
    const v = (await job) as { status: string } | null;
    expect(["live", "rejected"]).toContain(v?.status);
    expect(b.stats().versions).toBe(1);
  }, 60_000);

  it("tells the VoroniX AI site (another tab) about every message, and the site shows it", async () => {
    const b = new CrmBrain(seed, brain.model);
    b.broadcast("vx-test");
    const ear = new BroadcastChannel("vx-test");
    const got = new Promise<CrmLiveMessage>((ok) => (ear.onmessage = (e) => ok(e.data as CrmLiveMessage)));
    b.reply({ client: { id: "t1", name: "Aidos", channel: "Telegram" }, text: "Сколько стоит VIP ритуал?", business, bookings: [], knowledge: kb, now });
    const m = await got;
    ear.close();
    expect(m.processed.text).toBe("Сколько стоит VIP ритуал?");
    expect(m.processed.channel).toBe("telegram");
    expect(m.processed.fwd.lang).toBeDefined();
    expect(m.processed.outcome.reply).toMatch(/22 000/);
    const site = new Live(new MemoryStore(), seed, undefined, brain.model);
    await site.start();
    const drawn: unknown[] = [];
    site.on("processed", (d) => drawn.push(d));
    await site.fromCrm(m);
    expect(drawn.length).toBe(1);
    const ev = site.events.at(-1)!;
    expect(ev.kind).toBe("message");
    expect(ev.detail).toMatchObject({ from: "crm", name: "Aidos", text: "Сколько стоит VIP ритуал?" });
  });
});
