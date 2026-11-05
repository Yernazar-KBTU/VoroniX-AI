import type { Brain } from "./service.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const LABEL_NAMES: Record<string, string> = {
  greeting: "Greeting",
  price: "Asks the price",
  booking: "Wants to book",
  cancel: "Cancels",
  complaint: "Complaint",
  address: "Asks the address",
  hours: "Asks opening hours",
  confirm: "Agrees",
  thanks: "Thanks",
  other: "Something else",
};

const EXAMPLES = [
  "Сәлеметсіз бе! Шаш қию қанша тұрады?",
  "Ертең келе алмаймын",
  "Здравствуйте, можно записаться на пятницу в 18:00?",
  "Мне испортили стрижку, верните деньги",
  "Where are you located?",
  "Yes, that time works, thanks!",
];

/** The service's site: try the model, look inside it, watch it train, see how data is kept, read the API. */
/** live: the browser version that works and learns with the site's own database (see src/live). */
export function page(brain: Brain, opts: { live?: boolean } = {}): string {
  const live = !!opts.live;
  const r = brain.report;
  const rows = Object.entries(r.holdout.per_label)
    .map(([l, m]) => `<tr><td>${esc(LABEL_NAMES[l] ?? l)} <code>${esc(l)}</code></td><td>${m.support}</td><td>${pct(m.precision)}</td><td>${pct(m.recall)}</td><td><b>${pct(m.f1)}</b></td></tr>`)
    .join("");
  const chips = EXAMPLES.map((e) => `<button class="chip" type="button">${esc(e)}</button>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VoroniX AI</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="wrap">
<header><div class="logo">V</div><b>VoroniX AI</b><span id="vx-model">model ${esc(brain.info.name)} v${esc(brain.info.version)}</span></header>
<nav class="tabs" role="tablist">
${live ? '<a href="#live" data-tab="live">Live</a><a href="#crm" data-tab="crm">CRM</a><a href="#training" data-tab="training">Training <i class="badge" id="vx-queue-badge" hidden></i></a><a href="#knowledge" data-tab="knowledge">Knowledge</a><a href="#inside" data-tab="inside">Inside the model</a><a href="#try" data-tab="try">Try it</a><a href="#data" data-tab="data">Data &amp; storage</a><a href="#api" data-tab="api">API</a>' : '<a href="#try" data-tab="try">Try it</a><a href="#inside" data-tab="inside">Inside the model</a><a href="#training" data-tab="training">Training</a><a href="#data" data-tab="data">Data &amp; storage</a><a href="#api" data-tab="api">API</a>'}
</nav>

<main>
${live ? '<section id="tab-live" class="tab" hidden><div id="vx-live"></div></section><section id="tab-crm" class="tab" hidden><div id="vx-crm"></div></section><section id="tab-knowledge" class="tab" hidden><div id="vx-knowledge"></div></section>' : ""}
<section id="tab-try" class="tab"${live ? " hidden" : ""}>
<div class="hero"><div class="stage"><canvas id="net" aria-label="The strongest connections of the trained model"></canvas>
<div class="hero-text"><h1>Our own AI that understands salon clients</h1>
<p class="lead">VoroniX AI reads a client's message in Russian, Kazakh or English and tells the CRM what the client wants: book, ask the price, cancel, complain and more. We collected the phrases, trained the model ourselves and serve it through this API. No paid AI services.</p></div></div>
<p class="caption">Above: the ${"900"} strongest connections of the trained model. Each line joins a word or word piece (left) to an intent (right). Teal pushes the intent up, pink pushes it down.</p></div>

<div class="card">
<h2>Try it</h2>
<textarea id="t" maxlength="1000" placeholder="Write like a client would">${esc(EXAMPLES[0])}</textarea>
<div class="chips" data-for="t">${chips}</div>
<button id="go" type="button">Understand</button>
<div class="result" id="res"></div><div class="bars" id="bars"></div>
</div>

<h2 class="h2">How good it is</h2>
<p class="note">Measured only on phrases the model never saw during training. Holdout: trained on ${r.holdout.train_examples} phrases, tested on ${r.holdout.examples}. Cross-validation: the data is split into ${r.cross_validation.folds} parts and every part is tested once.</p>
<div class="stats">
<div class="stat"><b>${r.dataset.phrases}</b><span>training phrases (${Object.entries(r.dataset.by_language).map(([k, v]) => `${k} ${v}`).join(", ")})</span></div>
<div class="stat"><b>${pct(r.cross_validation.exact_match)}</b><span>messages understood exactly right</span></div>
<div class="stat"><b>${pct(r.cross_validation.micro_f1)}</b><span>F1 over all intents</span></div>
<div class="stat"><b>${pct(r.cross_validation.language_accuracy)}</b><span>language detected right</span></div>
</div>
<div class="card table"><table><tr><th>Intent (holdout)</th><th>Phrases</th><th>Precision</th><th>Recall</th><th>F1</th></tr>${rows}</table></div>
</section>

<section id="tab-inside" class="tab" hidden>
<h1>Inside the model</h1>
<p class="lead">Write a message and watch how the model decides. Nothing here is drawn for show: every line is a real weight of the trained model.</p>
<div class="card">
<textarea id="t2" maxlength="1000">${esc(EXAMPLES[0])}</textarea>
<div class="chips" data-for="t2">${chips}</div>
<button id="go2" type="button">Show the decision</button>
</div>
<div class="step"><span class="num">1</span><div><h3>Cut the message into features</h3><p class="note">Whole words, pairs of words, the first 4 letters of long words, and pieces of 3 to 5 letters. Pieces let the model recognise «қанша» inside «қаншадан» or a typo. The signs &lt; and &gt; mark the start and end of a word. Features the model never saw in training are ignored.</p><div id="feats" class="feats"></div></div></div>
<div class="step"><span class="num">2</span><div><h3>Every feature votes for or against every intent</h3><p class="note">The strongest features of this message on the left, the 10 intents on the right. Teal lines vote for, pink lines against; a thicker line is a stronger vote. The circle grows with the intent's score.</p><div class="card vis"><svg id="flow" viewBox="0 0 900 540" role="img" aria-label="How the features of the message vote for each intent"></svg></div></div></div>
<div class="step"><span class="num">3</span><div><h3>Add up the votes and turn them into a probability</h3><p class="note">For each intent: start value (bias) + sum of votes = z, then the sigmoid 1 / (1 + e<sup>−z</sup>) turns z into a score from 0 to 1. Intents above 0.5 are the answer.</p><div id="math" class="card table"></div></div></div>
</section>

<section id="tab-training" class="tab" hidden>
<h1>How it learns</h1>
${live ? '<div id="vx-training"></div><h2 class="h2">How one training run works</h2>' : ""}
<p class="lead">Training is a loop. The model reads every phrase, guesses its intents, compares the guess with the right answer and moves each weight a little in the direction that makes the error smaller (gradient descent). One pass over all phrases is an epoch.</p>
<div class="card"><h2>Replay of a real training run</h2>
<p class="note" id="split"></p>
<svg id="curve" viewBox="0 0 900 320" role="img" aria-label="Error and accuracy after every epoch"></svg>
<div class="legend"><span><i class="sw loss"></i>Error on training phrases (log loss)</span><span><i class="sw acc"></i>Exactly right on unseen phrases</span><span><i class="sw f1"></i>F1 on unseen phrases</span></div>
<div class="player"><button id="play" type="button">▶ Replay</button><input id="ep" type="range" min="1" max="60" value="60" aria-label="Epoch"><b id="eplabel"></b></div>
<p class="note">How the model sees <b id="watchtext"></b> after this epoch:</p>
<div class="bars" id="watch"></div>
</div>
<div class="card"><h2>Training settings</h2><div id="settings" class="kv"></div></div>
<div class="card"><h2>The training data</h2>
<p class="note">Every phrase the model learns from. Filter by language and intent.</p>
<div class="filters"><select id="flang"><option value="">All languages</option><option value="ru">Russian</option><option value="kk">Kazakh</option><option value="en">English</option></select><select id="flabel"><option value="">All intents</option>${Object.entries(LABEL_NAMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select><input id="fq" type="search" placeholder="Search"><span id="fcount" class="note"></span></div>
<div class="table scroll"><table id="phrases"></table></div>
</div>
</section>

<section id="tab-data" class="tab" hidden>
<h1>Where the data lives</h1>
${live ? '<div id="vx-data"></div><h2 class="h2">The start data</h2><p class="note">Before it learns anything at work, the model is trained on the start phrases from the repository:</p>' : '<p class="lead">The model is small enough to be rebuilt from a text file every time the service starts. Client messages sent to the API are answered and forgotten.</p>'}
<div class="pipe">
<div class="box"><b>1. Text file</b><span>data/phrases.tsv in the GitHub repository</span><em id="s-file"></em></div><div class="arrow">→</div>
<div class="box"><b>2. Training copies</b><span>Kazakh phrases also without Kazakh letters</span><em id="s-copies"></em></div><div class="arrow">→</div>
<div class="box"><b>3. Vocabulary</b><span>every feature seen in training gets a number</span><em id="s-vocab"></em></div><div class="arrow">→</div>
<div class="box"><b>4. Weights in memory</b><span>one row of numbers per intent and per language</span><em id="s-weights"></em></div>
</div>
<div class="grid2">
<div class="card"><h2>One line of the data file</h2><p class="note">Language, intents, message, separated by tabs:</p><pre id="sample"></pre></div>
<div class="card"><h2>What one row of weights looks like</h2><p class="note">Words with the biggest weights in the row of the intent «Asks the price»:</p><div id="topw" class="table"></div></div>
</div>
<div class="card"${live ? " hidden" : ""}><h2>What is stored, and where</h2>
<table>
<tr><th>Thing</th><th>Where</th><th>How long</th></tr>
<tr><td>Training phrases</td><td>data/phrases.tsv in the repository, versioned with git</td><td>Permanently, every change is in the history</td></tr>
<tr><td>Trained weights</td><td>Memory of the running service</td><td>Until the service restarts, then trained again from the file (same data, same result)</td></tr>
<tr><td>Quality report</td><td>reports/metrics.json in the repository</td><td>Updated by <code>npm run train</code>; a test fails if it is out of date</td></tr>
<tr><td>Messages sent to the API</td><td>Nowhere: the text is read, answered and dropped</td><td>Not stored</td></tr>
<tr><td>Request counter for the limit</td><td>Memory: address and count</td><td>One minute</td></tr>
<tr><td>Client chats, bookings</td><td>The VoroniX CRM's PostgreSQL, a separate schema per business</td><td>As the business keeps them; the CRM sends only the message text here</td></tr>
</table></div>
</section>

<section id="tab-api" class="tab" hidden>
<h1>API</h1>
<pre>curl -X POST ${"$"}VORONIX_AI_URL/v1/classify \\
  -H "Authorization: Bearer ${"$"}VORONIX_AI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Сәлем! Ертеңге жазылуға бола ма?"}'</pre>
<div class="card table"><table>
<tr><th>Request</th><th>What it does</th></tr>
<tr><td><code>POST /v1/classify</code></td><td>Intents and language of <code>{"text"}</code>, or of <code>{"texts": [...]}</code> (up to 50, 1000 characters each)</td></tr>
<tr><td><code>POST /v1/explain</code></td><td>The features of a text and how each one voted (what the «Inside the model» tab shows)</td></tr>
<tr><td><code>GET /v1/model</code></td><td>Model information and the quality report</td></tr>
<tr><td><code>GET /v1/training</code></td><td>Error and accuracy after every epoch of a training replay</td></tr>
<tr><td><code>GET /v1/dataset</code></td><td>All training phrases</td></tr>
<tr><td><code>GET /v1/storage</code>, <code>GET /v1/network</code></td><td>Sizes of the data and weights; the strongest connections of the model</td></tr>
<tr><td><code>GET /health</code></td><td>Uptime check</td></tr>
</table></div>
<p class="note">The key is needed only for the POST requests and only when the server sets <code>VORONIX_AI_KEY</code>. The site uses <code>/demo/classify</code> and <code>/demo/explain</code>, which need no key. Limit: 120 requests per minute per address.</p>
</section>
</main>
<footer>${live ? "VoroniX AI, part of the VoroniX CRM project. Our own model, trained in your browser from the start phrases and everything it learned at work, saved in this site's database." : "VoroniX AI, part of the VoroniX CRM project. The model is retrained from <code>data/phrases.tsv</code> every time the service starts."}</footer>
</div>
<script>window.NAMES=${JSON.stringify(LABEL_NAMES)};</script>
<script src="/app.js"></script>
</body>
</html>`;
}
