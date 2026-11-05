// Where the AI keeps its data. The code talks to one small interface, so the
// storage can change without touching the AI: today the site's own database
// (SiteStore), in tests and previews memory (MemoryStore), later a server with
// its own database (one more class with the same five methods).

export type Row = { id: string } & Record<string, unknown>;
export type Change = { type: "added" | "modified" | "removed"; row: Row };
export const COLLECTIONS = ["phrases", "queue", "knowledge", "clients", "bookings", "versions", "events", "settings"] as const;
export type Collection = (typeof COLLECTIONS)[number];
type Listener = (rows: Row[], changes: Change[]) => void;

export interface Store {
  /** "site": saved in the site's database and shared by everyone who opens it; "memory": nothing is saved. */
  readonly kind: "site" | "memory";
  all(col: Collection): Promise<Row[]>;
  put(col: Collection, row: Row): Promise<void>;
  patch(col: Collection, id: string, data: Record<string, unknown>): Promise<void>;
  remove(col: Collection, id: string): Promise<void>;
  /** Calls back with the whole collection after every change, made here or by anyone else. */
  watch(col: Collection, cb: Listener): () => void;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function merge(into: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...into };
  for (const [k, v] of Object.entries(data)) {
    const cur = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? merge(cur as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private data = new Map<string, Map<string, Row>>();
  private listeners = new Map<string, Set<Listener>>();

  private col(c: string): Map<string, Row> {
    let m = this.data.get(c);
    if (!m) this.data.set(c, (m = new Map()));
    return m;
  }

  async all(c: Collection): Promise<Row[]> {
    return [...this.col(c).values()].map(copy);
  }

  async put(c: Collection, row: Row): Promise<void> {
    const had = this.col(c).has(row.id);
    this.col(c).set(row.id, copy(row));
    this.emit(c, { type: had ? "modified" : "added", row: copy(row) });
  }

  async patch(c: Collection, id: string, data: Record<string, unknown>): Promise<void> {
    const cur = this.col(c).get(id);
    if (!cur) throw new Error(`${c}/${id} does not exist`);
    const next = merge(cur, copy(data)) as Row;
    this.col(c).set(id, next);
    this.emit(c, { type: "modified", row: copy(next) });
  }

  async remove(c: Collection, id: string): Promise<void> {
    const cur = this.col(c).get(id);
    if (!cur) return;
    this.col(c).delete(id);
    this.emit(c, { type: "removed", row: cur });
  }

  watch(c: Collection, cb: Listener): () => void {
    let set = this.listeners.get(c);
    if (!set) this.listeners.set(c, (set = new Set()));
    set.add(cb);
    const rows = [...this.col(c).values()].map(copy);
    queueMicrotask(() => set!.has(cb) && cb(rows, rows.map((row) => ({ type: "added" as const, row }))));
    return () => set!.delete(cb);
  }

  private emit(c: string, change: Change) {
    const set = this.listeners.get(c);
    if (!set?.size) return;
    const rows = [...this.col(c).values()].map(copy);
    for (const cb of set) queueMicrotask(() => cb(rows, [change]));
  }
}

/** The part of the artifact database API this store uses (see the platform's db.d.ts). */
interface SiteDoc {
  id: string;
  data(): Record<string, unknown> | undefined;
}
interface SiteDb {
  collection(path: string): {
    get(): Promise<{ docs: SiteDoc[] }>;
    doc(id: string): { set(d: Record<string, unknown>): Promise<void>; update(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> };
    onSnapshot(next: (s: { docs: SiteDoc[]; docChanges(): { type: Change["type"]; doc: SiteDoc }[] }) => void, error?: (e: { code: string; message: string }) => void): () => void;
  };
}

/** The site's own database: documents survive reloads and every open page sees changes live. */
export class SiteStore implements Store {
  readonly kind = "site" as const;
  constructor(
    private readonly db: SiteDb,
    private readonly onError: (e: { code: string; message: string }) => void = () => {},
  ) {}

  private static row(d: SiteDoc): Row {
    return { ...(d.data() ?? {}), id: d.id };
  }

  async all(c: Collection): Promise<Row[]> {
    const s = await this.db.collection(c).get();
    return s.docs.map(SiteStore.row);
  }

  async put(c: Collection, row: Row): Promise<void> {
    const { id, ...data } = row;
    await this.retry(() => this.db.collection(c).doc(id).set(data));
  }

  async patch(c: Collection, id: string, data: Record<string, unknown>): Promise<void> {
    await this.retry(() => this.db.collection(c).doc(id).update(data));
  }

  async remove(c: Collection, id: string): Promise<void> {
    await this.retry(() => this.db.collection(c).doc(id).delete());
  }

  watch(c: Collection, cb: Listener): () => void {
    return this.db.collection(c).onSnapshot(
      (s) => cb(s.docs.map(SiteStore.row), s.docChanges().map((ch) => ({ type: ch.type, row: SiteStore.row(ch.doc) }))),
      (e) => this.onError(e),
    );
  }

  /** "unavailable" is a short platform hiccup: one more try after a short random pause. */
  private async retry(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "unavailable") {
        this.onError(e as { code: string; message: string });
        throw e;
      }
      await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 500));
      await op();
    }
  }
}

let counter = 0;
/** Short unique ids that fit the database's path rules (letters, digits, - and _). */
/** Ids sort in the order they were made (time, then a counter), so phrases are replayed in the order they were learned. */
export const newId = (prefix: string, at = Date.now()) => `${prefix}-${at.toString(36)}-${(counter++ % 1679616).toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`;
