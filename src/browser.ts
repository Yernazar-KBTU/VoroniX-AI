// Browser-only demo: the same model and the same answers as the server, but
// trained in the visitor's browser. The site's fetch calls are answered here.
import type { Report } from "./evaluate.js";
import { loadBrain } from "./service.js";

declare const PHRASES: string;
declare const REPORT: Report;

const brain = loadBrain({ text: PHRASES, report: REPORT });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const real = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const path = url.pathname.replace(/^.*?(\/(v1|demo)\/)/, "$1");
  if (!/^\/(v1|demo)\//.test(path)) return real(input, init);
  if (path === "/v1/model") return json({ ...brain.info, quality: brain.report });
  if (path === "/v1/training") return json(brain.training());
  if (path === "/v1/dataset") return json({ phrases: brain.examples });
  if (path === "/v1/storage") return json(brain.storage());
  if (path === "/v1/network") return json(brain.network(Number(url.searchParams.get("limit")) || undefined));
  const text = JSON.parse(String(init?.body ?? "{}")).text;
  if (typeof text !== "string" || !text.trim() || text.length > 1000) return json({ error: "Write a message of 1 to 1000 characters." }, 400);
  if (path.endsWith("/explain")) return json({ model: brain.info.name, ...brain.explain(text) });
  if (path.endsWith("/classify")) return json({ model: brain.info.name, ...brain.classify(text) });
  return json({ error: "Not found" }, 404);
};
