// End-to-end check of the browser site (dist-demo/index.html) in a real
// Chromium. The claude.ai site database is replaced by a stand-in with the
// same calls (collection, doc, set, update, delete, onSnapshot). Before the
// reload the test copies the stand-in's data into the next page load, the
// way the real database would still hold it, so a reload shows what survives.
//   npm run build:demo && node scripts/e2e-demo.cjs [screenshot folder]
// Needs Playwright (npx playwright install chromium).
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const out = process.argv[2] || path.join(__dirname, "..", "dist-demo", "shots");
fs.mkdirSync(out, { recursive: true });
const file = "file://" + path.join(__dirname, "..", "dist-demo", "index.html");

function mockClaude() {
  // Filled at the first use("db"): the data the test carried over a reload, or nothing.
  let data = null;
  const subs = {};
  window.__vxDump = () => JSON.stringify(data || {});
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
            emit(c, { type: had ? "modified" : "added", doc: { id, data: () => d } });
          },
          update: async (d) => {
            if (!(data[c] && data[c][id])) throw { code: "invalid_argument", message: "missing" };
            data[c][id] = merge(data[c][id], d);
            emit(c, { type: "modified", doc: { id, data: () => data[c][id] } });
          },
          delete: async () => {
            if (data[c]) delete data[c][id];
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
      if (name === "db") {
        data ||= JSON.parse(window.__vxSeed || "{}");
        return db;
      }
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

  // Real time: a message drawn while the model computes it, and the numbers on the screen are the model's.
  await page.click('a[data-tab="realtime"]');
  await page.waitForSelector("#fl-canvas");
  check(/example/i.test(await page.locator("#fl-msg").innerText()), "real time opens with an example while no message has come");
  await page.selectOption("#fl-speed", "fast");
  await page.fill("#fl-name", "Dana");
  await page.selectOption("#fl-ch", "whatsapp");
  const priceText = "Сколько стоит стрижка и борода?";
  await page.fill("#fl-text", priceText);
  await page.click("#fl-form button[type=submit]");
  await page.waitForFunction(() => /Dana · WhatsApp/.test(document.getElementById("fl-msg")?.textContent || ""), null, { timeout: 5000 });
  await page.waitForSelector('#fl-stages li[data-s="weigh"].on', { timeout: 5000 });
  await page.waitForTimeout(250);
  const lit = await page.evaluate(() => {
    const c = document.getElementById("fl-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 170 && d[i] < 190 && d[i + 2] < 220) n++;
    return n;
  });
  check(lit > 300, `the weights light up while the message goes through (${lit} bright green pixels)`);
  await page.waitForSelector('#fl-steps .fl-step[data-s="act"].done', { timeout: 8000 });
  await shot("10-realtime-message.png");
  const decide = await page.locator('#fl-steps .fl-step[data-s="decide"]').innerText();
  const num = (x) => parseFloat(x.replace("−", "-"));
  const [, iname, sStart, , sZ, sPct] = /(.+?): start ([+−][\d.]+) \+ votes ([+−][\d.]+) = z ([+−][\d.]+) → sigmoid → (\d+)%/.exec(decide) || [];
  const ref = await page.evaluate(
    async ([text, name]) => {
      const r = await (await fetch("/v1/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })).json();
      const j = r.labels.indexOf(Object.keys(window.NAMES).find((k) => window.NAMES[k] === name));
      return { j, bias: r.bias[j], z: r.contributions.reduce((s, c) => s + c[j], r.bias[j]), score: r.scores[j] };
    },
    [priceText, iname],
  );
  check(
    ref.j >= 0 && Math.abs(num(sStart) - ref.bias) < 0.006 && Math.abs(num(sZ) - ref.z) < 0.006 && Math.round(ref.score * 100) === +sPct,
    `the screen shows the model's own numbers: ${iname} start ${sStart}, z ${sZ}, ${sPct}% (the model: ${ref.bias.toFixed(4)}, ${ref.z.toFixed(4)}, ${(ref.score * 100).toFixed(2)}%)`,
  );
  const box = await page.locator("#fl-canvas").boundingBox();
  const gap = Math.min(34, (box.height - 58) / 14.5);
  await page.mouse.move(box.x + box.width * 0.71 - 40, box.y + (box.height + 26) / 2 + (ref.j - 6.5) * gap);
  await page.waitForSelector("#fl-tip:not([hidden])", { timeout: 2000 });
  const tip = await page.locator("#fl-tip").innerText();
  check(tip.startsWith(iname) && tip.includes(`z ${sZ}`), `pointing at an intent shows its sum: ${tip.split("\n").slice(0, 3).join(" · ")}`);
  await page.mouse.move(box.x + 5, box.y + 5);

  // Paused, a new message waits on its first step, and each click shows the next one.
  await page.click("#fl-pause");
  await page.fill("#fl-text", "Можно записаться на королевское бритьё в субботу в 12:00?");
  await page.click("#fl-form button[type=submit]");
  for (let i = 0; i < 4 && !/бритьё/.test(await page.locator("#fl-msg").innerText()); i++) {
    await page.waitForTimeout(150);
    if (!/бритьё/.test(await page.locator("#fl-msg").innerText())) await page.click("#fl-step");
  }
  const walked = [];
  for (let i = 0; i < 4; i++) {
    walked.push((await page.locator("#fl-stages li.on").allInnerTexts()).join());
    await page.click("#fl-step");
    await page.waitForTimeout(80);
  }
  check(walked.join(" → ") === "1 · Message → 2 · Features → 3 · Weights → 4 · Scores", `paused, one step at a time: ${walked.join(" → ")}`);
  await page.click("#fl-pause");

  // The «yes» proves both messages: the view shows each lesson after the message.
  await page.fill("#fl-text", "Да, первый вариант");
  await page.click("#fl-form button[type=submit]");
  await page.waitForSelector("#fl-msg .tag.k-learn", { timeout: 20000 });
  await page.waitForSelector('#fl-steps .fl-step[data-s="update"].on, #fl-steps .fl-step[data-s="hold"].on', { timeout: 8000 });
  await shot("11-realtime-lesson.png");
  const lesson = await page.locator("#fl-steps").innerText();
  check(/should be 100%/.test(lesson) && /small step/.test(lesson), `a lesson shows the error going back and the weights that changed: ${lesson.split("\n").filter((l) => /should be|→/.test(l)).slice(0, 2).join(" · ")}`);

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
  const dump = await page.evaluate(() => window.__vxDump());
  const before = JSON.parse(dump);
  await page.addInitScript((d) => (window.__vxSeed = d), dump);
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
  await page.click('a[data-tab="realtime"]');
  await page.waitForTimeout(1500);
  const overflowRt = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflowRt <= 1, `real time fits a phone too (${overflowRt}px sideways)`);
  await page.locator("#fl-screen").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "12-phone-realtime.png"), fullPage: false });

  // The demo stream in real time: each message waits until the picture has shown the one before.
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.selectOption("#fl-speed", "rapid");
  await page.click("#fl-play");
  let most = 0;
  for (let i = 0; i < 40 && !/Message [4-9] of/.test(await page.locator("#fl-prog").innerText()); i++) {
    most = Math.max(most, +((/(\d+) waiting/.exec(await page.locator("#fl-queue").innerText()) || [])[1] || 0));
    await page.waitForTimeout(250);
  }
  await page.locator("#fl-screen").scrollIntoViewIfNeeded();
  await shot("13-realtime-stream.png");
  await page.click("#fl-play");
  await page.waitForFunction(() => /Stopped after/.test(document.getElementById("fl-prog")?.textContent || ""), null, { timeout: 10000 });
  const progress = await page.locator("#fl-prog").innerText();
  // A new service teaches 6 phrases at once; after that each message waits for the picture, so nothing is skipped.
  check(/Stopped after [4-9]/.test(progress) && most <= 8 && !/skipped/.test(await page.locator("#fl-queue").innerText()), `the stream keeps pace with the picture: ${progress} (at most ${most} waiting, none skipped)`);

  check(!errors.length, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
})();
