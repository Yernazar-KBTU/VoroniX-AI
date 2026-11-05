// npm run generate -> data/generated.tsv: thousands of training phrases made from
// templates, written the way clients really type in chats: short, lowercase,
// without punctuation, with typos, slang, Latin letters for Russian, Kazakh
// typed without Kazakh letters, two requests in one message.
// The same seed always gives the same file. data/test.tsv is read only to leave
// out any phrase that is also a test phrase, so the test stays unseen.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rng } from "../src/model.js";
import { features } from "../src/features.js";

type L = "ru" | "kk" | "en";
const r = rng(2026);
const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
const maybe = (p: number) => r() < p;

// ---------- slots ----------
const S = {
  ru: {
    svcAcc: ["стрижку", "мужскую стрижку", "бороду", "оформление бороды", "бритьё", "королевское бритьё", "детскую стрижку", "стрижку машинкой", "стрижку и бороду", "фейд", "камуфляж седины", "вип ритуал", "VIP-ритуал", "стрижку под ноль", "окантовку"],
    svcNom: ["стрижка", "мужская стрижка", "борода", "оформление бороды", "бритьё", "королевское бритьё", "детская стрижка", "стрижка машинкой", "стрижка и борода", "фейд", "камуфляж седины", "вип ритуал", "VIP-ритуал", "окантовка", "стрижка под ноль"],
    svcInf: ["подстричься", "постричься", "подстричь бороду", "побриться", "оформить бороду", "сына подстричь", "сделать фейд", "покрасить седину", "подровнять бороду", "обновить стрижку"],
    day: ["завтра", "сегодня", "послезавтра", "в субботу", "в пятницу", "на выходных", "в понедельник", "в среду", "во вторник", "в четверг", "в воскресенье", "на этой неделе", "на следующей неделе", "на завтра", "на сегодня", "на субботу", "на пятницу"],
    time: ["вечером", "утром", "после обеда", "в 6", "к 18:00", "после работы", "на 15:30", "в обед", "часов в 5", "в 19:00", "пораньше", "попозже", "к 10 утра", "после 7", "до обеда"],
    master: ["к Тимуру", "к Арману", "к Данияру", "к Ержану", "к любому мастеру", "к тому же мастеру", "к Тимуру Б", "к старшему барберу"],
    hi: ["привет", "здравствуйте", "здрасте", "добрый день", "добрый вечер", "доброе утро", "салам", "здарова", "приветствую", "хай", "салют", "здравствуйте!", "привет!"],
    thx: ["спасибо", "спс", "благодарю", "спасибо большое", "пасиб", "спасибки", "от души", "спасибо, до встречи", "сенкс", "большое спасибо"],
    please: ["пожалуйста", "плиз", "пж", "пожалуйста 🙏", "если можно"],
  },
  kk: {
    svcDat: ["шаш қиюға", "шаш алдыруға", "сақал түзетуге", "қырынуға", "балалар шаш қиюына", "машинкамен қиюға", "шаш пен сақалға", "VIP рәсімге", "ақ шашты бояуға", "фейдке"],
    svcNom: ["шаш қию", "ерлер шаш қию", "сақал түзету", "қырыну", "балалар шаш қию", "машинкамен қию", "шаш пен сақал", "VIP рәсім", "ақ шашты бояу", "фейд"],
    svcWant: ["шаш алдырғым келеді", "шаш қидырғым келеді", "сақалымды түзеткім келеді", "қырынғым келеді", "баламды қидырғым келеді", "шашымды қысқартқым келеді"],
    day: ["ертең", "бүгін", "бүрсігүні", "сенбіге", "жұмаға", "демалыста", "дүйсенбіге", "сәрсенбіге", "бейсенбіге", "ертеңге", "бүгінге", "осы аптада", "келесі аптада", "жексенбіге"],
    time: ["кешке", "таңертең", "түстен кейін", "сағат 6-да", "18:00-ге", "жұмыстан кейін", "15:30-ға", "түсте", "ертерек", "кешірек", "сағат 7-ден кейін", "түске дейін"],
    master: ["Тимурға", "Арманға", "Данияраға", "Ержанға", "кез келген шеберге", "сол шеберге"],
    hi: ["сәлем", "сәлеметсіз бе", "салем", "салеметсиз бе", "қайырлы күн", "қайырлы кеш", "армысыз", "сәлем!", "ассалаумағалейкум", "қайырлы таң"],
    thx: ["рахмет", "рақмет", "көп рахмет", "үлкен рақмет", "рахмет, кездескенше", "рахмет сізге", "рахмееет"],
    please: ["өтінемін", "өтініш", "мүмкін болса"],
  },
  en: {
    svc: ["a haircut", "a cut", "a beard trim", "a shave", "a royal shave", "a kids haircut", "a clipper cut", "a fade", "haircut and beard", "the vip ritual", "grey camouflage", "a buzz cut", "a trim", "a lineup"],
    svcNom: ["a haircut", "a beard trim", "a shave", "a kids cut", "a clipper cut", "a fade", "the vip ritual", "haircut and beard", "grey camouflage", "a buzz cut", "a trim"],
    day: ["tomorrow", "today", "tmrw", "on saturday", "on friday", "this weekend", "on monday", "on wednesday", "next week", "tonight", "this week", "sunday", "the day after tomorrow"],
    time: ["in the evening", "in the morning", "after lunch", "at 6", "at 6pm", "after work", "at 3:30", "around noon", "around 5", "at 19:00", "early", "late", "after 7"],
    master: ["with Timur", "with Arman", "with Daniyar", "with Yerzhan", "with anyone", "with the same barber"],
    hi: ["hi", "hello", "hey", "good morning", "good evening", "hiya", "yo", "hey there", "hi!", "hello!", "morning"],
    thx: ["thanks", "thank you", "thx", "ty", "thanks a lot", "cheers", "much appreciated", "thank you so much", "thanks see you"],
    please: ["please", "pls", "plz"],
  },
};

