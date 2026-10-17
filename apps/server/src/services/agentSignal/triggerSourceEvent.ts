import {
  AGENT_SIGNAL_SOURCE_TYPES,
  type AgentSignalSourcePayloadMap,
} from '@lobechat/agent-signal/source';
import { TRPCError } from '@trpc/server';

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

/**
 * Payload keys that feed the nightly review guard key (`nightly-review:{userId}:{agentId}:{localDate}`).
 *
 * The handler only runs a review whose `sourceId` equals that key and then claims it once per
 * day, so a caller who may pick `localDate` (or the source id) mints a fresh guard key per call and
 * gets an unbounded number of model-backed reviews.
 */
const NIGHTLY_REVIEW_GUARD_OVERRIDE_KEYS = ['agentId', 'localDate'] as const;

/**
 * Whether manual triggers may override nightly-review guard inputs by default.
 *
 * Only local development (`NODE_ENV=development`) may pin `localDate` / `sourceId` to replay a
 * specific day; every deployed environment derives them server-side.
 */
const isNightlyReviewGuardOverrideAllowedByDefault = () => process.env.NODE_ENV === 'development';

/** One manual-trigger build request, before defaults are filled in. */
export interface BuildTriggerSourceEventInput {
  /** Agent the signal targets. Required for every source type except runtime debug ones. */
  agentId?: string;
  /**
   * Lets `payloadOverride.localDate` / `payloadOverride.agentId` and `sourceId` change the nightly
   * review guard key. Ignored for every other source type.
   *
   * @default `true` only when `NODE_ENV === 'development'`
   */
  allowNightlyReviewGuardOverride?: boolean;
  /** Injected clock, overridable for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
  /**
   * Shallow override merged over the derived default payload. `userId` is always ignored; nightly
   * review guard inputs are ignored unless {@link allowNightlyReviewGuardOverride} is set.
   */
  payloadOverride?: Record<string, unknown>;
  /** Explicit scope key. Defaults to payload-derived routing in `createSourceEvent`. */
  scopeKey?: string;
  /**
   * Stable dedupe id. Defaults to a source-type specific deterministic id. Ignored for nightly
   * review unless {@link allowNightlyReviewGuardOverride} is set.
   */
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
 * Resolves the agent id the enqueue path must authorize for one manual trigger.
 *
 * Use when:
 * - A trigger caller passes the built event to `enqueueAgentSignalSourceEvent`, which only checks
 *   `context.agentId` with `assertAgentUsableBy`
 *
 * Expects:
 * - `event` comes from {@link buildTriggerSourceEvent}; `payloadOverride.agentId` may have put an
 *   agent id in the payload that the request's `agentId` never named
 *
 * Returns:
 * - The payload agent id (or the requested one when the payload has none), so the agent the
 *   handlers act on is the one that gets authorized
 *
 * Throws:
 * - `BAD_REQUEST` when the payload agent id is not a non-empty string or differs from `agentId`
 */
export const resolveTriggerSourceEventAgentId = (
  event: Pick<AgentSignalSourceEventInput<AgentSignalTriggerSourceType>, 'payload'>,
  requestedAgentId?: string,
): string | undefined => {
  const payloadAgentId = (event.payload as Record<string, unknown>).agentId;

  if (payloadAgentId === undefined || payloadAgentId === null) return requestedAgentId;

  if (typeof payloadAgentId !== 'string' || payloadAgentId.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'payload agentId must be a string' });
  }

  if (requestedAgentId && payloadAgentId !== requestedAgentId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'payload agentId must match the requested agentId',
    });
  }

  return payloadAgentId;
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

  const isNightlyReview = sourceType === AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested;
  const allowGuardOverride =
    input.allowNightlyReviewGuardOverride ?? isNightlyReviewGuardOverrideAllowedByDefault();
  const lockNightlyReviewGuard = isNightlyReview && !allowGuardOverride;

  // The guard key is derived server-side from the authenticated user, the requested agent and the
  // current date, so repeated manual triggers for one agent collapse onto one review per day.
  if (lockNightlyReviewGuard) {
    for (const key of NIGHTLY_REVIEW_GUARD_OVERRIDE_KEYS) delete override[key];
  }

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
    sourceId: lockNightlyReviewGuard ? defaultSourceId : (input.sourceId ?? defaultSourceId),
    sourceType,
    timestamp: input.timestamp,
  } as AgentSignalSourceEventInput<AgentSignalTriggerSourceType>;
};
