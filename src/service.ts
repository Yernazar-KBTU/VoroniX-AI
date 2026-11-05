import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { augment, LABELS, LANGS, loadExamples } from "./data.js";
import { evaluate, type Report } from "./evaluate.js";
import { IntentModel, type Prediction } from "./model.js";

export const REPORT_FILE = fileURLToPath(new URL("../reports/metrics.json", import.meta.url));

export interface Brain {
  model: IntentModel;
  report: Report;
  info: { name: string; version: string; trained_at: string; phrases: number; features: number; labels: readonly string[]; languages: readonly string[] };
  classify(text: string): Prediction & { text: string };
}

/** Trains the model from the phrases file. The quality report comes from `npm run train`, or is computed here when it is missing. */
export function loadBrain(): Brain {
  const examples = loadExamples();
  const model = IntentModel.train(augment(examples));
  let report: Report;
  try {
    report = JSON.parse(readFileSync(REPORT_FILE, "utf8"));
  } catch {
    report = evaluate(examples);
  }
  return {
    model,
    report,
    info: {
      name: "voronix-intent",
      version: "1.0",
      trained_at: new Date().toISOString(),
      phrases: examples.length,
      features: model.vocabularySize,
      labels: LABELS,
      languages: LANGS,
    },
    classify: (text) => ({ text, ...model.predict(text) }),
  };
}