const fill = (lang: L, t: string): string =>
  t.replace(/\{(\w+)\}/g, (_, k: string) => {
    const opt = k.endsWith("_");
    const key = opt ? k.slice(0, -1) : k;
    const list = (S[lang] as Record<string, string[]>)[key];
    if (!list) throw new Error(`no slot ${key}`);
    return opt && maybe(0.5) ? "" : pick(list);
  });

// ---------- templates: [labels, templates] ----------
type T = [string, string[]];
const TEMPLATES: Record<L, T[]> = {
  ru: [
    ["booking", ["хочу записаться {day_} {time_}", "хочу записаться на {svcAcc} {day_} {time_}", "запишите меня {day_} {time_}", "запишите на {svcAcc} {day_}", "запиши меня {day} {time_}", "можно записаться {day_} {time_}?", "можно записаться на {svcAcc}?", "есть место {day} {time_}?", "есть свободное время {day_} {time_}?", "есть окошко {day} {time_}?", "можно {day} {time} подойти?", "хочу {svcInf} {day_} {time_}", "мне бы {svcInf} {day_}", "хотел бы {svcInf} {day_} {time_}", "свободно {day} {time_}?", "можно {master} {day_} {time_}?", "запишите {master} {day_}", "забронируйте мне {svcAcc} {day_} {time_}", "хочу прийти {day} {time_}", "можно прийти {day} {time_}?", "можно на {svcAcc} {day} {time_}", "кто свободен {day} {time_}?", "есть кто {day} {time_}?", "нужна запись на {svcAcc}", "хочу записаться {master} на {svcAcc}", "запись на {svcAcc} {day_} есть?", "а можно {day} {time}?", "можно ли записаться {day_}", "надо {svcInf} {day_} {time_}", "впишите меня {day} {time_}", "{day} {time}", "{day}", "{time}", "{day} можно?", "а {day}?", "давайте {day} {time_}", "лучше {day} {time_}", "можно {time}?", "а {time} есть?", "{master} {day_}"]],
    ["visits", ["мои записи", "покажи мои записи", "покажите мою запись", "когда я записан", "когда я записана", "на какое время я записан", "во сколько у меня запись", "я записан {day}?", "я записана {day}?", "у меня есть запись?", "есть у меня запись {day_}?", "напомните время записи", "напомните во сколько я записан", "проверьте мою запись", "на когда моя запись", "какая у меня запись", "к кому я записан", "к какому мастеру я записан", "моя запись в силе?", "запись на {day} актуальна?", "подскажите когда у меня визит", "куда я записан", "посмотрите мою бронь", "моя бронь", "какие у меня записи", "я точно записан?", "во сколько мне приходить", "напомните когда приходить", "забыл во сколько запись"]],
    ["cancel", ["отмените запись {day_}", "отмените мою запись", "не смогу прийти {day_}", "не приду {day_}", "отменяю запись", "хочу отменить запись {day_}", "планы поменялись, отмените", "заболел, не приду", "заболела, отмените запись", "отмена записи", "уберите мою запись", "снимите запись {day_}", "не получится прийти {day_}", "к сожалению не смогу {day_}", "отмените {svcAcc} {day_}", "отменить запись можно?", "я не приду", "отменяйте", "не успеваю, отмените", "форс мажор, отмените запись", "сорян не смогу", "отмена", "не смогу, извините", "давайте отменим", "otmenite zapis"]],
    ["price", ["сколько стоит {svcNom}", "почём {svcNom}", "почем {svcNom}?", "цена на {svcAcc}", "какая цена на {svcAcc}", "сколько за {svcAcc}", "{svcNom} сколько стоит?", "{svcNom} сколько", "стоимость {svcNom}?", "прайс", "прайс скиньте", "скиньте прайс", "цены", "какие цены", "сколько у вас стоит {svcNom}", "а {svcNom} дорого?", "скока стоит {svcNom}", "сколько будет {svcNom}", "во сколько обойдётся {svcNom}", "цены на услуги", "прайс лист", "сколько стоит", "сколько это стоит", "а сколько стоит?", "какая стоимость", "почем услуги", "skolko stoit {svcNom}", "сколько стоит у {master}"]],
    ["complaint", ["ужасно подстригли", "подстригли криво", "мне не понравилось", "очень плохо", "ужасный сервис", "я недоволен", "я недовольна стрижкой", "мастер нахамил", "мастер опоздал", "ждал полчаса", "испортили стрижку", "порезали при бритье", "верните деньги", "хочу вернуть деньги", "больше к вам не приду", "это отвратительно", "кошмар а не стрижка", "жалоба на мастера", "хочу пожаловаться", "мастер был грубым", "грязно у вас", "бороду испортили", "сына криво подстригли", "за такие деньги такое качество", "разочарован", "так себе сервис, недоволен", "обслуживание ужасное", "криво побрили, кожа горит", "вы меня обманули с ценой", "записали и не приняли", "пришёл, а мастера нет"]],
    ["address", ["где вы", "где вы находитесь", "адрес", "адрес скиньте", "какой адрес", "как вас найти", "как до вас доехать", "куда ехать", "вы где", "где находится барбершоп", "скиньте локацию", "геолокацию скиньте", "вы на панфилова?", "в каком районе вы", "какой ориентир", "как пройти к вам", "где ваш салон", "адрес барбершопа", "вы в центре?", "локация"]],
    ["hours", ["до скольки работаете", "во сколько открываетесь", "во сколько закрываетесь", "график работы", "часы работы", "вы работаете {day}?", "вы открыты сейчас?", "открыто сейчас?", "работаете в воскресенье?", "работаете в выходные?", "с какого часа работаете", "режим работы", "до скольки вы {day_}", "сегодня работаете?", "когда открываетесь", "вы сейчас открыты", "работаете допоздна?", "во сколько последняя запись"]],
    ["confirm", ["да", "ок", "окей", "давайте", "подходит", "годится", "норм", "хорошо", "согласен", "согласна", "отлично", "первый вариант", "второй вариант", "давайте первый", "да, подходит", "да {time}", "да, на {time}", "ага", "угу", "можно", "идёт", "супер", "договорились", "беру", "первое", "второе", "пойдёт", "да, давайте", "оке", "ок давай"]],
    ["thanks", ["{thx}", "{thx}!", "{thx} 🙏", "{thx}, всё понятно", "понял, {thx}", "{thx} за ответ", "{thx}, вы лучшие"]],
    ["greeting", ["{hi}", "{hi}!", "{hi} 👋", "{hi}, есть вопрос", "{hi}, вы тут?", "алло", "есть кто?", "{hi} ребята"]],
    ["other", ["у вас есть парковка?", "можно с собакой?", "вы делаете окрашивание?", "есть вакансия барбера?", "кофе есть?", "какой шампунь используете", "можно оплатить картой?", "каспи принимаете?", "у вас есть подарочные сертификаты?", "с какого возраста стрижёте детей", "есть ли вайфай", "вы делаете маникюр?", "женщин стрижёте?", "есть ли скидки студентам", "какую косметику продаёте", "можно подождать у вас", "ты бот?", "кто ты", "как дела", "вы реальный человек?", "можно оставить отзыв", "у вас есть инстаграм", "продаёте воск для волос?", "есть ли туалет", "можно прийти с ребёнком посмотреть", "делаете ли вы татуировки", "у вас кондиционер есть", "сколько мастеров у вас", "где учились мастера", "вы франшиза?"]],
    ["greeting,booking", ["{hi}, хочу записаться {day_} {time_}", "{hi}! можно записаться на {svcAcc} {day_}?", "{hi}, запишите меня {day} {time_}", "{hi}, есть место {day} {time_}?", "{hi}, хочу {svcInf} {day_}"]],
    ["greeting,price", ["{hi}, сколько стоит {svcNom}?", "{hi}! почём {svcNom}", "{hi}, скиньте прайс", "{hi}, какие цены?"]],
    ["greeting,visits", ["{hi}, когда я записан?", "{hi}, напомните время записи", "{hi}, проверьте мою запись"]],
    ["greeting,cancel", ["{hi}, отмените запись {day_}", "{hi}, не смогу прийти {day_}", "{hi}, к сожалению не приду"]],
    ["greeting,complaint", ["{hi}, мне не понравилась стрижка", "{hi}, хочу пожаловаться на мастера"]],
    ["greeting,address", ["{hi}, где вы находитесь?", "{hi}, скиньте адрес"]],
    ["greeting,hours", ["{hi}, до скольки работаете?", "{hi}, вы {day} работаете?"]],
    ["price,booking", ["сколько стоит {svcNom} и можно {day} {time_}?", "можно {day} {time_} на {svcAcc}? и сколько это", "почём {svcNom}? хочу записаться {day_}", "хочу записаться на {svcAcc}, сколько стоит?", "запишите на {svcAcc} {day_}, и какая цена?"]],
    ["hours,address", ["где вы и до скольки работаете", "скиньте адрес и часы работы", "где находитесь и во сколько открываетесь"]],
    ["confirm,thanks", ["да, {thx}", "отлично, {thx}", "подходит, {thx}", "ок, {thx}"]],
    ["cancel,thanks", ["отмените запись, {thx}", "не смогу прийти, {thx} за понимание"]],
  ],
  kk: [
    ["booking", ["жазылғым келеді {day_} {time_}", "{svcDat} жазылғым келеді {day_}", "{day} {time_} жазыңызшы", "мені {day} {time_} жазып қойыңыз", "{day} жазылуға бола ма", "{svcDat} жазылуға бола ма", "{day} {time_} бос орын бар ма", "{day} бос уақыт бар ма", "{svcWant} {day_}", "{day} {time} келсем бола ма", "{master} {day_} жазылайын", "{master} жазылуға бола ма", "{svcDat} жазылайын {day_}", "жазылайын деп едім {day_}", "{day} {time_} келуге бола ма", "кім бос {day} {time_}", "{day} {time}", "{day}", "{time}", "{day} бола ма", "{time} бола ма", "{day} {time_} болса", "жазылу керек {day_}", "{day} келейін", "zhazylugha bola ma {day_}", "zhazylgym keledi"]],
    ["visits", ["менің жазылуым қашан", "мен қашан жазылдым", "қай уақытқа жазылдым", "менің жазылуларымды көрсетіңіз", "менің жазылуым бар ма", "мен {day} жазылдым ба", "жазылуым қай уақытта", "сағат нешеге жазылдым", "қай шеберге жазылдым", "жазылуым күшінде ме", "жазылуымды тексеріңізші", "қашан келуім керек", "нешеде келуім керек еді", "менің броным", "жазылғанымды еске салыңызшы"]],
    ["cancel", ["жазылуды болдырмаңыз", "жазылуымды өшіріңіз", "жазылуымды болдырмаңызшы", "келе алмаймын {day_}", "{day} келмеймін", "келе алмаймын, кешіріңіз", "жазылудан бас тартамын", "ауырып қалдым, келмеймін", "жоспар өзгерді, өшіріңіз", "жазылуды алып тастаңыз", "{day} келе алмаймын", "болдырмау", "кешіріңіз, келе алмаймын", "жазылуды тоқтатыңыз", "kele almaimyn"]],
    ["price", ["{svcNom} қанша", "{svcNom} қанша тұрады", "{svcNom} бағасы қанша", "{svcNom} бағасы", "бағасы қанша", "баға тізімі", "баға тізімін жіберіңізші", "бағалар қандай", "қанша тұрады", "қанша болады", "{svcNom} қымбат па", "прайс жіберіңіз", "қызмет бағасы қандай", "{svcNom} неше теңге", "канша турады", "багасы канша", "{svcNom} канша"]],
    ["complaint", ["маған ұнамады", "қызмет нашар", "шебер кешікті", "шашымды бүлдіріп тастадыңыздар", "ақшамды қайтарыңыз", "қисық қиып тастадыңыздар", "шебер дөрекі болды", "сақалымды бүлдірдіңіздер", "өте нашар", "наразымын", "енді келмеймін", "жарты сағат күттім", "шағым айтқым келеді", "сапасы нашар", "баламның шашын қисық қидыңыздар", "мүлдем ұнамады", "кесіп алдыңыздар"]],
    ["address", ["қайдасыздар", "мекенжайыңыз қандай", "мекенжай", "сізге қалай жетуге болады", "қай жерде орналасқансыз", "кайда орналасканыз", "локация жіберіңіз", "адрес жіберіңізші", "қай ауданда", "қалай барамыз", "сіздер қайдасыздар", "мекенжайды жазыңызшы"]],
    ["hours", ["қашанға дейін жұмыс істейсіздер", "нешеде ашыласыздар", "нешеде жабыласыздар", "жұмыс уақытыңыз", "жұмыс кестесі", "{day} жұмыс істейсіздер ме", "қазір ашықсыздар ма", "жексенбіде жұмыс істейсіздер ме", "демалыс күндері жұмыс істейсіздер ме", "сағат нешеге дейін", "бүгін ашықсыздар ма"]],
    ["confirm", ["иә", "ия", "жарайды", "болады", "келісемін", "жақсы", "бірінші нұсқа", "екінші нұсқа", "біріншісі", "иә, болады", "иә {time}", "мақұл", "ок", "дұрыс", "келістік", "бірінші", "иа", "жарайды болсын"]],
    ["thanks", ["{thx}", "{thx}!", "{thx} 🙏", "түсіндім, {thx}", "{thx}, бәрі түсінікті"]],
    ["greeting", ["{hi}", "{hi}!", "{hi} 👋", "{hi}, сұрағым бар", "{hi}, бар ма біреу"]],
    ["other", ["тұрақ бар ма", "шаш бояйсыздар ма", "картамен төлеуге бола ма", "жұмысқа барбер керек пе", "кофе бар ма", "сыйлық сертификаты бар ма", "балаларды нешеден бастап қиясыздар", "вайфай бар ма", "әйелдерді қиясыздар ма", "студенттерге жеңілдік бар ма", "сен ботсың ба", "қалайсыз", "иттен келуге бола ма", "каспимен төлеуге бола ма", "инстаграмдарыңыз бар ма"]],
    ["greeting,booking", ["{hi}, {svcDat} жазылғым келеді", "{hi}, {day} жазылуға бола ма", "{hi}! {day} {time_} бос орын бар ма", "{hi}, {svcWant}"]],
    ["greeting,price", ["{hi}, {svcNom} қанша тұрады", "{hi}, бағалар қандай", "{hi}! бағасы қанша"]],
    ["greeting,visits", ["{hi}, мен қашан жазылдым", "{hi}, жазылуымды тексеріңізші"]],
    ["greeting,cancel", ["{hi}, {day} келе алмаймын", "{hi}, жазылуымды өшіріңізші"]],
    ["greeting,address", ["{hi}, қайдасыздар", "{hi}, мекенжайыңыз қандай"]],
    ["greeting,hours", ["{hi}, нешеде ашыласыздар", "{hi}, қашанға дейін жұмыс істейсіздер"]],
    ["price,booking", ["{svcNom} қанша тұрады, {day} жазылуға бола ма", "{day} {svcDat} жазылайын, бағасы қанша"]],
    ["confirm,thanks", ["иә, {thx}", "жарайды, {thx}"]],
  ],
  en: [
    ["booking", ["i want to book {svc} {day_} {time_}", "can i book {svc} {day_}", "book me in {day_} {time_}", "book me {master_} {day} {time_}", "can i come {day} {time_}", "any slots {day} {time_}?", "do you have time {day} {time_}", "is anyone free {day} {time_}", "i need {svc} {day_}", "need {svc} asap", "wanna get {svc} {day_}", "i'd like {svc} {day} {time_}", "can i get {svc} {day} {time_}", "can you fit me in {day} {time_}", "is {master} free {day}", "book {svc} {master} {day_}", "appointment {day} {time_}", "i want an appointment {day_}", "reserve {svc} for me {day_}", "can i come in {time}", "{day} {time}", "{day}", "{time}", "{day}?", "what about {day}", "how about {day} {time_}", "{day} works?", "anything {day} {time_}?", "i wanna book", "can i book"]],
    ["visits", ["my bookings", "my appointment", "when is my appointment", "what time am i booked for", "do i have a booking {day_}", "am i booked {day}?", "check my booking", "remind me my appointment time", "who am i booked with", "is my booking still on", "what time should i come", "show my appointments", "when am i coming in", "did my booking go through", "forgot what time my appointment is"]],
    ["cancel", ["cancel my booking", "cancel my appointment {day_}", "i cant make it {day_}", "i can't come {day_}", "need to cancel {day_}", "sorry wont be able to come", "pls cancel", "cancel it", "something came up, cancel please", "im sick, cant come", "drop my appointment", "i'll have to cancel", "cancel {svc} {day_}", "not coming {day_}", "cancel"]],
    ["price", ["how much", "how much is {svcNom}", "how much for {svcNom}", "price of {svcNom}", "what does {svcNom} cost", "price list", "price list pls", "prices?", "whats the price", "how much do you charge for {svcNom}", "is {svcNom} expensive", "cost?", "how much would {svcNom} be", "rates?", "how much {master}"]],
    ["complaint", ["terrible haircut", "worst service ever", "the barber was late", "i want a refund", "not happy with my beard", "you ruined my hair", "the barber was rude", "waited 30 minutes", "really disappointed", "my fade is uneven", "i got cut while shaving", "never coming back", "this is unacceptable", "bad experience", "i want to complain", "my son's haircut is crooked", "overpriced and bad"]],
    ["address", ["where are you", "whats your address", "address?", "how do i find you", "location?", "send your location", "where is the shop", "how do i get there", "which street are you on", "are you downtown", "where exactly are you"]],
    ["hours", ["what time do you close", "when do you open", "opening hours?", "are you open {day}", "open now?", "are you open sunday", "hours?", "how late are you open", "whats your schedule", "are you open today", "what time is the last appointment"]],
    ["confirm", ["yes", "ok", "okay", "sure", "sounds good", "the first one", "the second one", "first", "yep", "yeah", "deal", "perfect", "works for me", "yes {time}", "yep {time} works", "lets do it", "great", "fine", "k"]],
    ["thanks", ["{thx}", "{thx}!", "{thx} 🙏", "got it, {thx}", "{thx} for the help"]],
    ["greeting", ["{hi}", "{hi}!", "{hi} 👋", "{hi}, quick question", "{hi}, anyone there?"]],
    ["other", ["do you have parking", "can i bring my dog", "do you dye hair", "are you hiring", "can i pay by card", "do you sell gift cards", "what age do you cut kids", "do you have wifi", "do you cut womens hair", "student discount?", "are you a bot", "how are you", "do you have instagram", "what products do you use", "is there coffee"]],
    ["greeting,booking", ["{hi}, can i book {svc} {day_}", "{hi}, i want to book {day_} {time_}", "{hi}! any slots {day} {time_}?", "{hi} can i come in {day}"]],
    ["greeting,price", ["{hi}, how much is {svcNom}", "{hi}! price list please", "{hi} how much for {svcNom}"]],
    ["greeting,visits", ["{hi}, when is my appointment", "{hi}, can you check my booking"]],
    ["greeting,cancel", ["{hi}, i need to cancel {day_}", "{hi}, cant make it {day_}"]],
    ["greeting,address", ["{hi}, where are you located", "{hi}, whats your address"]],
    ["greeting,hours", ["{hi}, what time do you close", "{hi}, are you open {day}"]],
    ["price,booking", ["how much is {svcNom} and can i come {day}", "can i book {svc} {day_}? how much is it", "whats the price for {svcNom}, i want to book {day_}"]],
    ["hours,address", ["where are you and when do you open", "address and opening hours please"]],
    ["confirm,thanks", ["yes, {thx}", "perfect, {thx}", "ok {thx}"]],
  ],
};

