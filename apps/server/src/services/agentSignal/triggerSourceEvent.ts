import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type AgentSignalSourcePayloadMap,
} from '@lobechat/agent-signal/source';

import type { AgentSignalSourceEventInput } from './emitter';
import {
  buildNightlyReviewSourceId,
  buildSelfFeedbackIntentSourceId,
  buildSelfReflectionSourceId,
} from './services/selfIteration/types';

/**
 * Producer source types a developer may trigger manually (CLI / local testing).
 *
 * These are normally emitted by the server itself (schedulers, runtime, tool
 * runtimes) and are intentionally excluded from `AGENT_SIGNAL_CLIENT_SOURCE_TYPES`.
 * The trigger path re-derives `userId` from the authenticated context so a caller
 * can only fan out signals scoped to their own account.
 */
export const AGENT_SIGNAL_TRIGGER_SOURCE_TYPES = [
  AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
  AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
  AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
  AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
] as const;

export type AgentSignalTriggerSourceType = (typeof AGENT_SIGNAL_TRIGGER_SOURCE_TYPES)[number];

const TRIGGER_SOURCE_TYPE_SET = new Set<string>(AGENT_SIGNAL_TRIGGER_SOURCE_TYPES);

export const isAgentSignalTriggerSourceType = (
  value: string,
): value is AgentSignalTriggerSourceType => TRIGGER_SOURCE_TYPE_SET.has(value);

/** One manual-trigger build request, before defaults are filled in. */
export interface BuildTriggerSourceEventInput {
  /** Agent the signal targets. Required for every source type except runtime debug ones. */
  agentId?: string;
  /** Injected clock, overridable for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
  /** Shallow override merged over the derived default payload (`userId` is ignored). */
  payloadOverride?: Record<string, unknown>;
  /** Explicit scope key. Defaults to payload-derived routing in `createSourceEvent`. */
  scopeKey?: string;
  /** Stable dedupe id. Defaults to a source-type specific deterministic id. */
  sourceId?: string;
  sourceType: AgentSignalTriggerSourceType;
  /** Event timestamp in ms. Defaults to `now` inside `createSourceEvent`. */
  timestamp?: number;
  /** Topic the signal is scoped to, when applicable. */
  topicId?: string;
  /** Owner of the triggered signal. Comes from the authenticated context. */
  userId: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const requireAgentId = (sourceType: AgentSignalTriggerSourceType, agentId?: string): string => {
  if (!agentId) {
    throw new Error(`agentId is required to trigger source type "${sourceType}"`);
  }
  return agentId;
};

/**
 * Builds a fully-formed source event input for one manually triggered source type.
 *
 * Use when:
 * - A developer triggers an Agent Signal source from the CLI / a test harness and
 *   wants the same normalization boundary production producers use.
 *
 * Expects:
 * - `userId` resolved from the authenticated context (never the payload override).
 * - `agentId` present for agent-scoped source types; throws a clear error otherwise.
 *
 * Returns:
 * - An `AgentSignalSourceEventInput` ready for `enqueueAgentSignalSourceEvent`.
 */
export const buildTriggerSourceEvent = (
  input: BuildTriggerSourceEventInput,
): AgentSignalSourceEventInput<AgentSignalTriggerSourceType> => {
  const { agentId, sourceType, topicId, userId } = input;
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const localDate = nowIso.slice(0, 10);

  // `userId` is owner-bound; never let an override repoint it to another account.
  const override = { ...input.payloadOverride };
  delete override.userId;

  let payload: AgentSignalSourcePayloadMap[AgentSignalTriggerSourceType];
  let defaultSourceId: string;

  switch (sourceType) {
    case AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested: {
      const resolvedAgentId = requireAgentId(sourceType, agentId);
      const resolvedLocalDate =
        typeof override.localDate === 'string' ? override.localDate : localDate;
      payload = {
        agentId: resolvedAgentId,
        localDate: resolvedLocalDate,
        requestedAt: nowIso,
        reviewWindowEnd: nowIso,
        reviewWindowStart: new Date(now - DAY_MS).toISOString(),
        timezone: 'UTC',
        userId,
      };
      defaultSourceId = buildNightlyReviewSourceId({
        agentId: resolvedAgentId,
        localDate: resolvedLocalDate,
        userId,
      });
      break;
    }

    case AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested: {
      const resolvedAgentId = requireAgentId(sourceType, agentId);
      const scopeType = topicId ? 'topic' : 'operation';
      const scopeId = topicId ?? `manual:${now}`;
      const reason = 'manual-trigger';
      const windowStart = new Date(now - HOUR_MS).toISOString();
      payload = {
        agentId: resolvedAgentId,
        reason,
        scopeId,
        scopeType,
        topicId,
        userId,
        windowEnd: nowIso,
        windowStart,
      };
      defaultSourceId = buildSelfReflectionSourceId({
        agentId: resolvedAgentId,
        reason,
        scopeId,
        scopeType,
        userId,
        windowEnd: nowIso,
        windowStart,
      });
      break;
    }

    case AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared: {
      const resolvedAgentId = requireAgentId(sourceType, agentId);
      const toolCallId = `manual-${now}`;
      const scopeType = topicId ? 'topic' : 'operation';
      const scopeId = topicId ?? `manual:${now}`;
      payload = {
        action: 'write',
        agentId: resolvedAgentId,
        confidence: 0.9,
        kind: 'memory',
        reason: 'manual-trigger',
        summary: 'Manual self-feedback intent trigger',
        toolCallId,
        topicId,
        userId,
      };
      defaultSourceId = buildSelfFeedbackIntentSourceId({
        agentId: resolvedAgentId,
        scopeId,
        scopeType,
        toolCallId,
        userId,
      });
      break;
    }

    case AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage: {
      const messageId = `manual-${now}`;
      payload = {
        agentId,
        message: 'Manual agent.user.message trigger',
        messageId,
        topicId,
        trigger: 'cli-trigger',
      };
      defaultSourceId = `manual-user-message:${userId}:${agentId ?? 'none'}:${now}`;
      break;
    }

    case AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted: {
      payload = {
        agentId,
        outcome: {
          action: 'manual-trigger',
          status: 'succeeded',
          summary: 'Manual tool outcome trigger',
        },
        tool: { identifier: 'manual-trigger' },
        topicId,
      };
      defaultSourceId = `manual-tool-outcome:succeeded:${userId}:${now}`;
      break;
    }

    case AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed: {
      payload = {
        agentId,
        outcome: {
          action: 'manual-trigger',
          errorReason: 'manual-trigger',
          status: 'failed',
          summary: 'Manual tool failure trigger',
        },
        tool: { identifier: 'manual-trigger' },
        topicId,
      };
      defaultSourceId = `manual-tool-outcome:failed:${userId}:${now}`;
      break;
    }

    default: {
      // Exhaustiveness guard: a new trigger source type must be handled above.
      const exhaustive: never = sourceType;
      throw new Error(`Unsupported trigger source type "${exhaustive as string}"`);
    }
  }

  const mergedPayload = {
    ...(payload as Record<string, unknown>),
    ...override,
    userId,
  } as AgentSignalSourcePayloadMap[AgentSignalTriggerSourceType];

  return {
    payload: mergedPayload,
    scopeKey: input.scopeKey,
    sourceId: input.sourceId ?? defaultSourceId,
    sourceType,
    timestamp: input.timestamp,
  } as AgentSignalSourceEventInput<AgentSignalTriggerSourceType>;
};
