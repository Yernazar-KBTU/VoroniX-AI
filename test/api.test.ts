import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAiServer } from "../src/server.js";

const server = createAiServer({ apiKey: "secret", rateLimit: 32 });
let base = "";
const post = (path: string, body: unknown, key?: string) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((ok) => server.close(ok)));

describe("VoroniX AI API", () => {
  it("serves the home page and the model report", async () => {
    const page = await fetch(base + "/");
    expect(await page.text()).toContain("Our own AI that understands salon clients");
    const model = await (await fetch(base + "/v1/model")).json();
    expect(model.name).toBe("voronix-intent");
    expect(model.quality.dataset.phrases).toBeGreaterThan(600);
    expect((await fetch(base + "/health")).status).toBe(200);
  });

  it("classifies one text and a batch with the key", async () => {
    const one = await post("/v1/classify", { text: "Сәлем! Ертеңге жазылуға бола ма?" }, "secret");
    expect(one.status).toBe(200);
    const body = await one.json();
    expect(body.lang).toBe("kk");
    expect(body.intents.map((i: { label: string }) => i.label).sort()).toEqual(["booking", "greeting"]);

    const many = await (await post("/v1/classify", { texts: ["Спасибо!", "I want a refund"] }, "secret")).json();
    expect(many.results.map((r: { intents: { label: string }[] }) => r.intents[0].label)).toEqual(["thanks", "complaint"]);
  });

  it("opens the model up: explanation, training replay, data, storage, network", async () => {
    const ex = await (await post("/demo/explain", { text: "Шаш қию қанша тұрады?" })).json();
    expect(ex.features.length).toBeGreaterThan(10);
    expect(ex.contributions[0]).toHaveLength(10);
    const price = ex.labels.indexOf("price");
    expect(ex.scores[price]).toBeGreaterThan(0.5);
    // The explanation adds up to the same score the classifier gives.
    const z = ex.bias[price] + ex.contributions.reduce((s: number, c: number[]) => s + c[price], 0);
    expect(1 / (1 + Math.exp(-z))).toBeCloseTo(ex.scores[price], 6);

    const tr = await (await fetch(base + "/v1/training")).json();
    expect(tr.epochs).toHaveLength(61);
    expect(tr.epochs[0]).toMatchObject({ epoch: 0, exact_match: 0 });
    expect(tr.epochs[60].exact_match).toBeGreaterThan(0.7);
    expect(tr.epochs[60].loss).toBeLessThan(tr.epochs[1].loss);

    expect((await (await fetch(base + "/v1/dataset")).json()).phrases.length).toBeGreaterThan(600);
    const st = await (await fetch(base + "/v1/storage")).json();
    expect(st.weights.numbers).toBe(13 * st.vocabulary.size + 13);
    const net = await (await fetch(base + "/v1/network?limit=100")).json();
    expect(net.links).toHaveLength(100);
    expect((await fetch(base + "/app.js")).headers.get("content-type")).toMatch(/javascript/);
  });

  it("refuses a missing key, bad input and too many requests", async () => {
    expect((await post("/v1/classify", { text: "hi" })).status).toBe(401);
    expect((await post("/v1/classify", { text: "" }, "secret")).status).toBe(400);
    expect((await post("/v1/classify", { text: "x".repeat(1001) }, "secret")).status).toBe(400);
    expect((await fetch(base + "/v1/classify", { method: "POST", headers: { authorization: "Bearer secret" }, body: "{oops" })).status).toBe(400);
    // The home page's try box needs no key but shares the limit.
    expect((await post("/demo/classify", { text: "Привет" })).status).toBe(200);
    let last = 200;
    for (let i = 0; i < 30; i++) last = (await post("/demo/classify", { text: "Привет" })).status;
    expect(last).toBe(429);
  });
});
