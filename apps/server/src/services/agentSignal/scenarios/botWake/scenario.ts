import { botWakeScenarioMeta } from '../meta';
import type { AgentSignalScenario } from '../types';
import { createBotWakePolicy } from './policy';

/**
 * Decides whether a bot should wake for a message. Gated by the bot's own configuration and
 * executed synchronously so the caller can await the verdict.
 */
export const botWakeScenario: AgentSignalScenario = {
  ...botWakeScenarioMeta,
  createPolicies: (options) => [createBotWakePolicy(options.botWake)],
};
