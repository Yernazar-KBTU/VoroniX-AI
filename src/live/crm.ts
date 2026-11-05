// The CRM part the AI works with: the business (services, staff, hours) and
// the bookings. Free times are computed from the staff schedules and the
// bookings that already exist, so the AI never offers a busy time.
import type { Lang } from "../data.js";
import { addDays, latin, pad, ymd, type TimePref } from "./entities.js";
export { latin };
import type { Booking, Business, Service } from "./types.js";

/** The demo business, the same barbershop as in the VoroniX CRM demo. */
export const DEMO_BUSINESS: Business = {
  name: "Barberista",
  city: "Almaty",
  address: { ru: "Алматы, ул. Панфилова 98 (демо-адрес)", kk: "Алматы, Панфилов к-сі 98 (демо мекенжай)", en: "98 Panfilov St, Almaty (demo address)" },
  from: "10:00",
  to: "21:00",
  phone: "+7 700 000 0000",
  currency: "₸",
  services: [
    { id: "HC-01", names: { ru: "Мужская стрижка", kk: "Ерлер шаш қию", en: "Men's haircut" }, minutes: 60, price: 7000, stems: ["стриж", "подстри", "постри", "haircut", "hair cut", "шаш ки", "шашымды ки", "мужск", "барбер", " men"] },
    { id: "HC-02", names: { ru: "Стрижка машинкой", kk: "Машинкамен қию", en: "Clipper cut" }, minutes: 30, price: 4000, stems: ["машинк", "под ноль", "clipper", "buzz", "стриж", "шаш ки"] },
    { id: "KD-03", names: { ru: "Детская стрижка", kk: "Балалар шаш қию", en: "Kids haircut" }, minutes: 45, price: 5000, stems: ["детск", "ребен", " сын", "дочк", " kid", "child", " son ", "бала", "улым", "стриж", "haircut", "шаш ки"] },
    { id: "BD-04", names: { ru: "Оформление бороды", kk: "Сақал түзету", en: "Beard trim" }, minutes: 45, price: 5000, stems: ["бород", "beard", "сакал", " усы", "бороду"] },
    { id: "CB-05", names: { ru: "Стрижка и борода", kk: "Шаш пен сақал", en: "Haircut and beard" }, minutes: 90, price: 11000, stems: ["стриж", "бород", "haircut", "beard", "шаш", "сакал"] },
    { id: "SH-06", names: { ru: "Королевское бритьё", kk: "Корольдік қырыну", en: "Royal shave" }, minutes: 45, price: 6000, stems: ["брить", "бритье", "побри", "shave", "кырын", "устар"] },
    { id: "VP-07", names: { ru: "VIP-ритуал", kk: "VIP-рәсім", en: "VIP ritual" }, minutes: 150, price: 22000, stems: ["вип", " vip", "ритуал", "расим"] },
    { id: "CM-08", names: { ru: "Камуфляж седины", kk: "Ақ шашты бояу", en: "Grey camouflage" }, minutes: 30, price: 5000, stems: ["камуфл", "седин", "grey", "gray", "ак шаш", "агарган", "бояу", "окраш", "покрас"] },
  ],
  staff: [
    { id: "MS-01", name: "Тимур Б.", role: "Senior barber", from: "10:00", to: "21:00", days: [1, 2, 3, 4, 5, 6], services: ["HC-01", "BD-04", "CB-05", "VP-07", "CM-08"] },
    { id: "MS-02", name: "Арман К.", role: "Barber", from: "10:00", to: "21:00", days: [1, 2, 3, 4, 5, 6], services: ["HC-01", "HC-02", "KD-03", "CB-05"] },
    { id: "MS-03", name: "Данияр С.", role: "Barber", from: "12:00", to: "21:00", days: [0, 2, 3, 4, 5, 6], services: ["HC-01", "HC-02", "BD-04", "KD-03"] },
    { id: "MS-04", name: "Ержан М.", role: "Shave master", from: "10:00", to: "19:00", days: [1, 2, 3, 4, 5], services: ["SH-06", "BD-04", "VP-07"] },
  ],
};

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const parseLocal = (s: string) => {
  const [d, t] = s.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi);
};

export interface Slot {
  staff: string;
  start: string;
}

/**
 * Free times for a service on one day: every 30 minutes inside the working
 * hours of each master who does the service, minus their bookings. A wanted
 * master comes first; the list is ordered by time.
 */
