import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type AgentSignalSourceType,
} from '@lobechat/agent-signal/source';
import type { SignalPersistencePolicy } from '@lobechat/types';

/**
 * Persistence policy of every AgentSignal source type.
 *
 * Declared as an exhaustive `Record`, so adding a source type fails type-check until someone
 * decides whether it earns a row in `signals`. The default answer is `never`: most source types
 * are in-process notifications whose facts already live in operations, topics and messages, and
 * the per-step runtime events fire several times per run.
 */
export const AGENT_SIGNAL_SOURCE_PERSISTENCE: Readonly<
  Record<AgentSignalSourceType, SignalPersistencePolicy>
> = {
  [AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage]: 'never',
  // Chat messages are mostly noise; only the ones a wake decision was made about are worth a row.
  [AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged]: 'on_decision',
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayError]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayRuntimeEnd]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStreamStart]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart]: 'never',
  // High-frequency: one per runtime step. Must stay `never`.
  [AGENT_SIGNAL_SOURCE_TYPES.runtimeAfterStep]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted]: 'never',
  [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed]: 'never',
};

/**
 * Persistence policy of external Oracles — the `source` column of `signals`. These deliver
 * authenticated, low-volume events and are the reason the table exists.
 */
export const SIGNAL_ORACLE_PERSISTENCE: Readonly<Record<string, SignalPersistencePolicy>> = {
  'agent-mail': 'always',
};

/**
 * Looks up a signal's persistence policy by AgentSignal source type or Oracle name.
 *
 * Returns:
 * - The declared policy, or `never` for a key nobody declared, so an unknown feed cannot fill the
 *   table by default
 */
export const resolveSignalPersistence = (key: string): SignalPersistencePolicy =>
  (AGENT_SIGNAL_SOURCE_PERSISTENCE as Record<string, SignalPersistencePolicy | undefined>)[key] ??
  SIGNAL_ORACLE_PERSISTENCE[key] ??
  'never';

/** Whether a signal under `policy` gets a row, given whether a decision is being recorded for it. */
export const shouldPersistSignal = (
  policy: SignalPersistencePolicy,
  { hasDecision }: { hasDecision: boolean },
): boolean => policy === 'always' || (policy === 'on_decision' && hasDecision);
