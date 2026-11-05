// VoroniX AI site. Plain JavaScript, no libraries.
"use strict";
const NAMES = window.NAMES;
const LANG = { ru: "Russian", kk: "Kazakh", en: "English" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const post = (path, text) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || "Error")))));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- tabs ----------
const loaded = {};
function show() {
  const tabs = ["try", "inside", "training", "data", "api"].concat(window.VXUI ? ["live", "realtime", "crm", "knowledge"] : []);
  const first = window.VXUI ? "live" : "try";
  const tab = (location.hash || "#" + first).slice(1);
  const name = tabs.includes(tab) ? tab : first;
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
  if (!loaded[name]) {
    loaded[name] = true;
    ({ try: initTry, inside: explain, training: initTraining, data: initData })[name]?.();
  }
  window.VXUI?.show(name);
}
addEventListener("hashchange", show);

document.querySelectorAll(".chips").forEach((box) =>
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    $(box.dataset.for).value = b.textContent;
    box.dataset.for === "t" ? run() : explain();
  }),
);

function bars(el, scores, on) {
  el.innerHTML = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => '<div class="bar' + (on.has(k) ? " on" : "") + '"><span>' + NAMES[k] + '</span><div class="track"><div class="fill" style="width:' + (v * 100).toFixed(1) + '%"></div></div><span>' + (v * 100).toFixed(0) + "%</span></div>")
    .join("");
}

// ---------- try it ----------
async function run() {
  $("res").textContent = "…";
  try {
    const d = await post("/demo/classify", $("t").value);
    $("res").innerHTML = "Language: <b>" + LANG[d.lang] + "</b> &nbsp; Intent: " + d.intents.map((i) => '<span class="tag">' + NAMES[i.label] + "</span>").join(" ");
    bars($("bars"), d.scores, new Set(d.intents.map((i) => i.label)));
  } catch (e) {
    $("res").textContent = e.message;
    $("bars").innerHTML = "";
  }
}
$("go").onclick = run;

function initTry() {
  run();
  network();
}

// The hero picture: the strongest real weights of the model, drawn as glowing lines.
async function network() {
  const canvas = $("net");
  const net = await fetch("/v1/network?limit=900").then((r) => r.json());
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w, h, curves;
  const layout = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const F = net.features.length;
    const fx = w * 0.08, ix = w * 0.92;
    const fy = (i) => h * 0.08 + (h * 0.84 * i) / Math.max(F - 1, 1);
    const iy = (l) => h * 0.12 + (h * 0.76 * l) / (net.labels.length - 1);
    curves = net.links.map(([f, l, wt]) => ({ x0: fx, y0: fy(f), x1: ix, y1: iy(l), wt }));
    return { fx, ix, fy, iy };
  };
  const base = document.createElement("canvas");
  const draw = () => {
    const g = layout();
    base.width = canvas.width;
    base.height = canvas.height;
    const c = base.getContext("2d");
    c.scale(dpr, dpr);
    c.fillStyle = "#0b0d1d";
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "lighter";
    for (const k of curves) {
      const a = Math.min(Math.abs(k.wt) / 8, 1);
      c.strokeStyle = k.wt > 0 ? "rgba(45,212,196," + (0.02 + a * 0.18) + ")" : "rgba(255,107,157," + (0.02 + a * 0.16) + ")";
      c.lineWidth = 0.3 + a * 1.2;
      c.beginPath();
      c.moveTo(k.x0, k.y0);
      c.bezierCurveTo(w * 0.45, k.y0, w * 0.55, k.y1, k.x1, k.y1);
      c.stroke();
    }
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "rgba(223,227,255,.55)";
    net.features.forEach((_, i) => c.fillRect(g.fx - 3, g.fy(i), 3, 1));
    c.font = "600 12px system-ui";
    c.textAlign = "right";
    net.labels.forEach((l, i) => {
      c.fillStyle = "#8b7dff";
      c.beginPath();
      c.arc(g.ix, g.iy(i), 5, 0, 7);
      c.fill();
      if (w > 500) {
        c.fillStyle = "#dfe3ff";
        c.fillText(NAMES[l], g.ix - 10, g.iy(i) - 8);
      }
    });
  };
  draw();
  addEventListener("resize", () => draw());
  // Small sparks travel along the strongest positive connections.
  const strong = () => curves.filter((k) => k.wt > 2.5);
  let sparks = [];
  const ctx = canvas.getContext("2d");
  const frame = () => {
    if (!$("tab-try").hidden) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pool = strong();
      while (sparks.length < 60 && pool.length) sparks.push({ k: pool[(Math.random() * pool.length) | 0], t: 0, v: 0.004 + Math.random() * 0.006 });
      ctx.fillStyle = "#e9fffb";
      for (const s of sparks) {
        s.t += s.v;
        const { x0, y0, x1, y1 } = s.k, t = s.t, u = 1 - t;
        const x = u * u * u * x0 + 3 * u * u * t * (w * 0.45) + 3 * u * t * t * (w * 0.55) + t * t * t * x1;
        const y = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, 7);
        ctx.fill();
      }
      sparks = sparks.filter((s) => s.t < 1);
    }
    requestAnimationFrame(frame);
  };
  if (!reduced) requestAnimationFrame(frame);
  else canvas.getContext("2d").drawImage(base, 0, 0);
}

