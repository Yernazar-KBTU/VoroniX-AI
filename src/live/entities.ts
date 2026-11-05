// Facts inside a message: the day, the time, the client's name, the service.
// Written for Russian, Kazakh and English. Kazakh letters are folded to their
// Russian look-alikes first, so «ертең» and «ертен» are read the same way.
import type { Lang } from "../data.js";
import type { Service } from "./types.js";

const PLAIN: Record<string, string> = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" };
export const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[әғқңөұүһі]/g, (c) => PLAIN[c]);
/** Lower case, folded, punctuation turned into spaces, with a space at both ends for word matching. */
export const norm = (s: string) => ` ${fold(s).replace(/[^\p{L}\p{N}:.\/+ ]+/gu, " ").replace(/\s+/g, " ").trim()} `;

const KAZAKH = /[әғқңөұүһі]|(^|[^а-я])(сәлем|салем|салеметсиз|рахмет|канша|кашан|бола ма|жазыл|ертен|бугин|келеди|жок|ия|макул|жарайды|уакыт)/i;
/** A quick rule for the language, used when a message is too short for the model (for example «ок»). */
export const ruleLang = (text: string): Lang | null => (KAZAKH.test(text) ? "kk" : /[а-яё]/i.test(text) ? "ru" : /[a-z]{2}/i.test(text) ? "en" : null);

export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const WEEKDAYS: [RegExp, number][] = [
  [/воскресень|sunday|жексенби/, 0],
  [/понедельник|monday|дуйсенби/, 1],
  [/вторник|tuesday|сейсенби/, 2],
  [/сред[уаы]|wednesday|сарсенби/, 3],
  [/четверг|thursday|бейсенби/, 4],
  [/пятниц|friday| жума/, 5],
  [/суббот|saturday|(^|\s)сенби/, 6],
];

