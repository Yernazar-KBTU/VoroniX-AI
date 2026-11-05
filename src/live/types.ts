// What VoroniX AI keeps while it works: every record here is one document in
// the site's database (one collection per kind, see store.ts).
import type { Label, Lang } from "../data.js";

export type Channel = "instagram" | "telegram" | "whatsapp";
export const CHANNELS: Channel[] = ["instagram", "telegram", "whatsapp"];

/** A phrase the AI learned while working, with where the right answer came from. */
export interface Phrase {
  id: string;
  text: string;
  lang: Lang;
  labels: Label[];
  /** client: the conversation proved it; operator: a person checked it; business: taught by hand; auto: the AI made it from business data. */
  source: "client" | "operator" | "business" | "auto";
  why: string;
  at: number;
  client?: string;
}

/** Something the AI wants a person to look at. */
export interface QueueItem {
  id: string;
  kind: "unsure" | "unanswered" | "complaint";
  text: string;
  lang: Lang;
  guess: Label[];
  score: number;
  client?: string;
  clientName?: string;
  channel?: Channel;
  /** Known right answer, only for messages of the built-in demo stream (used by its simulated operator). */
  truth?: Label[];
  at: number;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  text: string;
  source: "business" | "operator" | "file";
  file?: string;
  at: number;
}

export interface Service {
  id: string;
  names: Record<Lang, string>;
  minutes: number;
  price: number;
  /** Word stems that point to this service in a client's message. */
  stems: string[];
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  /** Working days, 0 = Sunday. */
  days: number[];
  from: string;
  to: string;
  services: string[];
}

export interface Business {
  name: string;
  city: string;
  address: Record<Lang, string>;
  from: string;
  to: string;
  phone: string;
  currency: string;
  services: Service[];
  staff: Staff[];
}

export interface Booking {
  id: string;
  client: string;
  clientName: string;
  service: string;
  staff: string;
  /** Local time, "YYYY-MM-DDTHH:MM". */
  start: string;
  minutes: number;
  price: number;
  status: "booked" | "cancelled";
  source: Channel | "crm";
  at: number;
}

export interface Turn {
  at: number;
  from: "client" | "ai";
  text: string;
  labels?: Label[];
}

export interface Said {
  text: string;
  lang: Lang;
  labels: Label[];
}

/** Where a conversation stands, so «да» after an offer means «book it». */
export interface Dialog {
  stage: "idle" | "offer" | "service";
  offers?: { staff: string; start: string }[];
  service?: string;
  /** The message that started a booking, learned once the booking is made. */
  started?: Said;
  /** The last question the AI answered, learned when the client says thank you. */
  answered?: Said;
}

/** Everything the AI remembers about one client. */
export interface ClientMemory {
  id: string;
  name: string;
  /** "crm": added by the staff in the CRM, not from a chat. */
  channel: Channel | "crm";
  handle: string;
  lang: Lang;
  first: number;
  last: number;
  messages: number;
  intents: Partial<Record<Label, number>>;
  services: Record<string, number>;
  staff: Record<string, number>;
  times: { morning: number; day: number; evening: number };
  bookings: number;
  cancels: number;
  complaints: number;
  thanks: number;
  /** From -1 (unhappy) to 1 (happy), a moving average over messages. */
  mood: number;
  history: Turn[];
  dialog: Dialog;
}

export interface Metrics {
  exact: number;
  f1: number;
  lang: number;
}

export interface Version {
  id: string;
  n: number;
  at: number;
  /** The version is trained on the start phrases plus every learned phrase up to this moment. */
  upto: number;
  phrases: number;
  metrics: Metrics;
  prev: Metrics | null;
  status: "live" | "old" | "rejected";
  trigger: string;
  ms: number;
  holdout: number;
}

export interface LiveEvent {
  id: string;
  at: number;
  kind: "message" | "learn" | "retrain" | "knowledge" | "review" | "command" | "business";
  title: string;
  detail?: Record<string, unknown>;
}
