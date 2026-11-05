// The AI administrator: reads a client's message with the model, takes the
// action in the CRM (offer free times, book, cancel, hand over to a manager),
// answers in the client's language and says what it learned from the
// conversation. Everything it knows comes from our own model, the business
// data, the knowledge texts and its memory of the client.
import type { Label, Lang } from "../data.js";
import type { IntentModel, Prediction } from "../model.js";
import { money, nextFree, serviceName, staffName, upcoming, when, type Slot } from "./crm.js";
import { isComplaint, matchService, ordinal, parseDay, parseName, parseTime, ruleLang, saysYes, type TimePref } from "./entities.js";
import type { Hit, Knowledge } from "./knowledge.js";
import { habits, remember, rememberBooking } from "./memory.js";
import type { Booking, Business, ClientMemory, Dialog, QueueItem, Said } from "./types.js";

export interface AgentContext {
  model: IntentModel;
  knowledge: Knowledge;
  business: Business;
  bookings: Booking[];
  now: Date;
  newId: (prefix: string) => string;
}

export interface Action {
  type: "offer" | "book" | "cancel" | "handoff" | "answer" | "knowledge" | "ask" | "unknown";
  text: string;
}

export interface Outcome {
  prediction: Prediction;
  lang: Lang;
  /** What the AI decided the message means: the model's intents, completed by the conversation. */
  labels: Label[];
  unsure: boolean;
  reply: string;
  actions: Action[];
  /** Phrases the conversation proved, to learn now. */
  learn: (Said & { why: string })[];
  queue: Omit<QueueItem, "id" | "at">[];
  client: ClientMemory;
  booking?: Booking;
  cancelled?: Booking;
  hit?: Hit | null;
  entities: { service?: string; day?: string | null; time?: TimePref | null; name?: string | null };
}

/** Below this score the AI still answers, but asks a person to check its reading. */
export const SURE = 0.7;

