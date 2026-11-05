import type { Brain } from "./service.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const LABEL_NAMES: Record<string, string> = {
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

/** The service's home page: try the model, see how good it is, read the API. */
export function page(brain: Brain): string {
  const r = brain.report;
  const rows = Object.entries(r.holdout.per_label)
    .map(([l, m]) => `<tr><td>${esc(LABEL_NAMES[l] ?? l)} <code>${esc(l)}</code></td><td>${m.support}</td><td>${pct(m.precision)}</td><td>${pct(m.recall)}</td><td><b>${pct(m.f1)}</b></td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VoroniX AI</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#14172b;--muted:#5d637e;--line:#e3e6f0;--accent:#5b4bff;--accent2:#00b8a9;--soft:#eeecff}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f1c;--card:#161a2e;--ink:#eef0fb;--muted:#a3a8c3;--line:#272c47;--accent:#8b7dff;--accent2:#2dd4c4;--soft:#211f45}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
header{display:flex;align-items:center;gap:12px;padding:22px 0}
.logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#fff;font-weight:800}
header b{font-size:20px}header span{color:var(--muted);font-size:14px;margin-left:auto}
h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:28px 0 12px}h2{font-size:24px;margin:0 0 14px}
.lead{color:var(--muted);font-size:18px;max-width:720px}
section{margin:34px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
textarea{width:100%;min-height:84px;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;background:var(--bg);color:var(--ink);resize:vertical}
button{border:0;border-radius:12px;background:var(--accent);color:#fff;font:600 15px system-ui;padding:11px 18px;cursor:pointer}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.chip{background:var(--soft);color:var(--ink);font-weight:500;padding:7px 12px;border-radius:999px;font-size:14px}
.bars{margin-top:16px;display:grid;gap:7px}.bar{display:grid;grid-template-columns:170px 1fr 52px;align-items:center;gap:10px;font-size:14px}
.track{height:10px;border-radius:6px;background:var(--line);overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:6px}.on .fill{background:var(--accent2)}.on{font-weight:700}
.result{margin-top:14px;font-size:15px}.tag{display:inline-block;background:var(--accent2);color:#04231f;border-radius:8px;padding:2px 9px;margin:2px;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.stat b{display:block;font-size:30px}.stat span{color:var(--muted);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
.table{overflow-x:auto}code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}code{background:var(--soft);padding:1px 5px;border-radius:5px}
pre{background:#0b0d18;color:#dfe3ff;border-radius:14px;padding:16px;overflow-x:auto}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.steps .card{padding:18px}.steps i{font-style:normal;color:var(--accent);font-weight:800}
.note{color:var(--muted);font-size:14px}footer{color:var(--muted);font-size:14px;padding:30px 0 40px}
</style>
</head>
<body>
<div class="wrap">
<header><div class="logo">V</div><b>VoroniX AI</b><span>model ${esc(brain.info.name)} v${esc(brain.info.version)}</span></header>

<h1>Our own AI that understands salon clients</h1>
<p class="lead">VoroniX AI reads a client's message in Russian, Kazakh or English and tells the CRM what the client wants: book, ask the price, cancel, complain and more. We collected the phrases, trained the model ourselves and serve it through this API. No paid AI services.</p>

<section class="card">
<h2>Try it</h2>
<textarea id="t" maxlength="1000" placeholder="Write like a client would">${esc(EXAMPLES[0])}</textarea>
<div class="chips">${EXAMPLES.map((e) => `<button class="chip" type="button">${esc(e)}</button>`).join("")}</div>
<button id="go" type="button">Understand</button>
<div class="result" id="res"></div><div class="bars" id="bars"></div>
</section>

<section>
<h2>How good it is</h2>
<p class="note">Measured only on phrases the model never saw during training. Holdout: trained on ${r.holdout.train_examples} phrases, tested on ${r.holdout.examples}. Cross-validation: the data is split into ${r.cross_validation.folds} parts and every part is tested once.</p>
<div class="stats">
<div class="stat"><b>${r.dataset.phrases}</b><span>training phrases (${Object.entries(r.dataset.by_language).map(([k, v]) => `${k} ${v}`).join(", ")})</span></div>
<div class="stat"><b>${pct(r.cross_validation.exact_match)}</b><span>messages understood exactly right (cross-validation)</span></div>
<div class="stat"><b>${pct(r.cross_validation.micro_f1)}</b><span>F1 over all intents (cross-validation)</span></div>
<div class="stat"><b>${pct(r.cross_validation.language_accuracy)}</b><span>language detected right</span></div>
</div>
<div class="card table" style="margin-top:12px"><table><tr><th>Intent (holdout)</th><th>Phrases</th><th>Precision</th><th>Recall</th><th>F1</th></tr>${rows}</table></div>
</section>

<section>
<h2>How it works</h2>
<div class="steps">
<div class="card"><i>1. Data.</i> ${r.dataset.phrases} real-style client messages, each marked with what the client wants and the language.</div>
<div class="card"><i>2. Features.</i> Words, word pairs and word pieces of 3 to 5 letters, so Kazakh and Russian endings and typos still match.</div>
<div class="card"><i>3. Model.</i> Logistic regression written from scratch: one classifier per intent (a message can have several) and one for the language.</div>
<div class="card"><i>4. API.</i> The VoroniX CRM sends each client message here. If this service is down, the CRM falls back to its built-in rules.</div>
</div>
</section>

<section>
<h2>API</h2>
<pre>curl -X POST ${"$"}VORONIX_AI_URL/v1/classify \\
  -H "Authorization: Bearer ${"$"}VORONIX_AI_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Сәлем! Ертеңге жазылуға бола ма?"}'</pre>
<pre id="sample"></pre>
<p class="note"><code>POST /v1/classify</code> takes <code>{"text"}</code> or <code>{"texts": [...]}</code> (up to 50). <code>GET /v1/model</code> returns the model and its quality report. <code>GET /health</code> for uptime checks. The key is needed only when the server sets <code>VORONIX_AI_KEY</code>. Limit: ${"120"} requests per minute per address.</p>
</section>

<footer>VoroniX AI, part of the VoroniX CRM project. The model is retrained from <code>data/phrases.tsv</code> every time the service starts.</footer>
</div>
<script>
const NAMES=${JSON.stringify(LABEL_NAMES)};
const t=document.getElementById("t"),res=document.getElementById("res"),bars=document.getElementById("bars");
async function run(){
  res.textContent="…";
  try{
    const r=await fetch("/demo/classify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:t.value})});
    const d=await r.json();
    if(!r.ok){res.textContent=d.error||"Error";bars.innerHTML="";return}
    const lang={ru:"Russian",kk:"Kazakh",en:"English"}[d.lang];
    res.innerHTML="Language: <b>"+lang+"</b> &nbsp; Intent: "+d.intents.map(i=>'<span class="tag">'+NAMES[i.label]+'</span>').join(" ");
    const on=new Set(d.intents.map(i=>i.label));
    bars.innerHTML=Object.entries(d.scores).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<div class="bar'+(on.has(k)?' on':'')+'"><span>'+NAMES[k]+'</span><div class="track"><div class="fill" style="width:'+(v*100).toFixed(1)+'%"></div></div><span>'+(v*100).toFixed(0)+'%</span></div>').join("");
    document.getElementById("sample").textContent=JSON.stringify({model:d.model,text:d.text,intents:d.intents.map(i=>({label:i.label,score:+i.score.toFixed(3)})),lang:d.lang},null,2);
  }catch(e){res.textContent="The service is not reachable."}
}
document.getElementById("go").onclick=run;
document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{t.value=c.textContent;run()});
run();
</script>
</body>
</html>`;
}
