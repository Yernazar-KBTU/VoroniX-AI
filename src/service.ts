import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { augment, DATA_FILE, LABELS, LANGS, loadExamples, type Example } from "./data.js";
import { evaluate, folds, score, type Report } from "./evaluate.js";
import { IntentModel, type Explanation, type Prediction, type TrainOptions } from "./model.js";

export const REPORT_FILE = fileURLToPath(new URL("../reports/metrics.json", import.meta.url));

/** The settings the served model is trained with (the defaults of IntentModel.train). */
export const SETTINGS: Required<Omit<TrainOptions, "onEpoch">> = { epochs: 60, learningRate: 1, l2: 1e-4, seed: 7, positiveWeight: 4 };

/** A phrase whose intent scores are recorded after every epoch, to watch the model learn. */
export const WATCH_TEXT = "Сәлеметсіз бе! Шаш қию қанша тұрады?";

export interface Training {
  settings: typeof SETTINGS;
  split: { train: number; test: number };
  epochs: { epoch: number; loss: number; exact_match: number; f1: number }[];
  watch: { text: string; labels: readonly string[]; scores: number[][] };
}

export interface Brain {
  model: IntentModel;
  report: Report;
  examples: Example[];
  info: { name: string; version: string; trained_at: string; phrases: number; features: number; labels: readonly string[]; languages: readonly string[] };
  classify(text: string): Prediction & { text: string };
  explain(text: string): Explanation & { text: string; labels: readonly string[]; lang: string };
  /** Replays training on 80 % of the phrases and measures the other 20 % after every epoch. Computed once, on first use. */
  training(): Training;
  storage(): Record<string, unknown>;
  /** The strongest connections of the whole model, for the picture of the network. */
  network(limit?: number): { labels: readonly string[]; features: string[]; links: [number, number, number][] };
}

export function loadBrain(): Brain {
  const examples = loadExamples();
  const model = IntentModel.train(augment(examples));
  let report: Report;
  try {
    report = JSON.parse(readFileSync(REPORT_FILE, "utf8"));
  } catch {
    report = evaluate(examples);
  }
  let training: Training | null = null;
  const trainedAt = new Date().toISOString();
  return {
    model,
    report,
    examples,
    info: { name: "voronix-intent", version: "1.0", trained_at: trainedAt, phrases: examples.length, features: model.vocabularySize, labels: LABELS, languages: LANGS },
    classify: (text) => ({ text, ...model.predict(text) }),
    explain: (text) => ({ text, labels: LABELS, lang: model.predict(text).lang, ...model.explain(text) }),
    training() {
      if (training) return training;
      const parts = folds(examples, 5);
      const test = parts[0];
      const train = parts.slice(1).flat();
      const epochs: Training["epochs"] = [];
      const watch: number[][] = [];
      const record = (epoch: number, loss: number, m: IntentModel) => {
        const s = score(m, test);
        epochs.push({ epoch, loss: round(loss), exact_match: s.exact_match, f1: s.micro.f1 });
        const p = m.predict(WATCH_TEXT).scores;
        watch.push(LABELS.map((l) => round(p[l])));
      };
      // Epoch 0: all weights are zero, every intent gets 50 %, the model knows nothing yet.
      record(0, Math.log(2), IntentModel.train(augment(train), { ...SETTINGS, epochs: 0 }));
      IntentModel.train(augment(train), {
        ...SETTINGS,
        onEpoch(epoch, loss, m) {
          record(epoch, loss, m);
        },
      });
      training = { settings: SETTINGS, split: { train: train.length, test: test.length }, epochs, watch: { text: WATCH_TEXT, labels: LABELS, scores: watch } };
      return training;
    },
    network(limit = 900) {
      const json = model.toJSON();
      const all: { f: number; l: number; w: number }[] = [];
      json.intent.w.forEach((row, l) => row.forEach((w, f) => Math.abs(w) > 0.3 && all.push({ f, l, w })));
      const top = all.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, Math.min(limit, 3000));
      // Features are ordered by the intent they support most, so bundles form in the picture.
      const used = [...new Set(top.map((x) => x.f))];
      const home = new Map(used.map((f) => [f, top.filter((x) => x.f === f).sort((a, b) => b.w - a.w)[0].l]));
      used.sort((a, b) => home.get(a)! - home.get(b)! || a - b);
      const pos = new Map(used.map((f, i) => [f, i]));
      return { labels: LABELS, features: used.map((f) => json.vocab[f].replace(/^[wbpc]:/, "")), links: top.map((x) => [pos.get(x.f)!, x.l, round(x.w)] as [number, number, number]) };
    },
    storage() {
      const json = model.toJSON();
      const kinds = { word: 0, pair: 0, start: 0, piece: 0, other: 0 };
      for (const f of json.vocab) kinds[f.startsWith("w:") ? "word" : f.startsWith("b:") ? "pair" : f.startsWith("p:") ? "start" : f.startsWith("c:") ? "piece" : "other"]++;
      // The words that push "price" up the most, to show what one row of weights looks like.
      const price = LABELS.indexOf("price");
      const top = json.vocab
        .map((f, i) => ({ feature: f, weight: json.intent.w[price][i] }))
        .filter((x) => x.feature.startsWith("w:"))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 12)
        .map((x) => ({ feature: x.feature.slice(2), weight: round(x.weight) }));
      return {
        data_file: { name: "data/phrases.tsv", bytes: statSync(DATA_FILE).size, phrases: examples.length, columns: ["lang", "labels", "text"], sample: readFileSync(DATA_FILE, "utf8").split("\n").filter((l) => /^(ru|kk|en)\t/.test(l)).filter((_, i) => i % 211 === 5).slice(0, 3) },
        training_copies: augment(examples).length - examples.length,
        vocabulary: { size: json.vocab.length, ...kinds },
        weights: { intent_rows: json.intent.w.length, language_rows: json.lang.w.length, numbers: model.weightCount, megabytes_in_memory: round((model.weightCount * 8) / 1e6) },
        top_price_words: top,
        trained_at: trainedAt,
      };
    },
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