// ---------- how people type ----------
const TRANSLIT: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const PLAIN: Record<string, string> = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" };

function typo(s: string): string {
  const words = s.split(" ");
  const i = words.findIndex((w, k) => w.length >= 5 && k === Math.floor(r() * words.length));
  if (i < 0) return s;
  const w = words[i];
  const j = 1 + Math.floor(r() * (w.length - 2));
  words[i] = maybe(0.5) ? w.slice(0, j) + w.slice(j + 1) : w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
  return words.join(" ");
}

function style(lang: L, s: string): string {
  let t = s.replace(/\s+/g, " ").replace(/\s+([?!,.])/g, "$1").trim().replace(/^,\s*/, "");
  if (maybe(0.15)) t = typo(t);
  if (maybe(0.35)) t = t.replace(/[?!.,]/g, "");
  if (maybe(0.15)) t = t[0].toUpperCase() + t.slice(1);
  if (lang === "ru" && maybe(0.06)) t = t.toLowerCase().replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? c);
  if (lang === "kk" && maybe(0.25)) t = t.replace(/[әғқңөұүһі]/gi, (c) => PLAIN[c.toLowerCase()] ?? c);
  if (maybe(0.05)) t += pick([" 🙂", " 😊", " 🙏", " )", "))"]);
  if (maybe(0.06) && !/[?]$/.test(t)) t += " " + pick((S[lang] as { please: string[] }).please);
  return t.replace(/\s+/g, " ").trim();
}

