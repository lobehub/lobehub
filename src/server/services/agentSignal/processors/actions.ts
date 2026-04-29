import type {
  ActionSkillManagementHandle,
  ActionUserMemoryHandle,
  SignalFeedbackDomainMemory,
  SignalFeedbackDomainSkill,
} from '../policies/types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../policies/types';

interface SerializedContextPayload {
  serializedContext?: unknown;
}

interface SourcePayloadCarrier {
  payload?: SerializedContextPayload;
}

/**
 * Skill-domain feedback signal that is eligible for direct skill-management action planning.
 */
export type NonSatisfiedSkillFeedbackDomainSignal = SignalFeedbackDomainSkill & {
  payload: SignalFeedbackDomainSkill['payload'] & {
    satisfactionResult: 'neutral' | 'not_satisfied';
    target: 'skill';
  };
};

const getSerializedContext = (signal: SignalFeedbackDomainMemory | SignalFeedbackDomainSkill) => {
  if (typeof signal.payload.serializedContext === 'string') {
    return signal.payload.serializedContext;
  }

  const source = signal.source as SignalFeedbackDomainMemory['source'] & SourcePayloadCarrier;

  return typeof source.payload?.serializedContext === 'string'
    ? source.payload.serializedContext
    : undefined;
};

/**
 * Plans a user-memory action from one memory feedback-domain signal.
 *
 * Use when:
 * - Feedback-domain analysis selected the memory target
 * - The runtime needs a durable user-memory action node
 *
 * Expects:
 * - `signal.payload.target` is `memory`
 * - `signal.payload.messageId` is stable for idempotency
 * - Optional serialized context is carried on `signal.payload.serializedContext`
 *
 * Returns:
 * - A typed user-memory action node with stable chain, signal, source, and idempotency metadata
 */
export const planUserMemory = (signal: SignalFeedbackDomainMemory): ActionUserMemoryHandle => {
  const { payload } = signal;

  return {
    actionId: `${signal.signalId}:action:memory`,
    actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
    chain: {
      chainId: signal.chain.chainId,
      parentNodeId: signal.signalId,
      parentSignalId: signal.signalId,
      rootSourceId: signal.chain.rootSourceId,
    },
    payload: {
      agentId: payload.agentId,
      conflictPolicy: payload.conflictPolicy,
      evidence: payload.evidence,
      feedbackHint: payload.satisfactionResult === 'satisfied' ? 'satisfied' : 'not_satisfied',
      idempotencyKey: `${signal.chain.rootSourceId}:memory:${payload.messageId}`,
      message: payload.message,
      messageId: payload.messageId,
      reason: payload.reason,
      serializedContext: getSerializedContext(signal),
      sourceHints: payload.sourceHints,
      topicId: payload.topicId,
    },
    signal: {
      signalId: signal.signalId,
      signalType: signal.signalType,
    },
    source: signal.source,
    timestamp: signal.timestamp,
  } satisfies ActionUserMemoryHandle;
};

/**
 * Plans a skill-management action from one skill feedback-domain signal.
 *
 * Use when:
 * - Feedback-domain analysis selected the skill target
 * - The runtime needs a durable skill-management action node
 *
 * Expects:
 * - `signal.payload.target` is `skill`
 * - `signal.payload.satisfactionResult` is `neutral` or `not_satisfied`
 * - `signal.payload.messageId` is stable for idempotency
 * - Optional serialized context is carried on `signal.payload.serializedContext`
 *
 * Returns:
 * - A typed skill-management action node with stable chain, signal, source, and idempotency metadata
 */
export const planSkillManagement = (
  signal: NonSatisfiedSkillFeedbackDomainSignal,
): ActionSkillManagementHandle => {
  const { payload } = signal;

  return {
    actionId: `${signal.signalId}:action:skill-management`,
    actionType: AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
    chain: {
      chainId: signal.chain.chainId,
      parentNodeId: signal.signalId,
      parentSignalId: signal.signalId,
      rootSourceId: signal.chain.rootSourceId,
    },
    payload: {
      agentId: payload.agentId,
      conflictPolicy: payload.conflictPolicy,
      evidence: payload.evidence,
      feedbackHint: 'not_satisfied',
      idempotencyKey: `${signal.chain.rootSourceId}:skill:${payload.messageId}`,
      message: payload.message,
      messageId: payload.messageId,
      reason: payload.reason,
      serializedContext: getSerializedContext(signal),
      sourceHints: payload.sourceHints,
      topicId: payload.topicId,
    },
    signal: {
      signalId: signal.signalId,
      signalType: signal.signalType,
    },
    source: signal.source,
    timestamp: signal.timestamp,
  } satisfies ActionSkillManagementHandle;
};
