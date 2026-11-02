import { randomUUID } from 'node:crypto';

import { ABANDONED_OPERATION_ERROR_PREFIX } from '@lobechat/const/goal';
import { ChatErrorType } from '@lobechat/types';

import type { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';

import {
  ASYNC_TOOL_VERIFY_DELAY_MS,
  ASYNC_TOOL_VERIFY_MAX_DELAY_MS,
  STEP_LOCK_RETRY_BASE_DELAY_MS,
  STEP_LOCK_RETRY_MAX_DELAY_MS,
} from './constants';

/**
 * Drop the frozen model facts from a copy of `modelRuntimeConfig`.
 *
 * They exist so a live run's steps stop re-reading the model bank and the
 * user's rows, and the run reads them back off its Redis state. The durable
 * `agent_operations` row and the operation metadata only ever surface the model
 * and provider, so neither needs to keep ~0.5KB of cards per operation — the row
 * keeps them forever.
 */
export const withoutFrozenModelFacts = (modelRuntimeConfig?: any) => {
  if (!modelRuntimeConfig?.modelFacts) return modelRuntimeConfig;
  const { modelFacts: _frozen, ...rest } = modelRuntimeConfig;
  return rest;
};

/**
 * Exponential backoff for the Nth (1-based) lock-conflict re-delivery:
 * 15s, 30s, 60s, 120s, then capped at {@link STEP_LOCK_RETRY_MAX_DELAY_MS}.
 */
export const stepLockRetryDelayMs = (attempt: number): number =>
  Math.min(
    STEP_LOCK_RETRY_BASE_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    STEP_LOCK_RETRY_MAX_DELAY_MS,
  );

/**
 * Exponential backoff delay for the Nth (1-based) watchdog re-check:
 * 15s, 30s, 60s, 120s, 240s, capped at {@link ASYNC_TOOL_VERIFY_MAX_DELAY_MS}.
 */
export const asyncToolVerifyDelayMs = (attempt: number): number =>
  Math.min(
    ASYNC_TOOL_VERIFY_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    ASYNC_TOOL_VERIFY_MAX_DELAY_MS,
  );

export const createStepLockOwner = (operationId: string, stepIndex: number): string =>
  `${operationId}:${stepIndex}:${process.pid}:${Date.now()}:${randomUUID()}`;

/**
 * Format error for storage in message pluginError metadata.
 * Handles Error objects which don't serialize properly with JSON.stringify.
 */
export const formatErrorForMetadata = (error: unknown): Record<string, any> | undefined => {
  if (!error) return undefined;
  if (error instanceof Error) return { message: error.message, name: error.name };
  if (typeof error === 'object' && 'message' in error) return error as Record<string, any>;
  return { message: String(error) };
};

export const SUB_AGENT_CREDIT_ERROR_TYPES = new Set<string>([
  ChatErrorType.FreePlanLimit,
  ChatErrorType.InsufficientBudgetForModel,
  ChatErrorType.SubscriptionPlanLimit,
]);

/**
 * A child stopped by the cost-admission gate fails with the bare message
 * "Budget exceeded", which reads like a per-sub-agent allowance. The parent
 * then retries or fans out more sub-agents against the same limit. Say which
 * limit it is and who can lift it.
 *
 * Mirrors the bot reply copy (`bot/replyTemplate.ts`): the payer is not
 * addressed as "you" and figures are never quoted, because a bot run is billed
 * to its owner while the parent's reply may reach a shared channel.
 */
export const formatSubAgentCreditErrorReason = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return;
  const { body, errorType, type } = error as {
    body?: { budget?: { budgetTypeAtError?: unknown } };
    errorType?: unknown;
    type?: unknown;
  };
  const creditType = [type, errorType].find(
    (value): value is string =>
      typeof value === 'string' && SUB_AGENT_CREDIT_ERROR_TYPES.has(value),
  );
  if (!creditType) return;

  const budgetType = body?.budget?.budgetTypeAtError;
  // InsufficientBudgetForModel means the allowance still has credits, just not
  // enough for this model's estimated cost — a cheaper model may still fit, so
  // the no-retry claim only holds for the same model (bot/replyTemplate gives
  // the same "switch to a less expensive model" advice).
  const modelCostShortfall = creditType === ChatErrorType.InsufficientBudgetForModel;
  const shortfall = modelCostShortfall ? "can't cover this model's estimated cost" : 'are used up';
  const limit =
    budgetType === 'workspace'
      ? `the workspace's shared LobeHub credits ${shortfall}; a workspace admin has to add credits`
      : budgetType === 'workspace_member'
        ? `this member's workspace credit allowance ${modelCostShortfall ? shortfall : 'is used up'}; a workspace admin has to raise it`
        : modelCostShortfall
          ? "the account's LobeHub credits are too low for this model; the account owner has to top up or upgrade"
          : "the account's LobeHub plan limit was reached or the plan does not cover this model; the account owner has to upgrade the plan";

  const advice = modelCostShortfall
    ? 'This limit is shared by every sub-agent and by this conversation, so retrying or dispatching more sub-agents on the same model will not get past it; a sub-agent that runs on a less expensive model may still fit. ' +
      'Otherwise finish with what you already have and tell the user about the limit.'
    : 'This limit is shared by every sub-agent and by this conversation, so retrying or dispatching more sub-agents will not get past it. ' +
      'Finish with what you already have and tell the user about the limit.';

  return `stopped by a LobeHub billing limit (${creditType}): ${limit}. ${advice}`;
};

/**
 * Extract a short, human-readable reason string from a failed operation's
 * `state.error`, for inlining into the tool-result `content` a parent agent
 * sees. Without this the supervising agent only gets the opaque generic note
 * ("Sub-agent did not complete (error).") and cannot tell *why* a `callAgent`
 * dispatch failed — so it can't retry, switch target, or report the cause; it
 * silently falls back to answering itself (issue #16257). The full structured
 * error still rides on `pluginError`; this is just the readable summary.
 */
export const formatSubAgentErrorReason = (error: unknown): string | undefined => {
  const creditReason = formatSubAgentCreditErrorReason(error);
  if (creditReason) return creditReason;

  const message = formatErrorForMetadata(error)?.message;
  if (typeof message !== 'string') return undefined;
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  // "Operation abandoned: inactivity_watchdog" names an internal mechanism;
  // the parent needs to know the child went silent and that its work survives.
  if (trimmed.startsWith(ABANDONED_OPERATION_ERROR_PREFIX)) {
    const cause = trimmed.slice(ABANDONED_OPERATION_ERROR_PREFIX.length).trim();
    return (
      `the sub-agent stopped making progress and the platform ended it (${cause || 'abandoned'}). ` +
      'Anything it already did (searches, pages read, documents written) is kept in its thread.'
    );
  }
  // Keep the tool result compact — a runaway provider error body would otherwise
  // bloat the parent's LLM context.
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
};

export const toAgentSignalSnapshotEvents = (
  emission: Awaited<ReturnType<typeof emitAgentSignalSourceEvent>> | undefined,
) => {
  if (!emission || emission.deduped) return [];

  return toAgentSignalTraceEvents({
    actions: emission.orchestration.actions,
    results: emission.orchestration.results,
    signals: emission.orchestration.emittedSignals,
    source: emission.source,
  });
};
