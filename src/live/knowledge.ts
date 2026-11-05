// The business's knowledge: texts the owner gives the AI (rules, FAQ, files)
// and facts made from the CRM data (prices, address, hours). Answers come from
// a search index (BM25, the classic ranking formula of search engines), so a
// new text works the moment it is saved, without retraining anything.
import type { Lang } from "../data.js";
import { money, serviceName } from "./crm.js";
import { fold } from "./entities.js";
import type { Business, KnowledgeEntry } from "./types.js";

const STOP = new Set(
  [
    "и в во на с со к ко у о об от до по за из для через не ни да нет а но или ли же бы что это как так вы мы я ты он она они вас нам вам мне меня есть можно ваш ваша ваше ваши мой моя наш здравствуйте привет пожалуйста скажите подскажите где когда какой какая какие кто",
    "the a an to of in on at for is are be do does can could would i you we it my your our there this that and or not with please hi hello hey tell me what when where which who how",
    "мен сен сиз биз ол бар жок ма ме ба бе па пе гой жане де та бола",
  ]
    .join(" ")
    .split(" "),
);
const PREFIX = /^(пере|при|про|под|по|за|вы|от|до|на|раз|рас)(?=[а-я]{5})/;

/** Words of a text for search: folded, without filler words, plus a 5-letter stem so endings do not matter. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w);
    if (w.length > 5) out.push(`~${w.slice(0, 5)}`);
    // «припарковаться» and «парковка» share the stem once the prefix is dropped.
    const bare = w.replace(PREFIX, "");
    if (bare !== w && bare.length > 5) out.push(`~${bare.slice(0, 5)}`);
  }
  return out;
}

export interface Hit {
  entry: KnowledgeEntry;
  chunk: string;
  score: number;
  /** Which words of the question were found. */
  matched: string[];
}

interface Chunk {
  entry: KnowledgeEntry;
  text: string;
  tf: Map<string, number>;
  len: number;
}

/** Splits a long text into pieces of about two or three sentences. */
export function chunks(text: string, max = 360): string[] {
  const parts = text.split(/\n\s*\n|\n(?=[-•*\d])/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= max) {
      out.push(p);
      continue;
    }
    let cur = "";
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if (cur && (cur + " " + s).length > max) {
        out.push(cur);
        cur = s;
      } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export class Knowledge {
  private items: Chunk[] = [];
  private df = new Map<string, number>();
  private avg = 1;
  entries: KnowledgeEntry[] = [];

  /** Rebuilds the index from the saved entries plus the facts made from the business data. */
  set(entries: KnowledgeEntry[], business: Business): void {
    this.entries = [...entries].sort((a, b) => b.at - a.at);
    this.items = [];
    this.df.clear();
    for (const e of [...this.entries, ...businessFacts(business)])
      for (const text of chunks(`${e.title}. ${e.text}`)) {
        const t = terms(text);
        const tf = new Map<string, number>();
        for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
        this.items.push({ entry: e, text: text.startsWith(`${e.title}. `) ? text.slice(e.title.length + 2) : text, tf, len: t.length });
        for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      }
    this.avg = this.items.reduce((s, c) => s + c.len, 0) / Math.max(this.items.length, 1) || 1;
  }

  get size(): number {
    return this.items.length;
  }

  search(question: string, k = 3): Hit[] {
    const q = [...new Set(terms(question))];
    const N = this.items.length;
    const hits: Hit[] = [];
    for (const c of this.items) {
      let score = 0;
      const matched: string[] = [];
      for (const w of q) {
        const f = c.tf.get(w);
        if (!f) continue;
        const n = this.df.get(w) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * 2.4) / (f + 1.4 * (0.25 + (0.75 * c.len) / this.avg));
        if (!w.startsWith("~")) matched.push(w);
        else if (!matched.some((m) => m.startsWith(w.slice(1)))) matched.push(w.slice(1) + "…");
      }
      if (score > 0) hits.push({ entry: c.entry, chunk: c.text, score: Math.round(score * 100) / 100, matched });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** The best piece of knowledge for a question, only when it clearly matches: a long question needs two of its words found. */
  answer(question: string): Hit | null {
    const best = this.search(question, 1)[0];
    const words = new Set(terms(question).filter((w) => !w.startsWith("~"))).size;
    return best && best.score >= 2.2 && best.matched.length >= (words >= 3 ? 2 : 1) ? best : null;
  }
}

/** Facts the AI knows from the CRM data itself, one entry per language so an answer stays in one language. */
export function businessFacts(b: Business): KnowledgeEntry[] {
  const at = 0;
  const min = { ru: "мин", kk: "мин", en: "min" };
  const list = (lang: Lang) => b.services.map((s) => `${s.names[lang]} ${money(b, s.price)} (${s.minutes} ${min[lang]})`).join(", ");
  const masters = (lang: Lang) => b.staff.map((s) => `${s.name}: ${s.services.map((id) => serviceName(b, id, lang)).join(", ")}`).join("; ");
  return [
    { id: "biz-prices-ru", title: "Цены и услуги", text: `Цены: ${list("ru")}.`, source: "business", at },
    { id: "biz-prices-kk", title: "Бағалар мен қызметтер", text: `Бағалар: ${list("kk")}.`, source: "business", at },
    { id: "biz-prices-en", title: "Prices and services", text: `Prices: ${list("en")}.`, source: "business", at },
    { id: "biz-address-ru", title: "Адрес", text: `Наш адрес: ${b.address.ru}.`, source: "business", at },
    { id: "biz-address-kk", title: "Мекенжай", text: `Біздің мекенжай: ${b.address.kk}.`, source: "business", at },
    { id: "biz-address-en", title: "Address", text: `Our address: ${b.address.en}.`, source: "business", at },
    { id: "biz-hours-ru", title: "Часы работы", text: `Работаем каждый день с ${b.from} до ${b.to}.`, source: "business", at },
    { id: "biz-hours-kk", title: "Жұмыс уақыты", text: `Күн сайын ${b.from}-ден ${b.to}-ге дейін жұмыс істейміз.`, source: "business", at },
    { id: "biz-hours-en", title: "Opening hours", text: `Open every day from ${b.from} to ${b.to}.`, source: "business", at },
    { id: "biz-staff-ru", title: "Мастера", text: `Мастера: ${masters("ru")}.`, source: "business", at },
    { id: "biz-staff-en", title: "Barbers", text: `Barbers: ${masters("en")}.`, source: "business", at },
  ];
}
