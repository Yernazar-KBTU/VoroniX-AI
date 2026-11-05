# VoroniX AI

Our own small AI model for the VoroniX CRM, with its own API and home page.
It reads a message from a salon client in **Russian, Kazakh or English** and
says what the client wants and which language they write in. The CRM's AI
administrator uses the answer to reply, book, cancel or pass the chat to a human.
No paid AI service is involved.

## What it understands

| Intent | Example |
|---|---|
| `greeting` | Сәлеметсіз бе! |
| `price` | Шаш қию қанша тұрады? |
| `booking` | Можно записаться на пятницу в 18:00? |
| `cancel` | Ертең келе алмаймын |
| `complaint` | You ruined my haircut, I want a refund |
| `address` | Где вы находитесь? |
| `hours` | Сағат нешеге дейін жұмыс істейсіздер? |
| `confirm` | Иә, бірінші нұсқа |
| `thanks` | Рахмет! |
| `other` | Can I bring my dog? |

A message can have several intents: «Здравствуйте! Сколько стоит стрижка? Можно в среду?» is `greeting`, `price` and `booking`.

## How it was made

1. **Data.** [`data/phrases.tsv`](data/phrases.tsv): 638 messages written the way clients write in chats (213 Russian, 220 Kazakh, 205 English), each marked with its intents and language. For training, Kazakh phrases are also copied without Kazakh letters («канша турады»), because many people type on a Russian keyboard.
2. **Features.** Words, pairs of words, the first 4 letters of long words and pieces of words of 3 to 5 letters, so word endings and typos still match ([`src/features.ts`](src/features.ts)).
3. **Model.** Logistic regression written from scratch, with no ML library ([`src/model.ts`](src/model.ts)): one yes/no classifier per intent and one classifier for the language. Training is deterministic.
4. **Measurement.** [`src/evaluate.ts`](src/evaluate.ts) tests the model only on phrases it did not see while training: a holdout split (510 to train, 128 to test) and 5-fold cross-validation. The result is saved to [`reports/metrics.json`](reports/metrics.json).

## Quality (5-fold cross-validation)

| Measure | Result |
|---|---|
| Messages understood exactly right (all intents correct) | 76.4% |
| F1 over all intents | 80.6% |
| Language detected right | 98.0% |

The project's NFR-02 asks for 95%. More phrases are the way there: going from 297 to 638 phrases took exact match from 57% to 76%. Add phrases to `data/phrases.tsv`, then run `npm run train` and commit the new report (a test checks that it is current).

In the CRM the model works together with the old rules: an intent counts when either sees it, so the model adds what the rules miss (for example the Kazakh complaint «Маған мүлдем ұнамады, қызмет нашар») and the CRM keeps working when the service is down.

## API

```
POST /v1/classify   {"text": "..."} or {"texts": ["...", ...]} (up to 50, 1000 characters each)
POST /v1/explain    the features of a text and how each one voted for each intent
GET  /v1/model      model information and the quality report
GET  /v1/training   error and accuracy after every epoch of a training replay
GET  /v1/dataset    all training phrases
GET  /v1/storage    sizes of the data file, vocabulary and weights
GET  /v1/network    the strongest connections of the model
GET  /health        uptime check
GET  /              the site (tabs: Try it, Inside the model, Training, Data & storage, API)
```

```bash
curl -X POST http://localhost:4000/v1/classify \
  -H "Content-Type: application/json" \
  -d '{"text": "Сәлем! Ертеңге жазылуға бола ма?"}'
```

```json
{ "model": "voronix-intent", "text": "Сәлем! Ертеңге жазылуға бола ма?",
  "intents": [{ "label": "booking", "score": 0.997 }, { "label": "greeting", "score": 0.947 }],
  "lang": "kk", "scores": { "...": 0.0 }, "lang_scores": { "ru": 0.0, "kk": 1.0, "en": 0.0 } }
```

When `VORONIX_AI_KEY` is set, `/v1/classify` and `/v1/explain` need `Authorization: Bearer <key>`. The site uses `/demo/classify` and `/demo/explain`, which need no key. Every address may send 120 requests a minute.

## The site

- **Try it**: write a message, see the intents and the language. On top, the 900 strongest real weights of the model drawn as a network.
- **Inside the model**: the message cut into features, every feature voting for or against every intent (line thickness = weight), and the arithmetic: start value + votes = z, sigmoid(z) = score.
- **Training**: a replay of a real training run (80 % of the phrases to learn, 20 % to check) from epoch 0, when the model knows nothing, to epoch 60; settings; every training phrase with filters.
- **Data & storage**: what is kept where: the phrases file in git, weights only in memory, API messages not stored.

## The live site: VoroniX AI at work

`npm run build:demo` builds one HTML page (`dist-demo/index.html`) where the AI
works and learns in the browser, with its data in a database
(`src/live/`, about 2,800 lines). Published copy: https://claude.ai/artifact/WBotxYRsPFsCg7mkdjY1GK

- **Live**: a social inbox (Instagram, Telegram, WhatsApp). Write as a client or play the demo stream (28 clients, 56 messages with words the AI has never seen). For every message: what it understood, its reply, what it did in the CRM and what it learned. A chart compares the learning AI with the same model frozen, measured before each lesson (test-then-train).
- **CRM**: the calendar the AI books into, every client's memory card (language, services, masters, times, mood, last 14 messages) and staff commands in plain words: «Запиши Алию на завтра в 15:00 на стрижку», «Cancel Bekzat's booking», «Кто не приходил 30 дней?». Writes wait for a confirm click.
- **Training**: the review queue the AI fills itself (unsure readings, questions without an answer, complaints), teaching by hand, model versions and the learning log.
- **Knowledge**: texts and files from the business, found with BM25. A person's answer from the queue becomes knowledge at once.
- **Data & storage**: the 8 collections, their size, the newest documents as saved, export to one JSON file.

How it learns:

1. A phrase is learned when the conversation proves it (a booking confirms the request, «спасибо» confirms the answer), when a person checks the queue, or when the business adds a service (the AI writes 6 phrases about it in three languages).
2. Online learning: up to 8 small gradient steps until the phrase is read right, each mixed with 4 older phrases so it does not forget (rehearsal).
3. Every 50 new phrases (25 and 100 can be chosen) the model is retrained. The old data and the new data are both trained without a fifth kept aside and tested on it; the new version goes live only if it is not worse (one test phrase less counts as equal).
4. The model is not stored. Every page rebuilds it from the saved phrases: the live version, then the later phrases in the order they were learned, each step using only what was known then, so every page runs exactly the same weights (tested).

Storage sits behind one small interface, `Store` in `src/live/store.ts` (read all, save, change, delete, watch): `SiteStore` uses the site's database, `MemoryStore` runs the tests. A server database is one more class with the same five methods.

```bash
npm run build:demo                      # dist-demo/index.html
node scripts/e2e-demo.cjs <screenshots> # the whole site in Chromium, with a stand-in database
```

Limits: the inbox is simulated until the CRM server forwards real messages; the AI runs while the page is open; it answers about the salon from its data and knowledge, and sends any other question to a person.

## Run

```bash
npm run dev:ai        # from the repository root, http://localhost:4000
npm run train         # measure on unseen phrases and update reports/metrics.json
npm test -w apps/voronix-ai
```

The service trains the model from `data/phrases.tsv` when it starts (about a second). In the CRM set `VORONIX_AI_URL=http://localhost:4000` (and `VORONIX_AI_KEY` if the service has one). On Render, `render.yaml` creates it as the second web service `voronix-ai`.
