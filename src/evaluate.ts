import { augment, LABELS, LANGS, type Example, type Label } from "./data.js";
import { IntentModel, shuffle, type TrainOptions } from "./model.js";

export interface Metrics {
  examples: number;
  /** Share of messages where the model found exactly the right set of intents. */
  exact_match: number;
  micro: { precision: number; recall: number; f1: number };
  per_label: Record<Label, { precision: number; recall: number; f1: number; support: number }>;
  language_accuracy: number;
  exact_match_by_language: Record<string, number>;
  mistakes: { text: string; expected: string[]; got: string[] }[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const f1 = (p: number, r: number) => (p + r ? (2 * p * r) / (p + r) : 0);

export function score(model: IntentModel, test: Example[]): Metrics {
  const tp: Record<string, number> = {};
  const fp: Record<string, number> = {};
  const fn: Record<string, number> = {};
  for (const l of LABELS) tp[l] = fp[l] = fn[l] = 0;
  let exact = 0;
  let langOk = 0;
  const byLang: Record<string, { n: number; ok: number }> = {};
  const mistakes: Metrics["mistakes"] = [];
  for (const e of test) {
    const p = model.predict(e.text);
    const got = p.intents.map((i) => i.label);
    for (const l of LABELS) {
      const want = e.labels.includes(l);
      const has = got.includes(l);
      if (want && has) tp[l]++;
      else if (has) fp[l]++;
      else if (want) fn[l]++;
    }
    const same = got.length === e.labels.length && got.every((l) => e.labels.includes(l));
    byLang[e.lang] ??= { n: 0, ok: 0 };
    byLang[e.lang].n++;
    if (same) {
      exact++;
      byLang[e.lang].ok++;
    } else mistakes.push({ text: e.text, expected: e.labels, got });
    if (p.lang === e.lang) langOk++;
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const P = sum(tp) / (sum(tp) + sum(fp) || 1);
  const R = sum(tp) / (sum(tp) + sum(fn) || 1);
  const per_label = Object.fromEntries(
    LABELS.map((l) => {
      const p = tp[l] / (tp[l] + fp[l] || 1);
      const r = tp[l] / (tp[l] + fn[l] || 1);
      return [l, { precision: r3(p), recall: r3(r), f1: r3(f1(p, r)), support: tp[l] + fn[l] }];
    }),
  ) as Metrics["per_label"];
  return {
    examples: test.length,
    exact_match: r3(exact / test.length),
    micro: { precision: r3(P), recall: r3(R), f1: r3(f1(P, R)) },
    per_label,
    language_accuracy: r3(langOk / test.length),
    exact_match_by_language: Object.fromEntries(LANGS.filter((l) => byLang[l]).map((l) => [l, r3(byLang[l].ok / byLang[l].n)])),
    mistakes,
  };
}

/** Splits so that every language and every main intent is present in both parts. */
export function folds(examples: Example[], k: number, seed = 42): Example[][] {
  const groups = new Map<string, Example[]>();
  for (const e of examples) {
    const key = `${e.lang}:${e.labels[0]}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Example[][] = Array.from({ length: k }, () => []);
  let i = 0;
  for (const key of [...groups.keys()].sort()) for (const e of shuffle(groups.get(key)!, seed)) out[i++ % k].push(e);
  return out;
}

export interface Report {
  dataset: { phrases: number; by_language: Record<string, number>; by_label: Record<string, number> };
  holdout: Metrics & { train_examples: number };
  cross_validation: { folds: number; exact_match: number; micro_f1: number; language_accuracy: number };
}

/**
 * Honest evaluation: the model is tested only on phrases it never saw.
 * 1) holdout: train on 80 %, test on 20 %;
 * 2) 5-fold cross-validation: every phrase is tested exactly once.
 */
export function evaluate(examples: Example[], opts: TrainOptions = {}): Report {
  const parts = folds(examples, 5);
  const test = parts[0];
  const train = parts.slice(1).flat();
  const holdout = { ...score(IntentModel.train(augment(train), opts), test), train_examples: train.length };

  const cv = parts.map((_, i) => score(IntentModel.train(augment(parts.filter((__, j) => j !== i).flat()), opts), parts[i]));
  const avg = (f: (m: Metrics) => number) => r3(cv.reduce((s, m) => s + f(m) * m.examples, 0) / examples.length);

  const count = (key: (e: Example) => string[]) => examples.flatMap(key).reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  return {
    dataset: { phrases: examples.length, by_language: count((e) => [e.lang]), by_label: count((e) => e.labels) },
    holdout,
    cross_validation: { folds: parts.length, exact_match: avg((m) => m.exact_match), micro_f1: avg((m) => m.micro.f1), language_accuracy: avg((m) => m.language_accuracy) },
  };
}
