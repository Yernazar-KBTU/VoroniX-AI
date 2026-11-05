import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAiServer } from "../src/server.js";

const server = createAiServer({ apiKey: "secret", rateLimit: 30 });
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
