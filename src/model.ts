import { LABELS, LANGS, type Example, type Label, type Lang } from "./data.js";
import { features } from "./features.js";

// Logistic regression, written by hand so the whole model is visible:
// - intents: one yes/no classifier per label, because one message can carry
//   several intents ("Hello! How much is a haircut?");
// - language: one classifier over the three languages (softmax).
// Training is deterministic: the same data always gives the same model.

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  seed?: number;
  positiveWeight?: number;
  /** Called after every pass over the data, with the average error and the model as it is now. */
  onEpoch?: (epoch: number, loss: number, model: IntentModel) => void;
}

/** How each word piece of a message pushed each intent up or down. */
export interface Explanation {
  features: { feature: string; kind: "word" | "pair" | "start" | "piece"; known: boolean }[];
  /** contributions[i][j]: effect of feature i on intent j (positive = for, negative = against). */
  contributions: number[][];
  bias: number[];
  scores: number[];
  unknown: number;
}

export interface Prediction {
  intents: { label: Label; score: number }[];
  scores: Record<Label, number>;
  lang: Lang;
  lang_scores: Record<Lang, number>;
}

/** One message through the model, step by step (see IntentModel.forward). */
export interface Forward {
  /** Every feature of the message in order; index is null for a feature the model has never seen. */
  features: { f: string; index: number | null }[];
  /** 1 / √(number of known features): every vote is scaled by it. */
  scale: number;
  /** Per intent (in LABELS order): start value, the vote of every known feature, the sum z and sigmoid(z). */
  intent: { bias: number[]; contrib: number[][]; z: number[]; score: number[] };
  /** Per language (in LANGS order): the same, with softmax instead of sigmoid. */
  lang: { bias: number[]; contrib: number[][]; z: number[]; p: number[] };
}

