import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LABELS = ["greeting", "price", "booking", "cancel", "complaint", "address", "hours", "confirm", "thanks", "visits", "other"] as const;
export type Label = (typeof LABELS)[number];
export const LANGS = ["ru", "kk", "en"] as const;
export type Lang = (typeof LANGS)[number];

export interface Example {
  text: string;
  lang: Lang;
  labels: Label[];
}

export const DATA_FILE = fileURLToPath(new URL("../data/phrases.tsv", import.meta.url));
/** Phrases made by scripts/generate-phrases.ts from templates (npm run generate). */
export const GENERATED_FILE = fileURLToPath(new URL("../data/generated.tsv", import.meta.url));
/** Phrases the model never trains on, written like real chats, to measure it honestly. */
export const TEST_FILE = fileURLToPath(new URL("../data/test.tsv", import.meta.url));

/** Reads the training phrases. Lines starting with # are comments, the first other line is the header. */
export function loadExamples(file = DATA_FILE): Example[] {
  return parseExamples(readFileSync(file, "utf8"));
}

/** The training data as one TSV text (hand-written phrases, then the generated rows), for the browser builds. */
export function trainingText(): string {
  const gen = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).slice(1) : [];
  return `${readFileSync(DATA_FILE, "utf8").trimEnd()}\n${gen.join("\n")}\n`;
}

/** Everything the model trains on: the hand-written phrases plus the generated ones. */
export function loadTraining(): Example[] {
  return [...loadExamples(DATA_FILE), ...(existsSync(GENERATED_FILE) ? loadExamples(GENERATED_FILE) : [])];
}

export function parseExamples(text: string): Example[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  return rows.slice(1).map((row, i) => {
    const [lang, labels, text] = row.split("\t");
    const ls = labels?.split(",").map((s) => s.trim()) ?? [];
    if (!LANGS.includes(lang as Lang) || !text || !ls.length || ls.some((l) => !LABELS.includes(l as Label)))
      throw new Error(`data line ${i + 2} is not valid: ${row}`);
    return { text: text.trim(), lang: lang as Lang, labels: ls as Label[] };
  });
}

const PLAIN: Record<string, string> = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и" };

/**
 * Extra training copies of Kazakh phrases typed without Kazakh letters
 * ("канша турады" for "қанша тұрады"), as many people type on a Russian keyboard.
 * Used for training only: the model is always tested on the original phrases.
 */
export function augment(examples: Example[]): Example[] {
  const extra = examples
    .filter((e) => e.lang === "kk" && /[әғқңөұүһі]/i.test(e.text))
    .map((e) => ({ ...e, text: e.text.replace(/[әғқңөұүһі]/gi, (ch) => PLAIN[ch.toLowerCase()] ?? ch) }));
  return [...examples, ...extra];
}
