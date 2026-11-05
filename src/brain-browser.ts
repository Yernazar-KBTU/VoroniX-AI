// Browser bundle of the CRM brain: window.VoronixBrain.create(saved) returns a
// CrmBrain trained in the page from our own phrases (no outside AI service).
import { CrmBrain, toBusiness, type BrainState } from "./crm-brain.js";
import { augment, LABELS, parseExamples } from "./data.js";
import { IntentModel } from "./model.js";
import { SETTINGS } from "./live/learner.js";

declare const PHRASES: string;
declare const VERSION: string;

const api = {
  version: VERSION,
  labels: LABELS,
  toBusiness,
  /** Trains the start model in the page (a few seconds, without freezing it), then replays what was learned before. */
  async create(saved?: Partial<BrainState> | null, onProgress?: (epoch: number, of: number) => void): Promise<CrmBrain> {
    const seed = parseExamples(PHRASES);
    const model = await IntentModel.trainAsync(augment(seed), { ...SETTINGS, onEpoch: (e) => onProgress?.(e, SETTINGS.epochs) });
    const brain = new CrmBrain(seed, model);
    await brain.load(saved);
    return brain;
  },
};
(window as unknown as { VoronixBrain: typeof api }).VoronixBrain = api;
