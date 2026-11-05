// A demo stream of client conversations, as they would come from Instagram,
// Telegram and WhatsApp. Each message carries its right answer, so the site
// can measure how often the AI understood it before learning (and the
// simulated operator can answer the questions the AI puts in its queue).
// The words «фейд», «squeeze me in», «кезек», «what do you charge» are not in
// the start phrases: the AI meets them here for the first time.
import type { Label, Lang } from "../data.js";
import type { Channel, Service } from "./types.js";

export interface StreamTurn {
  text: string;
  labels: Label[];
  /** What the operator answers if the AI puts this question in its queue. */
  answer?: string;
}

export interface StreamDialog {
  client: string;
  channel: Channel;
  lang: Lang;
  turns: StreamTurn[];
}

/** The business adds this service before the stream starts: the AI learns it from the business data. */
export const FADE: Service = { id: "FD-09", names: { ru: "Фейд", kk: "Фейд", en: "Fade" }, minutes: 45, price: 8000, stems: ["фейд", "фэйд", "fade", "taper"] };

const t = (text: string, labels: Label[], answer?: string): StreamTurn => ({ text, labels, answer });

export const STREAM: StreamDialog[] = [
  { client: "Arman T.", channel: "instagram", lang: "ru", turns: [t("Салам! Есть окно на фейд завтра после 18?", ["greeting", "booking"]), t("Да, первый подходит", ["confirm"]), t("Спасибо, бро", ["thanks"])] },
  { client: "Aigerim S.", channel: "whatsapp", lang: "kk", turns: [t("Сәлеметсіз бе! Ұлыма шаш қию қанша тұрады?", ["greeting", "price"]), t("Рақмет!", ["thanks"])] },
  { client: "Jake M.", channel: "telegram", lang: "en", turns: [t("Hey, can you squeeze me in for a fade today?", ["greeting", "booking"]), t("Yes, the first one works", ["confirm"])] },
  { client: "Dias N.", channel: "instagram", lang: "ru", turns: [t("Почём контур бороды?", ["price"]), t("Ок, запишите на бороду в субботу утром", ["booking"]), t("Да", ["confirm"])] },
  { client: "Nurlan A.", channel: "whatsapp", lang: "kk", turns: [t("Ертеңге кезекке жазыңызшы, фейд керек", ["booking"]), t("Иә, болады", ["confirm"]), t("Рақмет сізге", ["thanks"])] },
  { client: "Sam K.", channel: "telegram", lang: "en", turns: [t("What do you charge for a beard trim?", ["price"]), t("Cool, thanks", ["thanks"])] },
  { client: "Asel B.", channel: "instagram", lang: "ru", turns: [t("У вас есть подарочные сертификаты?", ["other"], "Да, подарочные сертификаты от 10 000 ₸ на любую услугу. Купить можно в салоне или через Kaspi, действуют 6 месяцев.")] },
  { client: "Maksat E.", channel: "whatsapp", lang: "ru", turns: [t("Можно ли у вас оплатить через Kaspi QR?", ["other"]), t("Супер, спасибо", ["thanks"])] },
  { client: "Zhanna O.", channel: "instagram", lang: "kk", turns: [t("Бүгін кешке уақыт бар ма? Сақал түзету керек", ["booking"]), t("Иә, екіншісі", ["confirm"])] },
  { client: "Mike R.", channel: "telegram", lang: "en", turns: [t("Any chance to squeeze me in tomorrow morning for a haircut?", ["booking"]), t("Perfect, first one", ["confirm"]), t("Thanks a lot!", ["thanks"])] },
  { client: "Ruslan D.", channel: "whatsapp", lang: "ru", turns: [t("Подстригли криво, это косяк, я недоволен", ["complaint"])] },
  { client: "Timur Zh.", channel: "telegram", lang: "ru", turns: [t("Хочу на фейд к Тимуру в пятницу", ["booking"]), t("Давайте", ["confirm"])] },
  { client: "Chris P.", channel: "whatsapp", lang: "en", turns: [t("What do you charge for a fade?", ["price"]), t("Book me in for tomorrow evening then", ["booking"]), t("Yes", ["confirm"])] },
  { client: "Emma L.", channel: "telegram", lang: "en", turns: [t("Do you sell gift cards?", ["other"], "Yes, gift cards from 10,000 ₸ for any service. Buy them at the shop or with Kaspi; they are valid for 6 months.")] },
  { client: "Bekzat K.", channel: "instagram", lang: "kk", turns: [t("Кезек бар ма ертеңге? Сақалды реттеу керек", ["booking"]), t("Жарайды, біріншісі", ["confirm"])] },
  { client: "Aliya M.", channel: "instagram", lang: "kk", turns: [t("Сыйлық сертификатын сатып алуға бола ма?", ["other"], "Иә, сыйлық сертификаты 10 000 ₸-ден басталады, салонда немесе Kaspi арқылы сатып алуға болады.")] },
  { client: "Marat S.", channel: "whatsapp", lang: "ru", turns: [t("Есть где припарковаться возле вас?", ["address"])] },
  { client: "Kevin W.", channel: "telegram", lang: "en", turns: [t("Hey! Can I pay with Apple Pay?", ["greeting", "other"])] },
  { client: "Arman T.", channel: "instagram", lang: "ru", turns: [t("Слушай, не успеваю завтра, отмени пж", ["cancel"])] },
  { client: "Saule T.", channel: "whatsapp", lang: "kk", turns: [t("Фейд қанша тұрады?", ["price"]), t("Рақмет", ["thanks"])] },
  { client: "Jake M.", channel: "telegram", lang: "en", turns: [t("Can you squeeze me in on Saturday afternoon?", ["booking"]), t("Yes please", ["confirm"])] },
  { client: "Olzhas B.", channel: "instagram", lang: "ru", turns: [t("Почём фейд у вас?", ["price"]), t("Запишите тогда на завтра вечером", ["booking"]), t("Да, подходит", ["confirm"]), t("Спасибо!", ["thanks"])] },
  { client: "Ainur K.", channel: "whatsapp", lang: "kk", turns: [t("Шашымды қисық қиып тастадыңыздар, наразымын", ["complaint"])] },
  { client: "Tom H.", channel: "telegram", lang: "en", turns: [t("Until what time are you open on Sunday?", ["hours"]), t("Thanks!", ["thanks"])] },
  { client: "Dana A.", channel: "instagram", lang: "ru", turns: [t("Можно на фейд сегодня вечером?", ["booking"]), t("Да", ["confirm"])] },
  { client: "Erlan S.", channel: "whatsapp", lang: "kk", turns: [t("Ертеңге кезекке тұрғызыңызшы, фейд жасатайын деп едім", ["booking"]), t("Иә", ["confirm"])] },
  { client: "Lucas F.", channel: "telegram", lang: "en", turns: [t("What do you charge for kids?", ["price"]), t("Can you squeeze my son in on Saturday morning?", ["booking"]), t("Sure, the first one", ["confirm"])] },
  { client: "Gulnara T.", channel: "whatsapp", lang: "ru", turns: [t("Здравствуйте, почём стрижка машинкой?", ["greeting", "price"]), t("Спасибо большое", ["thanks"])] },
];

/** Knowledge a business would type in on day one; the demo loads it together with the demo business. */
export const STARTER_KNOWLEDGE = [
  { title: "Оплата / Payment", text: "Принимаем наличные, карты и Kaspi QR, а также Apple Pay и Google Pay. We accept cash, cards, Kaspi QR, Apple Pay and Google Pay. Қолма-қол ақша, карта, Kaspi QR, Apple Pay қабылдаймыз." },
  { title: "Парковка / Parking", text: "Бесплатная парковка во дворе за зданием, въезд со стороны улицы Панфилова. Free parking in the yard behind the building. Ғимараттың артындағы аулада тегін тұрақ бар." },
  { title: "Опоздания / Being late", text: "Если опаздываете больше чем на 15 минут, напишите нам: мастер подвинет запись, если сможет. If you are more than 15 minutes late, message us and we will try to move your booking." },
];