// ---------- inside the model ----------
$("go2").onclick = () => explain();
async function explain() {
  let d;
  try {
    d = await post("/demo/explain", $("t2").value);
  } catch (e) {
    $("feats").textContent = e.message;
    return;
  }
  $("feats").innerHTML =
    d.features.map((f) => '<span class="feat ' + f.kind + '">' + esc(f.feature) + "</span>").join("") +
    (d.unknown ? ' <span class="note">+ ' + d.unknown + " features the model never saw</span>" : "") +
    '<div class="note" style="width:100%;margin-top:6px"><span class="feat word">word</span> <span class="feat pair">pair of words</span> <span class="feat start">start of a word</span> <span class="feat">piece</span> &nbsp; Language: <b>' + LANG[d.lang] + "</b></div>";

  // Strongest features of this message.
  const strength = d.contributions.map((c, i) => ({ i, s: Math.max(...c.map(Math.abs)) }));
  const top = strength.sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.i);
  const svg = $("flow");
  const W = 900, H = 540, fx = 210, ix = 640;
  const fy = (k) => 30 + (k * (H - 60)) / Math.max(top.length - 1, 1);
  const iy = (l) => 30 + (l * (H - 60)) / (d.labels.length - 1);
  const max = Math.max(...top.flatMap((i) => d.contributions[i].map(Math.abs)), 0.01);
  const pos = css("--accent2") || "#2dd4c4", neg = css("--neg") || "#ff6b9d";
  let out = "";
  top.forEach((fi, k) => {
    d.contributions[fi].forEach((v, l) => {
      const a = Math.abs(v) / max;
      if (a < 0.08) return;
      out += '<path class="link" d="M' + fx + " " + fy(k) + " C" + (fx + 200) + " " + fy(k) + " " + (ix - 200) + " " + iy(l) + " " + ix + " " + iy(l) + '" stroke="' + (v > 0 ? pos : neg) + '" stroke-width="' + (0.6 + a * 6).toFixed(2) + '" stroke-opacity="' + (0.25 + a * 0.7).toFixed(2) + '" style="animation-duration:' + (2.2 - a * 1.4).toFixed(2) + 's"><title>' + esc(d.features[fi].feature) + " → " + NAMES[d.labels[l]] + ": " + (v > 0 ? "+" : "") + v.toFixed(2) + "</title></path>";
    });
  });
  top.forEach((fi, k) => {
    out += '<circle cx="' + fx + '" cy="' + fy(k) + '" r="5" fill="#dfe3ff"/><text x="' + (fx - 12) + '" y="' + (fy(k) + 4) + '" text-anchor="end">' + esc(d.features[fi].feature.slice(0, 22)) + "</text>";
  });
  d.labels.forEach((l, i) => {
    const s = d.scores[i];
    out += '<circle cx="' + ix + '" cy="' + iy(i) + '" r="' + (6 + s * 16).toFixed(1) + '" fill="' + (s >= 0.5 ? pos : "#3a3f66") + '" fill-opacity="' + (s >= 0.5 ? 0.95 : 0.8) + '"/>';
    out += '<text class="lab" x="' + (ix + 30) + '" y="' + (iy(i) + 1) + '">' + NAMES[l] + '</text><text class="sc" x="' + (ix + 30) + '" y="' + (iy(i) + 17) + '">' + (s * 100).toFixed(0) + "%</text>";
  });
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.innerHTML = out;

  // The arithmetic for every intent.
  const rows = d.labels
    .map((l, i) => ({ l, i, sum: d.contributions.reduce((a, c) => a + c[i], 0) }))
    .sort((a, b) => d.scores[b.i] - d.scores[a.i])
    .map(({ l, i, sum }) => {
      const z = d.bias[i] + sum;
      return "<tr" + (d.scores[i] >= 0.5 ? ' style="font-weight:700"' : "") + "><td>" + NAMES[l] + "</td><td>" + d.bias[i].toFixed(2) + "</td><td class=\"" + (sum >= 0 ? "pos" : "neg") + "\">" + (sum >= 0 ? "+" : "") + sum.toFixed(2) + "</td><td>" + z.toFixed(2) + "</td><td>" + (d.scores[i] * 100).toFixed(1) + "%</td><td>" + (d.scores[i] >= 0.5 ? "yes" : "no") + "</td></tr>";
    })
    .join("");
  $("math").innerHTML = "<table><tr><th>Intent</th><th>Start value</th><th>Sum of votes</th><th>z</th><th>Score</th><th>In the answer</th></tr>" + rows + "</table>";
}

