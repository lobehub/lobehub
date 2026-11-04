import type { LobeChatDatabase } from '@/database/type';

import type { CreateDefaultAgentSignalPoliciesOptions } from '../policies';
import type { AgentSignalMiddleware } from '../runtime/middleware';
import type { BotWakeConfig, CreateBotWakePolicyOptions } from './botWake';

export const AGENT_SIGNAL_SCENARIO_IDS = {
  botWake: 'bot-wake',
  selfIteration: 'self-iteration',
} as const;

export type AgentSignalScenarioId =
  (typeof AGENT_SIGNAL_SCENARIO_IDS)[keyof typeof AGENT_SIGNAL_SCENARIO_IDS];

/**
 * - `async`: the producer hands the event to the Upstash workflow and returns.
 * - `sync`: the producer awaits the runtime pass and receives the orchestration result.
 */
export type AgentSignalScenarioExecution = 'async' | 'sync';

/** Inputs a scenario gate may read. Each scenario reads only its own slice. */
export interface AgentSignalScenarioGateInput {
  /** Bot configuration; the bot-wake gate reads this. */
  botWake?: BotWakeConfig | null;
  db: LobeChatDatabase;
  /** User preference owner; the self-iteration gate reads their Labs switch. */
  userId: string;
}

export type AgentSignalScenarioPolicyOptions = CreateDefaultAgentSignalPoliciesOptions & {
  botWake?: CreateBotWakePolicyOptions;
};

/**
 * Execution mode and gate of one scenario. Kept apart from the policy factories so producers on
 * the light request path can gate an event without loading the policy graph.
 */
export interface AgentSignalScenarioMeta {
  execution: AgentSignalScenarioExecution;
  /** Resolves whether this scenario may run for the given context. */
  gate: (input: AgentSignalScenarioGateInput) => Promise<boolean> | boolean;
  id: AgentSignalScenarioId;
}

export interface AgentSignalScenario extends AgentSignalScenarioMeta {
  createPolicies: (options: AgentSignalScenarioPolicyOptions) => AgentSignalMiddleware[];
}
