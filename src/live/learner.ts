// Learning while working.
// 1. Every confirmed phrase is learned right away (online learning): a few
//    small gradient steps until the model gets this phrase right, mixed with
//    a few old phrases so it does not forget them (rehearsal).
// 2. Before learning, the model's guess is compared with the right answer.
//    Over a stream of messages this is the honest "accuracy in real work"
//    (test-then-train), measured next to a frozen copy that never learns.
// 3. Every N new phrases the whole model is retrained. The new version goes
//    live only if it is not worse than the old one on phrases kept aside.
// The model is rebuilt the same way on every page from the saved phrases,
// so everyone who opens the site sees the same model.
import { augment, LABELS, type Example, type Label } from "../data.js";
import { folds, score } from "../evaluate.js";
import { features } from "../features.js";
import { IntentModel, rng, type Prediction } from "../model.js";
import type { Metrics, Phrase, Version } from "./types.js";

export const SETTINGS = { epochs: 60, learningRate: 1, l2: 1e-4, seed: 7, positiveWeight: 4 };
export const RETRAIN_EVERY = 50;

export interface LearnResult {
  phrase: Phrase;
  before: Prediction;
  after: Record<Label, number>;
  /** Was the model already right before learning this phrase? */
  correct: boolean;
  frozenCorrect: boolean;
  steps: number;
  newFeatures: number;
  /** The weights that moved the most: word -> intent, by how much. */
  changes: { feature: string; label: Label; from: number; to: number }[];
}

export interface RetrainResult {
  version: Version;
  accepted: boolean;
  model: IntentModel | null;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const metricsOf = (m: ReturnType<typeof score>): Metrics => ({ exact: m.exact_match, f1: m.micro.f1, lang: m.language_accuracy });
const byTime = (a: Phrase, b: Phrase) => a.at - b.at || a.id.localeCompare(b.id);

/** True when the phrase's predicted intents are exactly its labels. */
export const isRight = (p: Prediction, labels: readonly Label[]) => sameSet(p.intents.map((i) => i.label), labels);

export class Learner {
  model: IntentModel;
  /** The model as it was before it learned anything at work, for comparison. */
  readonly frozen: IntentModel;
  phrases: Phrase[] = [];
  versions: Version[] = [];
  private known = new Set<string>();

  constructor(
    readonly seed: Example[],
    frozen?: IntentModel,
  ) {
    this.frozen = frozen ?? IntentModel.train(augment(seed), SETTINGS);
    this.model = this.frozen.clone();
  }

  get live(): Version | null {
    return [...this.versions].reverse().find((v) => v.status === "live") ?? null;
  }

  /** Phrases learned since the last retrain (kept or not), so a rejected version does not start a retrain on every message. */
  get pending(): number {
    const upto = this.versions.at(-1)?.upto ?? 0;
    return this.phrases.filter((p) => p.at > upto).length;
  }

  has(id: string): boolean {
    return this.known.has(id);
  }

  /** Rebuilds the model from saved data: the live version, then every phrase learned after it, in order. */
  async load(phrases: Phrase[], versions: Version[]): Promise<void> {
    this.phrases = [...phrases].sort(byTime);
    this.known = new Set(this.phrases.map((p) => p.id));
    this.versions = [...versions].sort((a, b) => a.n - b.n);
    const live = this.live;
    this.model = live ? await IntentModel.trainAsync(augment(this.dataset(live.upto)), SETTINGS) : this.frozen.clone();
    for (const p of this.phrases) if (p.at > (live?.upto ?? 0)) this.step(p);
  }

  /** Start phrases plus learned phrases up to a moment. */
  dataset(upto = Infinity): Example[] {
    return [...this.seed, ...this.phrases.filter((p) => p.at <= upto).map(({ text, lang, labels }) => ({ text, lang, labels }))];
  }

  /** Learns one phrase now. Returns what the model thought before and what changed. */
  learn(p: Phrase): LearnResult {
    const before = this.model.predict(p.text);
    const correct = isRight(before, p.labels);
    const frozenCorrect = isRight(this.frozen.predict(p.text), p.labels);
    const feats = features(p.text);
    const watch = feats.flatMap((f) => LABELS.map((l) => ({ f, l, w: this.model.weight(f, l) })));
    this.phrases.push(p);
    this.phrases.sort(byTime);
    this.known.add(p.id);
    const { steps, added } = this.step(p);
    const changes = watch
      .map(({ f, l, w }) => ({ feature: f.replace(/^[wbpc]:/, ""), label: l, from: w, to: this.model.weight(f, l) }))
      .filter((c) => Math.abs(c.to - c.from) > 1e-6)
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
      .slice(0, 8);
    return { phrase: p, before, after: this.model.predict(p.text).scores, correct, frozenCorrect, steps, newFeatures: added, changes };
  }