type Say = Record<Lang, string>;
const T = {
  hello: (n: string): Say => ({ ru: `Здравствуйте${n ? `, ${n}` : ""}!`, kk: `Сәлеметсіз бе${n ? `, ${n}` : ""}!`, en: `Hello${n ? `, ${n}` : ""}!` }),
  help: { ru: "Чем могу помочь? Могу записать вас, подсказать цены, адрес и часы работы.", kk: "Қалай көмектесе аламын? Жазып қоямын, бағасын, мекенжайды және жұмыс уақытын айтамын.", en: "How can I help? I can book you in and tell you prices, the address and opening hours." },
  welcomeBack: (s: string, m: string): Say => ({ ru: `Рады снова видеть! Как обычно, ${s} у мастера ${m}?`, kk: `Қайта көргенімізге қуаныштымыз! Әдеттегідей, ${s}, шебер ${m}?`, en: `Good to see you again! The usual ${s} with ${m}?` }),
  askService: (l: string): Say => ({ ru: `На какую услугу вас записать? Например: ${l}.`, kk: `Қай қызметке жазайын? Мысалы: ${l}.`, en: `Which service would you like? For example: ${l}.` }),
  offer: (s: string, l: string): Say => ({ ru: `${s}: свободно ${l}. Какое время удобно?`, kk: `${s}: бос уақыт ${l}. Қайсысы ыңғайлы?`, en: `${s}: free times ${l}. Which one suits you?` }),
  booked: (s: string, w: string, m: string, p: string): Say => ({ ru: `Готово! Вы записаны: ${s}, ${w}, мастер ${m}. Стоимость ${p}. Ждём вас!`, kk: `Дайын! Сіз жазылдыңыз: ${s}, ${w}, шебер ${m}. Бағасы ${p}. Күтеміз!`, en: `Done! You're booked: ${s}, ${w} with ${m}. Price ${p}. See you!` }),
  noSlots: { ru: "К сожалению, на ближайшую неделю свободного времени нет. Я передал вопрос администратору.", kk: "Өкінішке қарай, жақын аптада бос уақыт жоқ. Сұрағыңызды әкімшіге жібердім.", en: "Sorry, there is no free time in the coming week. I've passed this to the manager." },
  cancelled: (s: string, w: string): Say => ({ ru: `Ваша запись отменена: ${s}, ${w}. Захотите прийти в другой день, просто напишите.`, kk: `Жазылуыңыз болдырылмады: ${s}, ${w}. Басқа күні келгіңіз келсе, жазыңыз.`, en: `Your booking is cancelled: ${s}, ${w}. Message us any time to book another day.` }),
  noBooking: { ru: "Не нашёл ваших будущих записей. Возможно, запись оформлена на другое имя?", kk: "Сіздің алдағы жазылуыңыз табылмады. Басқа атқа жазылған болуы мүмкін бе?", en: "I can't find an upcoming booking for you. Could it be under another name?" },
  price: (s: string, p: string, m: number): Say => ({ ru: `${s} стоит ${p}, длится ${m} мин. Записать вас?`, kk: `${s} бағасы ${p}, ұзақтығы ${m} минут. Жазып қояйын ба?`, en: `${s} costs ${p} and takes ${m} min. Shall I book you in?` }),
  priceList: (l: string): Say => ({ ru: `Наши цены: ${l}.`, kk: `Біздің бағалар: ${l}.`, en: `Our prices: ${l}.` }),
  address: (a: string): Say => ({ ru: `Мы находимся по адресу: ${a}.`, kk: `Біздің мекенжай: ${a}.`, en: `We're at ${a}.` }),
  hours: (f: string, t: string): Say => ({ ru: `Работаем каждый день с ${f} до ${t}.`, kk: `Күн сайын ${f}-ден ${t}-ге дейін жұмыс істейміз.`, en: `We're open every day from ${f} to ${t}.` }),
  thanks: { ru: "Пожалуйста! Будем рады вас видеть.", kk: "Оқасы жоқ! Сізді күтеміз.", en: "You're welcome! See you soon." },
  complaint: { ru: "Мне очень жаль, что так вышло. Ваше сообщение передано менеджеру, он свяжется с вами в ближайшее время.", kk: "Осындай жағдай болғанына өте өкінемін. Хабарыңыз менеджерге жіберілді, ол жақын арада хабарласады.", en: "I'm really sorry about this. Your message is with our manager, who will contact you shortly." },
  ok: { ru: "Хорошо!", kk: "Жақсы!", en: "Great!" },
  unknown: { ru: "Хороший вопрос. Уточню у администратора и сразу вам напишу.", kk: "Жақсы сұрақ. Әкімшіден нақтылап, сізге бірден жазамын.", en: "Good question. Let me check with the manager and get back to you." },
};

const chan = (m: ClientMemory) => (m.channel === "crm" ? {} : { channel: m.channel });

const langOf = (s: string): Lang => (/[әғқңөұүһі]/i.test(s) ? "kk" : /[а-яё]/i.test(s) ? "ru" : "en");
/** A knowledge text written in several languages: keep the sentences in the client's language. */
function inLang(text: string, lang: Lang): string {
  const own = text.split(/(?<=[.!?])\s+/).filter((s) => langOf(s) === lang);
  return own.length ? own.join(" ") : text;
}

function offerText(b: Business, slots: Slot[], lang: Lang): string {
  return slots.map((s) => `${when(s.start, lang)} (${staffName(b, s.staff, lang)})`).join("; ");
}

