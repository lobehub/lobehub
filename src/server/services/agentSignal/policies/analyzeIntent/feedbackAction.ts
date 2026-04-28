import type { BaseAction, BaseSignal, RuntimeProcessorResult } from '@lobechat/agent-signal';

import { defineSignalHandler } from '../../runtime/middleware';
import {
  AGENT_SIGNAL_POLICY_ACTION_TYPES,
  AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
  type AgentSignalFeedbackDomainTarget,
  type AgentSignalFeedbackSourceHints,
} from '../types';

const createStableIdempotencyKey = (
  signal: BaseSignal,
  target: AgentSignalFeedbackDomainTarget,
  messageId: string,
) => {
  return `${signal.chain.rootSourceId}:${target}:${messageId}`;
};

const buildPlannedActions = (signal: BaseSignal): BaseAction[] => {
  const payload = signal.payload as {
    agentId?: string;
    conflictPolicy?: {
      forbiddenWith?: AgentSignalFeedbackDomainTarget[];
      mode: 'exclusive' | 'fanout';
      priority: number;
    };
    evidence?: Array<{
      cue: string;
      excerpt: string;
    }>;
    message: string;
    messageId: string;
    reason?: string;
    satisfactionResult?: 'not_satisfied' | 'neutral' | 'satisfied';
    sourceHints?: AgentSignalFeedbackSourceHints;
    target: AgentSignalFeedbackDomainTarget;
    topicId?: string;
  };
  const sourcePayload =
    signal.source && 'payload' in signal.source && signal.source.payload
      ? (signal.source.payload as Record<string, unknown>)
      : undefined;
  const serializedContext =
    typeof sourcePayload?.serializedContext === 'string'
      ? sourcePayload.serializedContext
      : undefined;

  const idempotencyKey = createStableIdempotencyKey(signal, payload.target, payload.messageId);

  if (payload.target === 'memory') {
    return [
      {
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
          idempotencyKey,
          message: payload.message,
          reason: payload.reason,
          serializedContext,
          sourceHints: payload.sourceHints,
          topicId: payload.topicId,
        },
        signal: {
          signalId: signal.signalId,
          signalType: signal.signalType,
        },
        source: signal.source,
        timestamp: signal.timestamp,
      },
    ];
  }

  return [];
};

/**
 * Creates the signal handler that turns domain signals into action lists.
 *
 * Triggering workflow:
 *
 * {@link createFeedbackDomainJudgeSignalHandler}
 *   -> `signal.feedback.domain.*`
 *     -> {@link createFeedbackActionPlannerSignalHandler}
 *
 * Upstream:
 * - {@link createFeedbackDomainJudgeSignalHandler}
 *
 * Downstream:
 * - `action.user-memory.handle`
 */
export const createFeedbackActionPlannerSignalHandler = () => {
  const listenedSignalTypes = [
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainNone,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt,
    AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainSkill,
  ] as const;

  return defineSignalHandler(
    listenedSignalTypes,
    'signal.feedback-action-planner',
    async (signal): Promise<RuntimeProcessorResult | void> => {
      const actions = buildPlannedActions(signal);

      if (actions.length === 0) {
        return;
      }

      return {
        actions,
        status: 'dispatch',
      };
    },
  );
};