// ---------- training ----------
async function initTraining() {
  const [tr, ds] = await Promise.all([fetch("/v1/training").then((r) => r.json()), fetch("/v1/dataset").then((r) => r.json())]);
  const E = tr.epochs, n = E.length;
  $("split").textContent = "The model learns from " + tr.split.train + " phrases and is checked after every epoch on " + tr.split.test + " phrases it never learns from.";
  $("watchtext").textContent = "«" + tr.watch.text + "»";
  const s = tr.settings;
  $("settings").innerHTML = [
    [s.epochs, "epochs (passes over the data)"],
    [s.learningRate, "learning rate (size of each step, getting smaller over time)"],
    [s.l2, "L2 penalty (keeps weights small, against memorising)"],
    [s.positiveWeight, "weight of a positive example (intents are rare)"],
    [s.seed, "random seed (same order, same model every time)"],
    [tr.watch.labels.length + " + 3", "classifiers: one per intent, one for the 3 languages"],
  ].map(([v, t]) => "<div><b>" + v + "</b><span>" + t + "</span></div>").join("");

  const svg = $("curve");
  const W = 900, H = 320, L = 50, R = 860, T = 20, B = 280;
  const last = E[n - 1].epoch;
  const x = (e) => L + (e * (R - L)) / last;
  const maxLoss = Math.max(...E.map((p) => p.loss));
  const yl = (v) => B - (v / maxLoss) * (B - T);
  const ya = (v) => B - v * (B - T);
  const line = (f, color) => '<polyline fill="none" stroke="' + color + '" stroke-width="3" stroke-linejoin="round" points="' + E.map((p) => x(p.epoch).toFixed(1) + "," + f(p).toFixed(1)).join(" ") + '"/>';
  let grid = "";
  for (let i = 0; i <= 4; i++) grid += '<line class="grid" x1="' + L + '" x2="' + R + '" y1="' + ya(i / 4) + '" y2="' + ya(i / 4) + '"/><text x="' + (R + 6) + '" y="' + (ya(i / 4) + 4) + '">' + i * 25 + "%</text>";
  for (let e = 10; e <= last; e += 10) grid += '<text x="' + x(e) + '" y="' + (B + 20) + '" text-anchor="middle">' + e + "</text>";
  grid += '<text x="' + L + '" y="' + (B + 20) + '">epoch 0</text>';
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.innerHTML = grid + line((p) => yl(p.loss), css("--neg")) + line((p) => ya(p.exact_match), css("--accent2")) + line((p) => ya(p.f1), css("--accent")) + '<line id="cur" y1="' + T + '" y2="' + B + '" stroke="' + css("--ink") + '" stroke-dasharray="4 4"/>';

  const set = (e) => {
    $("ep").value = e;
    const p = E[e];
    $("cur").setAttribute("x1", x(e));
    $("cur").setAttribute("x2", x(e));
    $("eplabel").textContent = (e === 0 ? "Before training" : "Epoch " + e) + ": error " + p.loss.toFixed(3) + ", exactly right " + (p.exact_match * 100).toFixed(1) + "%";
    const sc = Object.fromEntries(tr.watch.labels.map((l, i) => [l, tr.watch.scores[e][i]]));
    bars($("watch"), sc, new Set(tr.watch.labels.filter((l) => sc[l] >= 0.5)));
  };
  $("ep").min = 0;
  $("ep").max = last;
  $("ep").oninput = () => set(+$("ep").value);
  let timer = null;
  $("play").onclick = () => {
    clearInterval(timer);
    let e = 0;
    set(e);
    timer = setInterval(() => (++e > last ? clearInterval(timer) : set(e)), e < 10 ? 400 : 120);
  };
  set(last);

  const rows = ds.phrases;
  const table = () => {
    const lang = $("flang").value, label = $("flabel").value, q = $("fq").value.toLowerCase();
    const list = rows.filter((p) => (!lang || p.lang === lang) && (!label || p.labels.includes(label)) && (!q || p.text.toLowerCase().includes(q)));
    $("fcount").textContent = list.length + " of " + rows.length;
    $("phrases").innerHTML = "<tr><th>Message</th><th>Language</th><th>Intents</th></tr>" + list.map((p) => "<tr><td>" + esc(p.text) + "</td><td>" + p.lang + "</td><td>" + p.labels.map((l) => NAMES[l]).join(", ") + "</td></tr>").join("");
  };
  ["flang", "flabel", "fq"].forEach((id) => ($(id).oninput = table));
  table();
}

// ---------- data & storage ----------
async function initData() {
  const s = await fetch("/v1/storage").then((r) => r.json());
  $("s-file").textContent = s.data_file.phrases + " phrases, " + (s.data_file.bytes / 1024).toFixed(0) + " KB";
  $("s-copies").textContent = "+" + s.training_copies + " copies";
  $("s-vocab").textContent = s.vocabulary.size.toLocaleString("en") + " features (" + s.vocabulary.word + " words, " + s.vocabulary.pair + " pairs, " + s.vocabulary.start + " starts, " + s.vocabulary.piece + " pieces)";
  $("s-weights").textContent = s.weights.intent_rows + " + " + s.weights.language_rows + " rows, " + s.weights.numbers.toLocaleString("en") + " numbers, about " + s.weights.megabytes_in_memory + " MB";
  $("sample").textContent = s.data_file.columns.join("\t") + "\n" + s.data_file.sample.join("\n");
  $("topw").innerHTML = "<table><tr><th>Word</th><th>Weight</th></tr>" + s.top_price_words.map((x) => "<tr><td>" + esc(x.feature) + '</td><td class="pos">+' + x.weight.toFixed(2) + "</td></tr>").join("") + "</table>";
}

show();
