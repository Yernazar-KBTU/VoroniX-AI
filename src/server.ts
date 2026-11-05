// VoroniX AI: a separate web service with its own API. It understands what a
// client of a salon wants (intents) and in which language they write.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { page } from "./page.js";
import { loadBrain, type Brain } from "./service.js";

export interface Options {
  /** When set, POST /v1/classify needs "Authorization: Bearer <key>". */
  apiKey?: string;
  /** Requests per minute for one IP address. */
  rateLimit?: number;
  brain?: Brain;
}

const MAX_TEXT = 1000;
const MAX_BATCH = 50;

export function createAiServer(opts: Options = {}): Server {
  const brain = opts.brain ?? loadBrain();
  const limit = opts.rateLimit ?? 120;
  const hits = new Map<string, { n: number; until: number }>();

  const allowed = (ip: string) => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.until < now) {
      hits.set(ip, { n: 1, until: now + 60_000 });
      return true;
    }
    return ++h.n <= limit;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") return end(res, 204);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return end(res, 200, page(brain));
      }
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/v1/model") return json(res, 200, { ...brain.info, quality: brain.report });

      const demo = url.pathname === "/demo/classify";
      if (req.method === "POST" && (url.pathname === "/v1/classify" || demo)) {
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.socket.remoteAddress || "-";
        if (!allowed(ip)) return json(res, 429, { error: "Too many requests, try again in a minute." });
        // The try box on the home page uses /demo/classify without a key, one text at a time.
        if (!demo && opts.apiKey && req.headers.authorization !== `Bearer ${opts.apiKey}`) return json(res, 401, { error: "Missing or wrong API key." });
        const body = await readJson(req);
        const texts: unknown[] = Array.isArray(body?.texts) && !demo ? body.texts : [body?.text];
        if (!texts.length || texts.length > MAX_BATCH || texts.some((t) => typeof t !== "string" || !t.trim() || t.length > MAX_TEXT))
          return json(res, 400, { error: `Send {"text": "..."} (1 to ${MAX_TEXT} characters) or {"texts": [...]} with up to ${MAX_BATCH} texts.` });
        const results = (texts as string[]).map((t) => brain.classify(t));
        return json(res, 200, Array.isArray(body?.texts) && !demo ? { model: brain.info.name, results } : { model: brain.info.name, ...results[0] });
      }
      return json(res, 404, { error: "Not found" });
    } catch (err) {
      return json(res, (err as { status?: number }).status ?? 500, { error: (err as Error).message });
    }
  });
}

function end(res: ServerResponse, status: number, body?: string) {
  res.statusCode = status;
  res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  end(res, status, JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 100_000) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Body must be JSON"), { status: 400 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 4000);
  createAiServer({ apiKey: process.env.VORONIX_AI_KEY || undefined }).listen(port, () => console.log(`VoroniX AI on http://localhost:${port}`));
}
