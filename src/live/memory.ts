// Memory about each client, updated on every message and booking. The AI uses
// it to talk like someone who remembers you: your language, your usual
// service and master, the time you like.
import type { Label, Lang } from "../data.js";
import { parseLocal, serviceName, staffName } from "./crm.js";
import type { Booking, Business, Channel, ClientMemory, Turn } from "./types.js";

export function newClient(id: string, name: string, channel: Channel | "crm", handle: string, lang: Lang, at: number): ClientMemory {
  return {
    id,
    name,
    channel,
    handle,
    lang,
    first: at,
    last: at,
    messages: 0,
    intents: {},
    services: {},
    staff: {},
    times: { morning: 0, day: 0, evening: 0 },
    bookings: 0,
    cancels: 0,
    complaints: 0,
    thanks: 0,
    mood: 0,
    history: [],
    dialog: { stage: "idle" },
  };
}

const MOOD: Partial<Record<Label, number>> = { thanks: 1, confirm: 0.4, greeting: 0.2, complaint: -1, cancel: -0.2 };

/** Adds one message (from the client or the AI) to the client's memory. */
export function remember(m: ClientMemory, turn: Turn, lang?: Lang): ClientMemory {
  const next: ClientMemory = { ...m, last: turn.at, history: [...m.history, turn].slice(-14) };
  if (turn.from === "client") {
    next.messages = m.messages + 1;
    if (lang) next.lang = lang;
    const intents = { ...m.intents };
    let mood = 0;
    for (const l of turn.labels ?? []) {
      intents[l] = (intents[l] ?? 0) + 1;
      mood += MOOD[l] ?? 0;
    }
    next.intents = intents;
    next.mood = Math.round((m.mood * 0.7 + Math.max(-1, Math.min(1, mood)) * 0.3) * 100) / 100;
    if (turn.labels?.includes("thanks")) next.thanks = m.thanks + 1;
    if (turn.labels?.includes("complaint")) next.complaints = m.complaints + 1;
  }
  return next;
}

export function rememberBooking(m: ClientMemory, b: Booking, cancelled = false): ClientMemory {
  if (cancelled) return { ...m, cancels: m.cancels + 1 };
  const h = parseLocal(b.start).getHours();
  const part = h < 12 ? "morning" : h < 17 ? "day" : "evening";
  return {
    ...m,
    bookings: m.bookings + 1,
    services: { ...m.services, [b.service]: (m.services[b.service] ?? 0) + 1 },
    staff: { ...m.staff, [b.staff]: (m.staff[b.staff] ?? 0) + 1 },
    times: { ...m.times, [part]: m.times[part] + 1 },
  };
}

const top = (counts: Record<string, number>) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

/** The client's usual service, master and time of day, when there is one. */
export function habits(m: ClientMemory): { service?: string; staff?: string; time?: "morning" | "day" | "evening" } {
  const time = top(m.times as unknown as Record<string, number>);
  return { service: top(m.services), staff: top(m.staff), time: time && m.times[time as "day"] > 0 ? (time as "day") : undefined };
}

/** Short facts for the client card, in English. */
export function facts(m: ClientMemory, b: Business): string[] {
  const h = habits(m);
  const out: string[] = [`Writes in ${{ ru: "Russian", kk: "Kazakh", en: "English" }[m.lang]}`];
  if (h.service) out.push(`Usual service: ${serviceName(b, h.service, "en")} (×${m.services[h.service]})`);
  if (h.staff) out.push(`Usual barber: ${staffName(b, h.staff)}`);
  if (h.time) out.push(`Likes the ${h.time === "day" ? "afternoon" : h.time}`);
  if (m.cancels) out.push(`Cancelled ${m.cancels} time${m.cancels > 1 ? "s" : ""}`);
  if (m.complaints) out.push(`Complained ${m.complaints} time${m.complaints > 1 ? "s" : ""}`);
  out.push(m.mood > 0.25 ? "Mood: happy" : m.mood < -0.25 ? "Mood: unhappy" : "Mood: neutral");
  return out;
}
