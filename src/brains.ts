// VoroniX AI working on a server: one Live (the same AI as on the site) per
// business, its data kept on the VoroniX data server in the CRM's own
// database. The CRM sends each client message here (POST /v1/reply) and gets
// the answer; bookings the AI makes become CRM visits through the data server.
import { Live, type Received } from "./live/runtime.js";
import { ServerStore } from "./live/server-store.js";
import type { Channel } from "./live/types.js";
import type { Brain } from "./service.js";

export interface ReplyInput {
  /** The business (CRM business id): one running AI each. */
  business?: string;
  /** The data server key of the business (vxd_...). */
  dataKey: string;
  client: { id: string; name: string; channel: string; handle?: string };
  text: string;
}

export interface ReplyOutput {
  reply: string;
  lang: string;
  intents: { label: string; score: number }[];
  labels: string[];
  unsure: boolean;
  actions: { type: string; text: string }[];
  booking: { id: string; service: string; staff: string; start: string } | null;
  cancelled: { id: string } | null;
  handoff: string | null;
  learned: number;
  queued: string[];
  version: string;
}

const CHANNELS = ["instagram", "telegram", "whatsapp"];

export class Brains {
  private lives = new Map<string, { key: string; live: Promise<Live> }>();

  constructor(
    private readonly brain: Brain,
    private readonly dataUrl: string,
  ) {}

  /** The running AI of one business, started on first use; a new key (the CRM restarted) starts it again. */
  live(business: string, dataKey: string): Promise<Live> {
    const cur = this.lives.get(business);
    if (cur?.key === dataKey) return cur.live;
    if (cur) void cur.live.then((l) => l.stop()).catch(() => {});
    const live = this.start(dataKey);
    this.lives.set(business, { key: dataKey, live });
    live.catch(() => {
      if (this.lives.get(business)?.live === live) this.lives.delete(business);
    });
    return live;
  }

  private async start(dataKey: string): Promise<Live> {
    const store = new ServerStore({ url: this.dataUrl, key: dataKey, onError: (e) => console.error(`data server: ${e.code} ${e.message}`) });
    // The business profile (services, staff, hours) comes from the CRM.
    const res = await fetch(`${this.dataUrl.replace(/\/+$/, "")}/v1/crm/business/sync`, { method: "POST", headers: { authorization: `Bearer ${dataKey}` } });
    if (!res.ok) throw Object.assign(new Error(`The data server answered ${res.status} to the business sync`), { status: 502 });
    const live = new Live(store, this.brain.examples, undefined, this.brain.model);
    await live.start();
    return live;
  }

  async reply(input: ReplyInput): Promise<ReplyOutput> {
    const live = await this.live(input.business ?? input.dataKey, input.dataKey);
    const channel = (CHANNELS.includes(input.client.channel.toLowerCase()) ? input.client.channel.toLowerCase() : "telegram") as Channel;
    const r: Received = await live.receive({ name: input.client.name, channel, text: input.text, handle: input.client.handle, clientId: input.client.id });
    const o = r.outcome;
    const handoff = o.actions.find((a) => a.type === "handoff");
    return {
      reply: o.reply,
      lang: o.lang,
      intents: o.prediction.intents.map((i) => ({ label: i.label, score: Math.round(i.score * 1000) / 1000 })),
      labels: o.labels,
      unsure: o.unsure,
      actions: o.actions,
      booking: o.booking ? { id: o.booking.id, service: o.booking.service, staff: o.booking.staff, start: o.booking.start } : null,
      cancelled: o.cancelled ? { id: o.cancelled.id } : null,
      handoff: handoff ? handoff.text : null,
      learned: r.learned.length,
      queued: r.queued.map((q) => q.kind),
      version: live.learner.live?.id ?? "v0",
    };
  }
}