// ---------- make the file ----------
const PER_TEMPLATE = 14;
const lines: string[] = [];
const seen = new Set<string>();
// Two phrases are the same when the model sees the same features in them.
const norm = (s: string) => features(s).sort().join(" ");
for (const f of ["test.tsv", "phrases.tsv"])
  for (const row of readFileSync(fileURLToPath(new URL(`../data/${f}`, import.meta.url)), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).slice(1)) {
    const [, , text] = row.split("\t");
    seen.add(norm(text));
  }
let left = 0;
for (const lang of ["ru", "kk", "en"] as L[])
  for (const [labels, ts] of TEMPLATES[lang])
    for (const t of ts) {
      const open = /\{/.test(t);
      for (let k = 0; k < (open ? PER_TEMPLATE : 3); k++) {
        const text = style(lang, fill(lang, t));
        const key = norm(text);
        if (!text.trim() || seen.has(key)) {
          left++;
          continue;
        }
        seen.add(key);
        lines.push(`${lang}\t${labels}\t${text}`);
      }
    }

const header = [
  "# GENERATED by scripts/generate-phrases.ts (npm run generate). Do not edit by hand: change the templates.",
  "# Training phrases written the way clients type: short, no punctuation, typos, slang, Latin letters.",
  "lang\tlabels\ttext",
];
writeFileSync(fileURLToPath(new URL("../data/generated.tsv", import.meta.url)), [...header, ...lines].join("\n") + "\n");
const by = (i: number) => lines.reduce<Record<string, number>>((a, l) => ((a[l.split("\t")[i]] = (a[l.split("\t")[i]] ?? 0) + 1), a), {});
console.log(`data/generated.tsv: ${lines.length} phrases (${left} repeats or test phrases left out)`, by(0));