/** Handles one client message. Pure: it returns what to save and send, it does not save anything itself. */
export function respond(ctx: AgentContext, client: ClientMemory, text: string, at: number): Outcome {
  const { business: b, now } = ctx;
  const pred = ctx.model.predict(text);
  const lang: Lang = text.trim().length <= 5 ? (ruleLang(text) === "kk" ? "kk" : client.lang) : pred.lang;
  const top = pred.intents[0];
  const labels = new Set<Label>(pred.intents.map((i) => i.label));
  if (isComplaint(text) && !labels.has("complaint")) labels.add("complaint");
  const d: Dialog = { ...client.dialog };
  const pick = ordinal(text);
  const agreed = d.stage === "offer" && !labels.has("cancel") && (labels.has("confirm") || saysYes(text) || pick !== null);
  if (agreed) labels.add("confirm");
  if (labels.size > 1) labels.delete("other");

  const service = matchService(text, b.services)?.id;
  const day = parseDay(text, now);
  const time = parseTime(text);
  const name = parseName(text);
  const said: Said = { text, lang, labels: [...labels] };
  const out: Outcome = { prediction: pred, lang, labels: [...labels], unsure: !agreed && top.score < SURE, reply: "", actions: [], learn: [], queue: [], client, entities: { service, day, time, name } };
  let mem = { ...client, name: name ?? client.name };
  const parts: string[] = [];
  const say = (s: Say) => parts.push(s[lang]);
  const h = habits(mem);

  if (labels.has("greeting")) say(T.hello(mem.name.split(" ")[0]));

  if (agreed && d.offers?.length) {
    const slot = d.offers[Math.min(pick ?? 0, d.offers.length - 1)];
    const svc = b.services.find((s) => s.id === d.service)!;
    const booking: Booking = { id: ctx.newId("bk"), client: mem.id, clientName: mem.name, service: svc.id, staff: slot.staff, start: slot.start, minutes: svc.minutes, price: svc.price, status: "booked", source: mem.channel, at };
    out.booking = booking;
    mem = rememberBooking(mem, booking);
    say(T.booked(svc.names[lang], when(slot.start, lang), staffName(b, slot.staff, lang), money(b, svc.price)));
    out.actions.push({ type: "book", text: `Booked ${svc.names.en}, ${when(slot.start, "en")}, ${staffName(b, slot.staff)}` });
    if (d.started) out.learn.push({ ...d.started, labels: d.started.labels.includes("booking") ? d.started.labels : [...d.started.labels.filter((l) => l !== "other"), "booking"], why: "The client booked, so this message meant «book»" });
    out.learn.push({ ...said, labels: said.labels.filter((l) => l !== "other"), why: "The client agreed to the offered time" });
    Object.assign(d, { stage: "idle", offers: undefined, service: undefined, started: undefined });
  } else if (labels.has("cancel")) {
    const next = upcoming(ctx.bookings, mem.id, now)[0];
    if (next) {
      out.cancelled = { ...next, status: "cancelled" };
      mem = rememberBooking(mem, next, true);
      say(T.cancelled(serviceName(b, next.service, lang), when(next.start, lang)));
      out.actions.push({ type: "cancel", text: `Cancelled ${serviceName(b, next.service, "en")}, ${when(next.start, "en")}` });
      if (top.score >= 0.5) out.learn.push({ ...said, why: "The client had a booking and cancelled it" });
    } else {
      say(T.noBooking);
      out.actions.push({ type: "answer", text: "No upcoming booking to cancel" });
    }
    d.stage = "idle";
  } else if (labels.has("complaint")) {
    say(T.complaint);
    out.actions.push({ type: "handoff", text: "Handed over to the manager" });
    out.queue.push({ kind: "complaint", text, lang, guess: [...labels], score: top.score, client: mem.id, clientName: mem.name, ...chan(mem) });
    d.stage = "idle";
  } else if (labels.has("booking") || (d.stage === "service" && service)) {
    const svcId = service ?? d.service ?? h.service;
    if (!d.started) d.started = said;
    if (!svcId) {
      const list = b.services.slice(0, 4).map((s) => s.names[lang].toLowerCase()).join(", ");
      say(T.askService(list));
      out.actions.push({ type: "ask", text: "Asked which service" });
      d.stage = "service";
    } else {
      const slots = nextFree(b, ctx.bookings, svcId, day, { now, pref: time, staff: h.staff });
      const svc = b.services.find((s) => s.id === svcId)!;
      if (!service && !d.service && h.service && h.staff && labels.has("booking")) say(T.welcomeBack(svc.names[lang].toLowerCase(), staffName(b, h.staff, lang)));
      if (slots.length) {
        say(T.offer(svc.names[lang], offerText(b, slots, lang)));
        out.actions.push({ type: "offer", text: `Offered ${slots.length} free time${slots.length > 1 ? "s" : ""} for ${svc.names.en}` });
        Object.assign(d, { stage: "offer", offers: slots, service: svcId });
      } else {
        say(T.noSlots);
        out.actions.push({ type: "handoff", text: "No free time, passed to the manager" });
        d.stage = "idle";
      }
    }
  } else if (labels.has("price") || labels.has("address") || labels.has("hours")) {
    // A specific text from the owner (parking, gift cards) beats the general answer.
    const special = ctx.knowledge.answer(text);
    if (special && !special.entry.id.startsWith("biz-") && special.score >= 3 && !(labels.has("price") && service)) {
      parts.push(inLang(special.chunk, lang));
      out.hit = special;
      out.actions.push({ type: "knowledge", text: `Answered from «${special.entry.title}»` });
    } else {
      if (labels.has("price")) {
        const svc = b.services.find((s) => s.id === service);
        if (svc) say(T.price(svc.names[lang], money(b, svc.price), svc.minutes));
        else say(T.priceList(b.services.slice(0, 6).map((s) => `${s.names[lang].toLowerCase()} ${money(b, s.price)}`).join(", ")));
        if (svc) Object.assign(d, { stage: "service", service: svc.id });
      }
      if (labels.has("address")) say(T.address(b.address[lang]));
      if (labels.has("hours")) say(T.hours(b.from, b.to));
      out.actions.push({ type: "answer", text: `Answered: ${[...labels].filter((l) => ["price", "address", "hours"].includes(l)).join(", ")}` });
    }
    d.answered = said;
    if (d.stage !== "service") d.stage = "idle";
  } else if (labels.has("thanks")) {
    say(T.thanks);
    if (d.answered) out.learn.push({ ...d.answered, why: "The client thanked for the answer, so the AI had understood the question" });
    out.actions.push({ type: "answer", text: "Said you're welcome" });
    d.answered = undefined;
  } else if (labels.has("confirm")) {
    say(T.ok);
    out.actions.push({ type: "answer", text: "Acknowledged" });
  } else if (!labels.has("greeting") || labels.size > 1 || text.length > 25) {
    const hit = ctx.knowledge.answer(text);
    out.hit = hit;
    const svc = b.services.find((s) => s.id === service);
    if (hit?.entry.id.startsWith("biz-prices") && svc) {
      say(T.price(svc.names[lang], money(b, svc.price), svc.minutes));
      out.actions.push({ type: "answer", text: `Answered the price of ${svc.names.en} from the CRM data` });
    } else if (hit) {
      parts.push(inLang(hit.chunk, lang));
      out.actions.push({ type: "knowledge", text: `Answered from «${hit.entry.title}»` });
    } else {
      say(T.unknown);
      out.actions.push({ type: "unknown", text: "No answer in the knowledge yet, asked a person" });
      out.queue.push({ kind: "unanswered", text, lang, guess: [...labels], score: top.score, client: mem.id, clientName: mem.name, ...chan(mem) });
    }
  } else {
    say(T.help);
    out.actions.push({ type: "answer", text: "Greeted the client" });
  }

  if (out.unsure && !out.queue.length) out.queue.push({ kind: "unsure", text, lang, guess: [...labels], score: top.score, client: mem.id, clientName: mem.name, ...chan(mem) });
  out.reply = parts.join(" ").replace(/\.\.(?!\.)/g, ".");
  mem = remember(mem, { at, from: "client", text, labels: [...labels] }, lang);
  mem = remember(mem, { at: at + 1, from: "ai", text: out.reply });
  out.client = { ...mem, dialog: JSON.parse(JSON.stringify(d)) as Dialog };
  return out;
}
