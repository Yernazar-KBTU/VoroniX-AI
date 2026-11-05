// Staff commands: a manager types what to do and the AI does it in the CRM.
// «Запиши Алию на завтра в 15:00 на стрижку», «Cancel Arman's booking»,
// «Кто не приходил 30 дней?», «Remember: parking is free in the yard».
import { matchService, norm, parseDay, parseTime, type TimePref } from "./entities.js";
import type { Business } from "./types.js";

export type Command =
  | { kind: "book"; name: string; service?: string; day: string | null; time: TimePref | null }
  | { kind: "cancel"; name: string }
  | { kind: "move"; name: string; day: string | null; time: TimePref | null }
  | { kind: "inactive"; days: number }
  | { kind: "stats"; what: "bookings" | "revenue"; day: string | null; week: boolean }
  | { kind: "remember"; text: string }
  | { kind: "service"; name: string; price: number; minutes: number }
  | { kind: "open"; name: string }
  | { kind: "help" };

const NAME = "([\\p{Lu}][\\p{L}'-]{1,24})";
const SKIP = "(?:(?:клиента|клиентку|клиент|client|the client|клиентті|клиент)\\s+)?";

function nameAfter(text: string, verbs: string): string | null {
  // The verb in any case, then a name that starts with a capital letter («запиши Алию», «Cancel Bekzat's»).
  const m = new RegExp(`(?:^|\\s)(?:${verbs})\\s+${SKIP}`, "iu").exec(text);
  if (!m) return null;
  const n = new RegExp(`^${NAME}`, "u").exec(text.slice(m.index + m[0].length));
  return n ? n[1].replace(/'s$/, "") : null;
}

/** Reads a staff command. Unknown text becomes «help» with examples. */
export function parseCommand(text: string, b: Business, now: Date): Command {
  const t = norm(text);
  const raw = text.trim();
  const rem = /^(?:запомни|remember|есте сақта|есте сакта|note)\s*[:,-]?\s*(.+)$/is.exec(raw);
  if (rem) return { kind: "remember", text: rem[1].trim() };

  const svc = /(?:добавь|добавить|add|қос|кос)\s+(?:новую\s+)?(?:услугу|service|қызмет|кызмет)\s+(.+?)\s+(?:за\s+|for\s+)?(\d[\d\s]{2,})\s*(?:₸|тг|тенге|kzt|\$)?[,\s]*(?:(\d{2,3})\s*(?:мин|min|минут|minutes)?)?\s*$/iu.exec(raw);
  if (svc) return { kind: "service", name: svc[1].trim().replace(/[,:]$/, ""), price: Number(svc[2].replace(/\s/g, "")), minutes: Number(svc[3] ?? 60) };

  if (/(не приход|не был|давно не|haven.?t (been|come)|not (been|come)|келмеген|келмей)/.test(t)) {
    const n = /(\d{1,3})\s*(?:дн|day|күн|кун)/.exec(t);
    const days = n ? +n[1] : /месяц|month|ай/.test(t) ? 30 : /недел|week|апта/.test(t) ? 14 : 30;
    return { kind: "inactive", days };
  }
  if (/(сколько|how many|қанша|канша).*(запис|booking|appointment|жазыл)|(выручк|revenue|доход|кіріс|кирис)/.test(t))
    return { kind: "stats", what: /(выручк|revenue|доход|кіріс|кирис)/.test(t) ? "revenue" : "bookings", day: parseDay(text, now), week: /недел|week|апта/.test(t) };

  const cancel = nameAfter(raw, "отмени(?:те)?(?:\\s+запись)?|отменить(?:\\s+запись)?|cancel|болдырма|болдырмаңыз|удали(?:\\s+запись)?");
  if (cancel) return { kind: "cancel", name: cancel };
  const move = nameAfter(raw, "перенеси(?:те)?(?:\\s+запись)?|перенести|move|reschedule|ауыстыр");
  if (move) return { kind: "move", name: move, day: parseDay(text, now), time: parseTime(text) };
  const book = nameAfter(raw, "запиши(?:те)?|записать|book|жазып қой|жаз");
  if (book) return { kind: "book", name: book, service: matchService(text, b.services)?.id, day: parseDay(text, now), time: parseTime(text) };
  const open = nameAfter(raw, "открой|покажи|найди|open|show|find|аш|көрсет");
  if (open) return { kind: "open", name: open };
  return { kind: "help" };
}

export const COMMAND_EXAMPLES = [
  "Запиши Алию на завтра в 15:00 на мужскую стрижку",
  "Book Dana tomorrow at 6pm for a beard trim",
  "Перенеси Армана на пятницу в 18:00",
  "Cancel Bekzat's booking",
  "Кто не приходил 30 дней?",
  "Сколько записей завтра?",
  "Remember: parking is free in the yard behind the building",
  "Добавь услугу Фейд 8000 45 мин",
  "Открой клиента Арман",
];
