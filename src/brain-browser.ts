// Browser bundle of the CRM brain: window.VoronixBrain.create(saved) returns a
// CrmBrain trained in the page from our own phrases (no outside AI service).
import { CrmBrain, toBusiness, type BrainState } from "./crm-brain.js";
import { LABELS } from "./data.js";

declare const PHRASES: string;
declare const VERSION: string;

const api = {
  version: VERSION,
  labels: LABELS,
  toBusiness,
  /** Trains the start model (about a second), then replays what was learned before. */
  async create(saved?: Partial<BrainState> | null): Promise<CrmBrain> {
    await new Promise((r) => setTimeout(r, 0));
    const brain = CrmBrain.fromPhrases(PHRASES);
    await brain.load(saved);
    return brain;
  },
};
(window as unknown as { VoronixBrain: typeof api }).VoronixBrain = api;