/** «завтра», «в пятницу», «12.11», «ертең», «today» -> "YYYY-MM-DD", or null. */
export function parseDay(text: string, now: Date): string | null {
  const t = norm(text);
  if (/послезавтра|day after tomorrow|бурсигуни/.test(t)) return ymd(addDays(now, 2));
  if (/завтра|tomorrow|ертен/.test(t)) return ymd(addDays(now, 1));
  if (/сегодня|today|tonight|бугин/.test(t)) return ymd(now);
  const dm = /(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/.exec(t);
  if (dm) {
    const d = +dm[1];
    const m = +dm[2];
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let y = now.getFullYear();
      if (new Date(y, m - 1, d) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y += 1;
      return `${y}-${pad(m)}-${pad(d)}`;
    }
  }
  if (/выходн|weekend|демалыс кун/.test(t)) return nextWeekday(now, 6);
  for (const [re, dow] of WEEKDAYS) if (re.test(t)) return nextWeekday(now, dow);
  return null;
}

function nextWeekday(now: Date, dow: number): string {
  return ymd(addDays(now, (dow - now.getDay() + 7) % 7));
}

export interface TimePref {
  exact?: string;
  from?: number;
  to?: number;
}

/** The time the client wants: an exact time («в 15:00», «сағат 3-те») or a window («вечером», «after 6»). */
export function parseTime(text: string): TimePref | null {
  const t = norm(text);
  const exact = /(?:^|\s)(\d{1,2})[:.](\d{2})(?=\s)/.exec(t);
  if (exact && +exact[1] <= 23 && +exact[2] < 60 && !/\d[./]\d{1,2}[./]/.test(t)) return { exact: `${pad(+exact[1])}:${exact[2]}` };
  const pm = /(?:^|\s)(\d{1,2})\s?(am|pm)(?=\s)/.exec(t);
  if (pm) {
    let h = +pm[1] % 12;
    if (pm[2] === "pm") h += 12;
    if (h >= 9 && h <= 21) return { exact: `${pad(h)}:00` };
  }
  const after = /после\s+(\d{1,2})|after\s+(\d{1,2})|(\d{1,2})\s?-?(?:дан|ден|тан|тен) кейин/.exec(t);
  if (after) {
    let h = +(after[1] ?? after[2] ?? after[3]);
    if (h < 9) h += 12;
    return { from: h * 60 };
  }
  const at = /(?:^|\s)(?:в|к|на|at|сагат)\s+(\d{1,2})(?:\s?(?:часов|часа|час|ч)(?=\s))?(?=\s|-)/.exec(t) ?? /(?:^|\s)(\d{1,2})\s?-?(?:де|да|те|та|ге|га|ке|ка)(?=\s)/.exec(t);
  if (at && !/(?:^|\s)(?:в|на)\s+\d{1,2}\s+(?:числ|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентяб|октяб|ноябр|декабр)/.test(t)) {
    let h = +at[1];
    if (h >= 1 && h <= 8) h += 12;
    if (h >= 9 && h <= 21) return { exact: `${pad(h)}:00` };
  }
  if (/после работы|вечер|evening|after work|tonight|кешке|кешки|жумыстан кейин/.test(t)) return { from: 17 * 60 };
  if (/после обеда|днем|afternoon|тустен кейин/.test(t)) return { from: 13 * 60, to: 17 * 60 };
  if (/утр|morning|танерте|тангы/.test(t)) return { to: 12 * 60 };
  return null;
}

const NOT_NAMES = new Set(["да", "нет", "ок", "окей", "хорошо", "спасибо", "давайте", "yes", "no", "ok", "okay", "thanks", "здравствуйте", "привет", "hello", "hi", "иә", "ия", "жоқ", "рахмет", "жарайды", "болады", "сәлем", "мақұл"]);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** «меня зовут Алия», «my name is Aliya», «менің атым Әлия» -> the name, or null. */
export function parseName(text: string): string | null {
  const explicit = /(?:меня зовут|зовут меня|my name is|i am|i'm|менің атым|атым|есімім)\s+([\p{L}-]{2,20})/iu.exec(text);
  if (explicit && !NOT_NAMES.has(explicit[1].toLowerCase())) return cap(explicit[1]);
  return null;
}

export const isComplaint = (t: string) =>
  /(жалоб|ужас|отвратит|верните деньги|возврат|недовол|испортил|криво|косяк|аллерги|ожог|refund|complain|terrible|awful|ruined|шағым|наразы|сұмдық|ақшамды қайтар|бүлдір|күйіп)/i.test(t);
export const saysYes = (t: string) =>
  /^(да|ага|давайте|давай|подходит|хорошо|ок|окей|отлично|супер|go|yes|yep|ok|okay|sure|sounds good|perfect|works|иә|ия|иа|жарайды|болады|мақұл|келістік|жақсы|керемет)(?=$|[\s,.!)])/i.test(t.trim());
/** «первый», «second», «екіншісі», «2» -> which offered time the client picked (0-based), or null. */
export function ordinal(t: string): number | null {
  const s = fold(t).trim();
  if (/перв|first|1-?й|биринши|^1\b/.test(s)) return 0;
  if (/втор|second|2-?й|екинши|^2\b/.test(s)) return 1;
  if (/трет|third|3-?й|ушинши|^3\b/.test(s)) return 2;
  return null;
}

/** The service a message talks about: the one with the most of its word stems in the text. Ties go to the earlier, simpler service. */
export function matchService(text: string, services: Service[]): Service | null {
  const t = norm(text);
  let best: { s: Service; score: number } | null = null;
  for (const s of services) {
    let score = s.stems.filter((st) => t.includes(fold(st))).length;
    if (Object.values(s.names).some((n) => n && t.includes(` ${fold(n)} `))) score += 2;
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

const LATIN: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", ә: "a", ғ: "gh", қ: "q", ң: "ng", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i" };
/** «Тимур Б.» -> «Timur B.», for answers in English. */
export const latin = (s: string) => s.replace(/[\u0400-\u04ff]/g, (c) => {
  const l = LATIN[c.toLowerCase()] ?? c;
  return c === c.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1);
});
/** A person's name as written in a staff command («Алию», «Армана») matched to a known name («Алия», «Арман»). */
export function sameName(written: string, known: string): boolean {
  // Compared in Latin letters, so «Алию» finds «Aliya» and «Армана» finds «Arman T.».
  const a = latin(written).toLowerCase().replace(/[^a-z]/g, "");
  const b = latin(known.split(/\s+/)[0]).toLowerCase().replace(/[^a-z]/g, "");
  if (a.length < 2 || b.length < 2) return false;
  if (a === b) return true;
  let common = 0;
  while (common < Math.min(a.length, b.length) && a[common] === b[common]) common++;
  return common >= 3 && common >= Math.min(a.length, b.length) - 1;
}
