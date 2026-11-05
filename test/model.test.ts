import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { augment, loadExamples } from "../src/data.js";
import { evaluate } from "../src/evaluate.js";
import { features } from "../src/features.js";
import { IntentModel } from "../src/model.js";
import { REPORT_FILE } from "../src/service.js";

const examples = loadExamples();
const model = IntentModel.train(augment(examples));

describe("dataset", () => {
  it("has every intent in every language", () => {
    for (const lang of ["ru", "kk", "en"]) {
      const labels = new Set(examples.filter((e) => e.lang === lang).flatMap((e) => e.labels));
      expect([...labels].sort()).toEqual(["address", "booking", "cancel", "complaint", "confirm", "greeting", "hours", "other", "price", "thanks"]);
      expect(examples.filter((e) => e.lang === lang).length).toBeGreaterThanOrEqual(200);
    }
  });

  it("has no repeated phrases, so a test phrase is never also a training phrase", () => {
    const keys = examples.map((e) => features(e.text).sort().join(" "));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("quality on phrases the model has not seen", () => {
  const report = evaluate(examples);

  it("meets the week 10 target", () => {
    expect(report.cross_validation.exact_match).toBeGreaterThanOrEqual(0.7);
    expect(report.cross_validation.micro_f1).toBeGreaterThanOrEqual(0.75);
    expect(report.cross_validation.language_accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it("the published report (reports/metrics.json) is up to date: run npm run train after changing the data", () => {
    expect(JSON.parse(readFileSync(REPORT_FILE, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

describe("predictions", () => {
  const top = (t: string) => model.predict(t).intents.map((i) => i.label).sort();

  it.each([
    ["Сәлеметсіз бе! Шаш қию қанша тұрады?", ["greeting", "price"], "kk"],
    ["Ертең келе алмаймын", ["cancel"], "kk"],
    ["Здравствуйте, можно записаться на пятницу в 18:00?", ["booking", "greeting"], "ru"],
    ["Where are you located?", ["address"], "en"],
  ])("%s", (text, labels, lang) => {
    expect(top(text)).toEqual(labels);
    expect(model.predict(text).lang).toBe(lang);
  });

  it("always returns at least one intent, even for nonsense", () => {
    expect(model.predict("ыыы 123").intents.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same data gives the same model", () => {
    expect(IntentModel.train(augment(examples)).toJSON()).toEqual(model.toJSON());
  });
});
