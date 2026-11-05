// End-to-end check of the browser site (dist-demo/index.html) in a real
// Chromium. The claude.ai site database is replaced by a stand-in with the
// same calls (collection, doc, set, update, delete, onSnapshot), kept in
// localStorage so a reload shows what survives.
//   npm run build:demo && node scripts/e2e-demo.cjs [screenshot folder]
// Needs Playwright (npx playwright install chromium).
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const out = process.argv[2] || path.join(__dirname, "..", "dist-demo", "shots");
fs.mkdirSync(out, { recursive: true });
const file = "file://" + path.join(__dirname, "..", "dist-demo", "index.html");

function mockClaude() {
  const KEY = "vx-mock-db";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  let data = load();
  const subs = {};
  const save = () => localStorage.setItem(KEY, JSON.stringify(data));
  const docs = (c) => Object.entries(data[c] || {}).map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) }));
  const emit = (c, change) => {
    const all = docs(c);
    for (const fn of subs[c] || []) setTimeout(() => fn({ docs: all, size: all.length, docChanges: () => [change] }), 5);
  };
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" ? merge(o[k], v) : v;
    return o;
  };
  const db = {
    collection(c) {
      return {
        get: async () => ({ docs: docs(c) }),
        doc: (id) => ({
          set: async (d) => {
            if (JSON.stringify(d).length > 256 * 1024) throw { code: "invalid_argument", message: "document over 256 KiB" };
            const had = !!(data[c] && data[c][id]);
            (data[c] ||= {})[id] = JSON.parse(JSON.stringify(d));
            save();
            emit(c, { type: had ? "modified" : "added", doc: { id, data: () => d } });
          },
          update: async (d) => {
            if (!(data[c] && data[c][id])) throw { code: "invalid_argument", message: "missing" };
            data[c][id] = merge(data[c][id], d);
            save();
            emit(c, { type: "modified", doc: { id, data: () => data[c][id] } });
          },
          delete: async () => {
            if (data[c]) delete data[c][id];
            save();
            emit(c, { type: "removed", doc: { id, data: () => ({}) } });
          },
        }),
        onSnapshot(next) {
          (subs[c] ||= new Set()).add(next);
          setTimeout(() => {
            const all = docs(c);
            next({ docs: all, size: all.length, docChanges: () => all.map((d) => ({ type: "added", doc: d })) });
          }, 5);
          return () => subs[c].delete(next);
        },
      };
    },
  };
  window.__saved = null;
  window.claude = {
    use: async (name) => {
      await new Promise((ok) => setTimeout(ok, 30));
      if (name === "db") return db;
      if (name === "user") return { can: () => true, isOwner: () => true };
      if (name === "downloads") return { save: async (f) => (window.__saved = { filename: f.filename, bytes: f.data.length }) };
      return null;
    },
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(mockClaude);
  await page.goto(file);
  await page.evaluate(() => localStorage.removeItem("vx-mock-db"));
  await page.reload();
  const shot = (n) => page.screenshot({ path: path.join(out, n), fullPage: false });
  await page.waitForSelector("#lv-kpis .kpi", { timeout: 20000 });
  const check = (ok, msg) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
    if (!ok) process.exitCode = 1;
  };
  check(await page.isVisible("text=saved in this site's database"), "site database connected");

  // Starter knowledge, as the owner would type it on day one.
  await page.click('a[data-tab="knowledge"]');
  const starter = [
    ["Оплата / Payment", "Принимаем наличные, карты и Kaspi QR, а также Apple Pay и Google Pay. We accept cash, cards, Kaspi QR, Apple Pay and Google Pay."],
    ["Парковка / Parking", "Бесплатная парковка во дворе за зданием. Free parking in the yard behind the building."],
  ];
  for (const [t, x] of starter) {
    await page.fill('#kn-add input[name="t"]', t);
    await page.fill('#kn-add textarea[name="x"]', x);
    await page.click('#kn-add button[type="submit"]');
    await page.waitForTimeout(150);
  }
  check((await page.locator("#kn-list .kn").count()) === 2, "knowledge saved");

  // A client writes by hand.
  await page.click('a[data-tab="live"]');
  await page.fill("#lv-name", "Aliya");
  await page.selectOption("#lv-ch", "telegram");
  await page.fill("#lv-text", "Сәлем! Ертең кешке шаш қиюға жазылуға бола ма?");
  await page.click("#lv-compose button[type=submit]");
  await page.waitForSelector(".msg.ai", { timeout: 5000 });
  const reply = await page.locator(".msg.ai p").last().textContent();
  check(/бос уақыт/.test(reply), `Kazakh booking request gets free times in Kazakh: «${reply.slice(0, 80)}…»`);
  await page.fill("#lv-text", "Иә, біріншісі");
  await page.click("#lv-compose button[type=submit]");
  await page.waitForFunction(() => [...document.querySelectorAll(".msg.ai p")].some((p) => /Дайын/.test(p.textContent)), null, { timeout: 5000 });
  check(true, "booking confirmed in Kazakh");
  await shot("01-live-first-client.png");

  // The demo stream, fast, with the simulated operator.
  await page.selectOption("#lv-speed", "200");
  await page.click("#lv-play");
  await page.waitForFunction(() => /Done/.test(document.getElementById("lv-prog")?.textContent || ""), null, { timeout: 120000 });
  await page.waitForTimeout(600);
  const kpi = await page.locator("#lv-kpis").innerText();
  console.log(kpi.replace(/\n/g, " | "));
  const note = await page.locator("#lv-chart-note").innerText();
  console.log(note);
  const [, nowOn, nowOff, allOn, allOff] = /Now (\d+)% vs (\d+)%.*?: (\d+)% vs (\d+)%/.exec(note) || [];
  check(+allOn > +allOff, `learning beats the frozen model over the stream (${allOn}% vs ${allOff}%; last 12: ${nowOn}% vs ${nowOff}%)`);
  await shot("02-live-after-stream.png");

  // CRM: a staff command, then the calendar.
  await page.click('a[data-tab="crm"]');
  await page.fill("#cr-text", "Запиши Алию на завтра в 15:00 на мужскую стрижку");
  await page.click("#cr-form button");
  await page.waitForSelector(".plan [data-go=confirm]");
  const plan = await page.locator(".plan").innerText();
  check(/Book Aliya/.test(plan), `command understood: ${plan.split("\n")[0]}`);
  await page.click(".plan [data-go=confirm]");
  await page.waitForSelector(".bk.hl", { timeout: 5000 });
  check(true, "booking appears highlighted in the calendar");
  await shot("03-crm-calendar.png");
  await page.fill("#cr-text", "Кто не приходил 30 дней?");
  await page.click("#cr-form button");
  await page.waitForTimeout(200);
  await page.click(".seg.big button[data-v=clients]");
  await page.locator("tr[data-client]").first().click();
  await page.waitForSelector(".mem");
  await shot("04-crm-client-memory.png");

  // Training: retrain and the version table.
  await page.click('a[data-tab="training"]');
  await page.click("#tr-retrain");
  await page.waitForSelector("#tr-prog .prog", { timeout: 5000 });
  await shot("05-training-retrain-running.png");
  await page.waitForFunction(() => !document.querySelector("#tr-prog .prog") && /v1/.test(document.getElementById("tr-versions")?.textContent || ""), null, { timeout: 60000 });
  const versions = await page.locator("#tr-versions").innerText();
  check(/v1/.test(versions), `retrain finished: ${versions.split("\n")[1]}`);
  await page.fill("#tr-text", "Ертеңге орын бар ма?");
  await page.click('#tr-lbs .tg[data-l="booking"]');
  await page.click("#tr-teach button[type=submit]");
  await page.waitForSelector("#tr-res .plan");
  check(true, `taught by hand: ${(await page.locator("#tr-res").innerText()).slice(0, 90)}`);
  await shot("06-training.png");

  // Knowledge search and the data tab.
  await page.click('a[data-tab="knowledge"]');
  await page.fill("#kn-q", "Do you sell gift cards?");
  await page.click("#kn-ask button");
  await page.waitForSelector("#kn-res .hit");
  await shot("07-knowledge.png");
  await page.click('a[data-tab="data"]');
  await page.waitForSelector("#dt-cols table");
  await page.click('[data-peek="phrases"]');
  await shot("08-data.png");
  await page.click("#dt-export");
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() => window.__saved);
  check(!!saved && saved.bytes > 1000, `export offered as a file: ${saved && saved.filename}, ${saved && saved.bytes} bytes`);

  // Reload: everything comes back from the database.
  const modelBefore = (await page.locator("#vx-model").innerText()).split(" · ")[0];
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("vx-mock-db") || "{}"));
  const counts = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, Object.keys(v).length]));
  console.log("saved documents:", JSON.stringify(counts));
  await page.reload();
  await page.click('a[data-tab="live"]');
  await page.waitForSelector("#lv-kpis .kpi", { timeout: 20000 });
  await page.waitForTimeout(800);
  const after = await page.locator("#lv-kpis").innerText();
  check(after.split("\n")[0] === kpi.split("\n")[0] || +after.split("\n")[0] >= +kpi.split("\n")[0], `after reload the AI remembers: ${after.replace(/\n/g, " | ").slice(0, 120)}`);
  const model = await page.locator("#vx-model").innerText();
  check(model.startsWith(modelBefore), `after reload the same model version is live (${modelBefore}): ${model}`);

  // Phone width.
  await page.setViewportSize({ width: 390, height: 860 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, `no sideways scroll on a phone (${overflow}px)`);
  await page.screenshot({ path: path.join(out, "09-phone-live.png"), fullPage: false });

  check(!errors.length, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
})();
