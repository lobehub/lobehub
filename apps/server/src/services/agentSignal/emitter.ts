import type { DedupedSourceEventResult } from '@lobechat/agent-signal';
import {
  type AgentSignalSourceEventInput as SharedAgentSignalSourceEventInput,
  type AgentSignalSourceType,
  getSourceEventScopeKey,
  type SourceAgentExecutionCompleted,
  type SourceAgentExecutionFailed,
  type SourceAgentUserMessage,
  type SourceBotMessageMerged,
  type SourceRuntimeAfterStep,
  type SourceRuntimeBeforeStep,
} from '@lobechat/agent-signal/source';

import type { LobeChatDatabase } from '@/database/type';

import {
  executeAgentSignalSourceEvent,
  type GeneratedAgentSignalEmissionResult,
} from './orchestrator';
import type { CreateDefaultAgentSignalPoliciesOptions } from './policies';
import type { BotWakeConfig, CreateBotWakePolicyOptions } from './scenarios/botWake';
import { getAgentSignalScenarioMeta, isAgentSignalScenarioEnabled } from './scenarios/meta';
import type { AgentSignalScenarioId } from './scenarios/types';

export interface AgentSignalExecutionContext {
  agentId?: string;
  db: LobeChatDatabase;
  userId: string;
  /**
   * Workspace id when the originating producer ran inside a team workspace.
   * Threaded through to action handlers so workspace-scoped writes (e.g.
   * `userMemories`) can target the correct workspace.
   */
  workspaceId?: string;
}

type RuntimeProducerSourceType =
  | SourceAgentExecutionCompleted['sourceType']
  | SourceAgentExecutionFailed['sourceType']
  | SourceRuntimeAfterStep['sourceType']
  | SourceRuntimeBeforeStep['sourceType'];

/** One producer-side source emission input. */
export type AgentSignalSourceEventInput<TSourceType extends AgentSignalSourceType> =
  SharedAgentSignalSourceEventInput<TSourceType>;

/** One AgentSignal emission execution option set. */
export interface AgentSignalPolicyOptionOverrides extends Omit<
  Partial<CreateDefaultAgentSignalPoliciesOptions>,
  'skillManagement'
> {
  /** Bot-wake scenario policy wiring. */
  botWake?: CreateBotWakePolicyOptions;
  skillManagement?: Partial<
    NonNullable<CreateDefaultAgentSignalPoliciesOptions['skillManagement']>
  >;
}

export interface AgentSignalEmitOptions {
  /** Bot configuration the bot-wake scenario gate reads. Ignored by other scenarios. */
  botWakeConfig?: BotWakeConfig | null;
  ignoreError?: boolean;
  policyOptions?: AgentSignalPolicyOptionOverrides;
}

export type RuntimeAgentSignalSourceInput<TSourceType extends RuntimeProducerSourceType> =
  AgentSignalSourceEventInput<TSourceType>;

export type BotAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceBotMessageMerged['sourceType']
>;

export type UserMessageAgentSignalSourceInput = AgentSignalSourceEventInput<
  SourceAgentUserMessage['sourceType']
>;

export const resolveSourceScopeKey = getSourceEventScopeKey;

const withSelfIterationPolicy = (
  options: AgentSignalEmitOptions,
  selfIterationEnabled: boolean,
): AgentSignalEmitOptions => ({
  ...options,
  policyOptions: {
    ...options.policyOptions,
    skillManagement: {
      ...options.policyOptions?.skillManagement,
      selfIterationEnabled,
    },
  },
});

/**
 * Emits one source event into the AgentSignal pipeline and executes matching policies.
 *
 * Use when:
 * - Server-owned event producers need the normal AgentSignal boundary
 * - The caller should not control dedupe storage
 *
 * Expects:
 * - `context` points at the same database/user pair used by downstream policy execution
 *
 * Returns:
 * - A deduped result or a generated signal with orchestration details
 */
export const emitAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: AgentSignalEmitOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  const selfIterationEnabled = await isAgentSignalScenarioEnabled('self-iteration', {
    db: context.db,
    userId: context.userId,
  });

  if (!selfIterationEnabled) {
    return undefined;
  }

  // Static import on purpose: server code keeps a single, visible dependency graph
  // (`no-dynamic-import-in-server`), so `orchestrator` is loaded with this module rather
  // than deferred to request time.
  return executeAgentSignalSourceEvent(input, context, withSelfIterationPolicy(options, true));
};

// Re-exported so the public `agentSignal` boundary keeps a single entry point while
// `procedure/*` imports the leaf module directly (see enqueue.ts for why).
export type { QueuedAgentSignalEmissionResult } from './enqueue';
export { enqueueAgentSignalSourceEvent } from './enqueue';

/**
 * Runs one source event through a named scenario and awaits its orchestration result.
 *
 * Use when:
 * - The caller needs the verdict in the same request, for example the bot-wake decision
 * - The scenario is registered as `sync`; the event never goes through the Upstash workflow
 *
 * Expects:
 * - `options.botWakeConfig` carries the bot configuration for the bot-wake gate
 *
 * Returns:
 * - `undefined` when the scenario gate is closed, otherwise the same result as
 *   {@link emitAgentSignalSourceEvent}
 */
export const emitAgentSignalScenarioEvent = async <TSourceType extends AgentSignalSourceType>(
  scenarioId: AgentSignalScenarioId,
  input: AgentSignalSourceEventInput<TSourceType>,
  context: AgentSignalExecutionContext,
  options: AgentSignalEmitOptions = {},
): Promise<DedupedSourceEventResult | GeneratedAgentSignalEmissionResult | undefined> => {
  const scenario = getAgentSignalScenarioMeta(scenarioId);

  if (scenario.execution !== 'sync') {
    throw new Error(
      `[AgentSignal] Scenario "${scenarioId}" is async; enqueue it instead of awaiting it.`,
    );
  }

  const enabled = await isAgentSignalScenarioEnabled(scenarioId, {
    botWake: options.botWakeConfig,
    db: context.db,
    userId: context.userId,
  });

  if (!enabled) return undefined;

  return executeAgentSignalSourceEvent(input, context, { ...options, scenario: scenarioId });
};
