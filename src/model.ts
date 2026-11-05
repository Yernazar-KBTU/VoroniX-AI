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
}

export interface Prediction {
  intents: { label: Label; score: number }[];
  scores: Record<Label, number>;
  lang: Lang;
  lang_scores: Record<Lang, number>;
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
    const { epochs = 60, learningRate = 1, l2 = 1e-4, seed = 7, positiveWeight = 4 } = opts;
    const vocab = [...new Set(examples.flatMap((e) => features(e.text)))].sort();
    const index = new Map(vocab.map((f, i) => [f, i]));
    const rows = examples.map((e) => ({ x: features(e.text).map((f) => index.get(f)!), e }));
    const L = LABELS.length;
    const K = LANGS.length;
    const iw = Array.from({ length: L }, () => new Array<number>(vocab.length).fill(0));
    const ib = new Array<number>(L).fill(0);
    const lw = Array.from({ length: K }, () => new Array<number>(vocab.length).fill(0));
    const lb = new Array<number>(K).fill(0);

    for (let epoch = 0; epoch < epochs; epoch++) {
      const lr = learningRate / (1 + epoch * 0.05);
      for (const { x, e } of shuffle(rows, seed + epoch)) {
        const scale = 1 / Math.sqrt(x.length);
        // Intents: gradient of the log loss for every label.
        for (let l = 0; l < L; l++) {
          let z = ib[l];
          for (const f of x) z += iw[l][f] * scale;
          const yes = e.labels.includes(LABELS[l]);
          // Each label is rare (about one phrase in ten), so its positive examples weigh more.
          const g = (sigmoid(z) - (yes ? 1 : 0)) * (yes ? positiveWeight : 1);
          ib[l] -= lr * g;
          for (const f of x) iw[l][f] -= lr * (g * scale + l2 * iw[l][f]);
        }
        // Language: softmax over ru, kk, en.
        const z = LANGS.map((_, k) => x.reduce((s, f) => s + lw[k][f] * scale, lb[k]));
        const p = softmax(z);
        for (let k = 0; k < K; k++) {
          const g = p[k] - (LANGS[k] === e.lang ? 1 : 0);
          lb[k] -= lr * g;
          for (const f of x) lw[k][f] -= lr * (g * scale + l2 * lw[k][f]);
        }
      }
    }
    const round = (v: number[]) => v.map((n) => Math.round(n * 1e5) / 1e5);
    return new IntentModel({ version: "1", vocab, intent: { w: iw.map(round), b: round(ib) }, lang: { w: lw.map(round), b: round(lb) } });
  }

  toJSON(): ModelJson {
    return this.json;
  }

  get vocabularySize(): number {
    return this.json.vocab.length;
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

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