export function freeSlots(b: Business, bookings: Booking[], serviceId: string, day: string, opts: { now: Date; pref?: TimePref | null; staff?: string; limit?: number }): Slot[] {
  const service = b.services.find((s) => s.id === serviceId);
  if (!service) return [];
  const date = parseLocal(`${day}T00:00`);
  const dow = date.getDay();
  const isToday = day === ymd(opts.now);
  const earliest = isToday ? opts.now.getHours() * 60 + opts.now.getMinutes() + 30 : 0;
  const out: Slot[] = [];
  const masters = b.staff.filter((s) => s.services.includes(serviceId) && s.days.includes(dow)).sort((x, y) => (x.id === opts.staff ? -1 : y.id === opts.staff ? 1 : 0));
  for (const m of masters) {
    const busy = bookings
      .filter((k) => k.staff === m.id && k.status === "booked" && k.start.startsWith(day))
      .map((k) => [toMin(k.start.slice(11)), toMin(k.start.slice(11)) + k.minutes] as const);
    for (let t = Math.max(toMin(m.from), Math.ceil(earliest / 30) * 30); t + service.minutes <= toMin(m.to); t += 30) {
      if (busy.some(([s, e]) => t < e && t + service.minutes > s)) continue;
      const p = opts.pref;
      if (p?.exact && hhmm(t) !== p.exact) continue;
      if (p?.from !== undefined && t < p.from) continue;
      if (p?.to !== undefined && t >= p.to) continue;
      out.push({ staff: m.id, start: `${day}T${hhmm(t)}` });
    }
  }
  // The wanted master's times first, then by time; one master per time.
  const seen = new Set<string>();
  return out
    .sort((x, y) => (x.staff === opts.staff ? 0 : 1) - (y.staff === opts.staff ? 0 : 1) || x.start.localeCompare(y.start))
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)))
    .slice(0, opts.limit ?? 3)
    .sort((x, y) => x.start.localeCompare(y.start));
}

/** The first day from `day` on (up to a week ahead) that has free times. */
export function nextFree(b: Business, bookings: Booking[], serviceId: string, day: string | null, opts: { now: Date; pref?: TimePref | null; staff?: string }): Slot[] {
  const start = day ? parseLocal(`${day}T00:00`) : opts.now;
  for (let i = 0; i < 7; i++) {
    const d = ymd(addDays(start, i));
    let s = freeSlots(b, bookings, serviceId, d, opts);
    // An exact time that is taken: offer the nearest free times that day instead.
    if (!s.length && opts.pref?.exact && i === 0) s = freeSlots(b, bookings, serviceId, d, { ...opts, pref: null });
    if (s.length) return s;
  }
  return [];
}

const DAYS: Record<Lang, string[]> = {
  ru: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
  kk: ["жс", "дс", "сс", "ср", "бс", "жм", "сб"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/** «пт 06.11, 15:00» / «Fri 06.11, 15:00» */
export function when(start: string, lang: Lang): string {
  const d = parseLocal(start);
  return `${DAYS[lang][d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${start.slice(11, 16)}`;
}

export const serviceName = (b: Business, id: string, lang: Lang) => b.services.find((s) => s.id === id)?.names[lang] ?? id;
export const staffName = (b: Business, id: string, lang?: Lang) => {
  const name = b.staff.find((s) => s.id === id)?.name ?? id;
  return lang === "en" ? latin(name) : name;
};
export const money = (b: Business, n: number) => `${n.toLocaleString("ru-RU").replace(/ /g, " ")} ${b.currency}`;

/** Upcoming bookings of a client, nearest first. */
export function upcoming(bookings: Booking[], clientId: string, now: Date): Booking[] {
  const nowKey = `${ymd(now)}T${hhmm(now.getHours() * 60 + now.getMinutes())}`;
  return bookings.filter((k) => k.client === clientId && k.status === "booked" && k.start >= nowKey).sort((a, b) => a.start.localeCompare(b.start));
}

export function makeService(name: string, price: number, minutes: number, lang: Lang): Service {
  const id = `SV-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const stem = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, Math.max(4, Math.min(w.length - 1, 6))));
  return { id, names: { ru: name, kk: name, en: name, [lang]: name }, minutes, price, stems: stem.length ? stem : [name.toLowerCase()] };
}