  /**
   * Small steps on the phrase (and its copy without Kazakh letters) until the
   * model gets it right, at most 8. The old phrases mixed in come only from
   * what was known when this phrase was learned, so a page that rebuilds the
   * model later gets exactly the same weights.
   */
  private step(p: Phrase): { steps: number; added: number } {
    const own: Example[] = augment([{ text: p.text, lang: p.lang, labels: p.labels }]);
    const known = this.phrases.slice(0, this.phrases.indexOf(p) + 1);
    const pool: Example[] = [...this.seed, ...known.map(({ text, lang, labels }) => ({ text, lang, labels }))];
    const r = rng(hash(p.id));
    let added = 0;
    let steps = 0;
    while (steps < 8) {
      const old = Array.from({ length: 4 }, () => pool[Math.floor(r() * pool.length)]);
      added += this.model.learn([...own, ...old], { learningRate: 0.5 });
      steps++;
      if (steps >= 2 && isRight(this.model.predict(p.text), p.labels)) break;
    }
    this.known.add(p.id);
    return { steps, added };
  }

  /**
   * Retrains on everything and decides whether the new version goes live.
   * Phrases kept aside (a fifth of the start phrases and of the learned ones)
   * are used only for the comparison: the old data and the new data are both
   * trained without them and tested on them.
   */
  async retrain(trigger: string, onProgress?: (stage: string, epoch: number, loss: number) => void): Promise<RetrainResult> {
    const t0 = Date.now();
    const upto = this.phrases.at(-1)?.at ?? 0;
    const asideSeed = new Set(folds(this.seed, 5)[0]);
    const aside = (p: Phrase) => hash(p.id) % 5 === 0;
    const test: Example[] = [...asideSeed, ...this.phrases.filter(aside)];
    const trainOn = (until: number) => [...this.seed.filter((e) => !asideSeed.has(e)), ...this.phrases.filter((p) => p.at <= until && !aside(p))];
    const progress = (stage: string) => ({ ...SETTINGS, onEpoch: (e: number, loss: number) => onProgress?.(stage, e, loss) });
    const live = this.live;
    const oldModel = await IntentModel.trainAsync(augment(trainOn(live?.upto ?? 0)), progress("old"));
    const newModel = await IntentModel.trainAsync(augment(trainOn(upto)), progress("new"));
    const prev = metricsOf(score(oldModel, test));
    const metrics = metricsOf(score(newModel, test));
    // "Not worse": one test phrase less still counts as equal, that much is chance.
    const accepted = metrics.exact >= prev.exact - Math.max(0.005, 1 / test.length) - 1e-9;
    const n = (this.versions.at(-1)?.n ?? 0) + 1;
    let model: IntentModel | null = null;
    if (accepted) model = await IntentModel.trainAsync(augment(this.dataset(upto)), progress("final"));
    const version: Version = {
      id: `v${String(n).padStart(4, "0")}`,
      n,
      at: Date.now(),
      upto,
      phrases: this.phrases.filter((p) => p.at <= upto).length,
      metrics,
      prev,
      status: accepted ? "live" : "rejected",
      trigger,
      ms: Date.now() - t0,
      holdout: test.length,
    };
    return { version, accepted, model };
  }

  /** Puts a finished retrain into use (here or when another page made it). */
  async apply(version: Version, model?: IntentModel | null): Promise<void> {
    if (this.versions.some((v) => v.id === version.id)) return;
    if (version.status === "live") for (const v of this.versions) if (v.status === "live") v.status = "old";
    this.versions.push(version);
    this.versions.sort((a, b) => a.n - b.n);
    if (version.status !== "live") return;
    this.model = model ?? (await IntentModel.trainAsync(augment(this.dataset(version.upto)), SETTINGS));
    for (const p of this.phrases) if (p.at > version.upto) this.step(p);
  }
}
