// npm run train: evaluates the model on phrases it has not seen, then trains
// the final model on all phrases and saves both the model and the report.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { augment, loadExamples } from "./data.js";
import { evaluate } from "./evaluate.js";
import { IntentModel } from "./model.js";

const examples = loadExamples();
const report = evaluate(examples);
const model = IntentModel.train(augment(examples));
const dir = fileURLToPath(new URL("../reports/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}metrics.json`, JSON.stringify(report, null, 2) + "\n");
// The model itself is not saved: the service trains it from data/phrases.tsv in about a second at start.

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
console.log(`Phrases: ${report.dataset.phrases} (${Object.entries(report.dataset.by_language).map(([k, v]) => `${k} ${v}`).join(", ")})`);
console.log(`Holdout (train ${report.holdout.train_examples}, test ${report.holdout.examples}): exact match ${pct(report.holdout.exact_match)}, F1 ${pct(report.holdout.micro.f1)}, language ${pct(report.holdout.language_accuracy)}`);
console.log(`5-fold cross-validation: exact match ${pct(report.cross_validation.exact_match)}, F1 ${pct(report.cross_validation.micro_f1)}, language ${pct(report.cross_validation.language_accuracy)}`);
console.log(`Vocabulary: ${model.vocabularySize} features. Mistakes on the holdout:`);
for (const m of report.holdout.mistakes) console.log(`  "${m.text}" expected ${m.expected.join(",")} got ${m.got.join(",")}`);