export interface ModelJson {
  version: string;
  vocab: string[];
  intent: { w: number[][]; b: number[] };
  lang: { w: number[][]; b: number[] };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Small seeded random generator, so shuffles repeat exactly. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class IntentModel {
  private index: Map<string, number>;

  constructor(private readonly json: ModelJson) {
    this.index = new Map(json.vocab.map((f, i) => [f, i]));
  }

  static train(examples: Example[], opts: TrainOptions = {}): IntentModel {
    const run = IntentModel.trainer(examples, opts);
    for (;;) {
      const r = run.next();
      if (r.done) return r.value;
    }
  }

  /** The same training as train(), but it waits a moment after every epoch, so a page stays responsive and can draw the progress. */
  static async trainAsync(examples: Example[], opts: TrainOptions = {}): Promise<IntentModel> {
    const run = IntentModel.trainer(examples, opts);
    for (;;) {
      const r = run.next();
      if (r.done) return r.value;
      await new Promise((ok) => setTimeout(ok, 0));
    }
  }

  /** Training, one epoch per step: yields after every pass over the data and returns the finished model. */
  static *trainer(examples: Example[], opts: TrainOptions = {}): Generator<{ epoch: number; loss: number }, IntentModel> {
    const { epochs = 60, learningRate = 1, l2 = 1e-4, seed = 7, positiveWeight = 4, onEpoch } = opts;
    const vocab = [...new Set(examples.flatMap((e) => features(e.text)))].sort();
    const index = new Map(vocab.map((f, i) => [f, i]));
    const rows = examples.map((e) => ({ x: features(e.text).map((f) => index.get(f)!), e }));
    const w: Weights = {
      iw: Array.from({ length: LABELS.length }, () => new Array<number>(vocab.length).fill(0)),
      ib: new Array<number>(LABELS.length).fill(0),
      lw: Array.from({ length: LANGS.length }, () => new Array<number>(vocab.length).fill(0)),
      lb: new Array<number>(LANGS.length).fill(0),
    };
    for (let epoch = 0; epoch < epochs; epoch++) {
      const lr = learningRate / (1 + epoch * 0.05);
      let loss = 0;
      for (const { x, e } of shuffle(rows, seed + epoch)) loss += step(w, x, e, lr, l2, positiveWeight);
      loss /= rows.length * LABELS.length;
      onEpoch?.(epoch + 1, loss, new IntentModel({ version: "1", vocab, intent: { w: w.iw, b: w.ib }, lang: { w: w.lw, b: w.lb } }));
      yield { epoch: epoch + 1, loss };
    }
    const round = (v: number[]) => v.map((n) => Math.round(n * 1e5) / 1e5);
    return new IntentModel({ version: "1", vocab, intent: { w: w.iw.map(round), b: round(w.ib) }, lang: { w: w.lw.map(round), b: round(w.lb) } });
  }

  /**
   * Online learning: the model learns new phrases right away, with the same
   * gradient step as in train(). Words it has never seen join the vocabulary
   * with zero weights first. Returns how many features were new.
   */
  learn(examples: Example[], opts: { learningRate?: number; l2?: number; positiveWeight?: number } = {}): number {
    const { learningRate = 0.5, l2 = 1e-4, positiveWeight = 4 } = opts;
    const j = this.json;
    let added = 0;
    for (const e of examples)
      for (const f of features(e.text))
        if (!this.index.has(f)) {
          this.index.set(f, j.vocab.length);
          j.vocab.push(f);
          for (const row of j.intent.w) row.push(0);
          for (const row of j.lang.w) row.push(0);
          added++;
        }
    const w: Weights = { iw: j.intent.w, ib: j.intent.b, lw: j.lang.w, lb: j.lang.b };
    for (const e of examples) step(w, features(e.text).map((f) => this.index.get(f)!), e, learningRate, l2, positiveWeight);
    return added;
  }

  /** The weight that links a feature to an intent (0 for a feature the model does not know). */
  weight(feature: string, label: Label): number {
    const i = this.index.get(feature);
    return i === undefined ? 0 : this.json.intent.w[LABELS.indexOf(label)][i];
  }

  /**
   * Everything the model computes for one message, step by step, with the
   * same arithmetic as predict(): the features, every weight × scale that
   * reaches every intent and language, the sums and the final scores.
   */
  forward(text: string): Forward {
    const feats = features(text).map((f) => ({ f, index: this.index.get(f) ?? null }));
    const known = feats.flatMap((x) => (x.index === null ? [] : [x.index]));
    const scale = known.length ? 1 / Math.sqrt(known.length) : 0;
    const head = (w: number[][], b: number[]) => {
      const contrib = w.map((row) => known.map((i) => row[i] * scale));
      return { bias: [...b], contrib, z: b.map((bias, k) => contrib[k].reduce((s, c) => s + c, bias)) };
    };
    const intent = head(this.json.intent.w, this.json.intent.b);
    const lang = head(this.json.lang.w, this.json.lang.b);
    return { features: feats, scale, intent: { ...intent, score: intent.z.map(sigmoid) }, lang: { ...lang, p: softmax(lang.z) } };
  }

  /** An independent copy, so one model can learn while the other stays as it was. */
  clone(): IntentModel {
    return new IntentModel(JSON.parse(JSON.stringify(this.json)) as ModelJson);
  }

  toJSON(): ModelJson {
    return this.json;
  }

  get vocabularySize(): number {
    return this.json.vocab.length;
  }

  /** Opens the model up for one message: which features it found and how each one voted. */
  explain(text: string): Explanation {
    const all = features(text);
    const known = all.filter((f) => this.index.has(f));
    const scale = known.length ? 1 / Math.sqrt(known.length) : 0;
    const kind = (f: string) => (f.startsWith("w:") ? "word" : f.startsWith("b:") ? "pair" : f.startsWith("p:") ? "start" : "piece") as Explanation["features"][number]["kind"];
    const contributions = known.map((f) => LABELS.map((_, l) => this.json.intent.w[l][this.index.get(f)!] * scale));
    const bias = [...this.json.intent.b];
    const scores = LABELS.map((_, l) => sigmoid(bias[l] + contributions.reduce((s, c) => s + c[l], 0)));
    return { features: known.map((f) => ({ feature: f.replace(/^[wbpc]:/, ""), kind: kind(f), known: true })), contributions, bias, scores, unknown: all.length - known.length };
  }

  /** Size of what the model keeps in memory. */
  get weightCount(): number {
    return (this.json.intent.w.length + this.json.lang.w.length) * this.json.vocab.length + this.json.intent.b.length + this.json.lang.b.length;
  }

  predict(text: string, threshold = 0.5): Prediction {
    const x = features(text)
      .map((f) => this.index.get(f))
      .filter((i): i is number => i !== undefined);
    const scale = x.length ? 1 / Math.sqrt(x.length) : 0;
    const scores = {} as Record<Label, number>;
    LABELS.forEach((label, l) => {
      let z = this.json.intent.b[l];
      for (const f of x) z += this.json.intent.w[l][f] * scale;
      scores[label] = sigmoid(z);
    });
    let intents = LABELS.filter((l) => scores[l] >= threshold).map((label) => ({ label, score: scores[label] }));
    if (intents.length > 1) intents = intents.filter((i) => i.label !== "other");
    if (!intents.length) {
      const best = LABELS.reduce((a, b) => (scores[b] > scores[a] ? b : a));
      intents = [{ label: scores[best] >= 0.3 ? best : "other", score: scores[best] >= 0.3 ? scores[best] : scores.other }];
    }
    intents.sort((a, b) => b.score - a.score);

    const p = softmax(LANGS.map((_, k) => x.reduce((s, f) => s + this.json.lang.w[k][f] * scale, this.json.lang.b[k])));
    const lang_scores = Object.fromEntries(LANGS.map((l, k) => [l, p[k]])) as Record<Lang, number>;
    // Kazakh-only letters settle the language when the model is unsure.
    let lang = LANGS[p.indexOf(Math.max(...p))];
    if (/[әғқңөұүһі]/i.test(text)) lang = "kk";
    return { intents, scores, lang, lang_scores };
  }
}

interface Weights {
  iw: number[][];
  ib: number[];
  lw: number[][];
  lb: number[];
}

/** One gradient step on one phrase (x = its feature numbers). Returns the phrase's error before the step. */
function step(w: Weights, x: number[], e: Example, lr: number, l2: number, positiveWeight: number): number {
  const scale = 1 / Math.sqrt(x.length);
  let loss = 0;
  // Intents: gradient of the log loss for every label.
  for (let l = 0; l < LABELS.length; l++) {
    let z = w.ib[l];
    for (const f of x) z += w.iw[l][f] * scale;
    const yes = e.labels.includes(LABELS[l]);
    const p = Math.min(Math.max(sigmoid(z), 1e-9), 1 - 1e-9);
    loss -= yes ? Math.log(p) : Math.log(1 - p);
    // Each label is rare (about one phrase in ten), so its positive examples weigh more.
    const g = (sigmoid(z) - (yes ? 1 : 0)) * (yes ? positiveWeight : 1);
    w.ib[l] -= lr * g;
    for (const f of x) w.iw[l][f] -= lr * (g * scale + l2 * w.iw[l][f]);
  }
  // Language: softmax over ru, kk, en.
  const z = LANGS.map((_, k) => x.reduce((s, f) => s + w.lw[k][f] * scale, w.lb[k]));
  const p = softmax(z);
  for (let k = 0; k < LANGS.length; k++) {
    const g = p[k] - (LANGS[k] === e.lang ? 1 : 0);
    w.lb[k] -= lr * g;
    for (const f of x) w.lw[k][f] -= lr * (g * scale + l2 * w.lw[k][f]);
  }
  return loss;
}

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
