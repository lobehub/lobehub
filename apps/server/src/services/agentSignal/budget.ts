import debug from 'debug';

import { redisService } from '@/server/services/redis';

import { AGENT_SIGNAL_DEFAULTS } from './constants';

const log = debug('lobe-server:agent-signal:budget');

/**
 * Per-user daily budgets Agent Signal enforces.
 *
 * Only the satisfaction classifier is metered per day; everyday background runs have no count
 * cap, and nightly review is bounded per night by its own topic quota.
 */
export type AgentSignalDailyBudgetKind = 'feedback-classifier';

/** Outcome of one budget acquisition. */
export interface AgentSignalBudgetDecision {
  allowed: boolean;
  /** Counter value after this acquisition, when the store answered. */
  count?: number;
  kind: AgentSignalDailyBudgetKind;
  limit: number;
  /** Why the acquisition was denied. */
  reason?: 'exceeded' | 'unavailable';
}

const DAILY_LIMITS: Record<AgentSignalDailyBudgetKind, number> = {
  'feedback-classifier': AGENT_SIGNAL_DEFAULTS.dailyFeedbackClassifierBudgetPerUser,
};

/** Formats the UTC calendar day used as the budget window, e.g. `2026-10-11`. */
export const toUtcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Takes one unit of a per-user, per-UTC-day Agent Signal budget.
 *
 * Use when:
 * - Agent Signal is about to spend the user's provider credentials on background work
 *
 * Expects:
 * - `userId` is the owner whose credentials the work bills to
 *
 * Returns:
 * - `allowed: true` while the user is within the day's limit
 * - `allowed: false` with `reason: 'exceeded'` once over the limit
 * - `allowed: false` with `reason: 'unavailable'` when Redis is missing or errors
 *
 * Fails closed on purpose: this is optional background work billed to the user, so an
 * unenforceable budget skips the work instead of running it unbounded. Without Redis the
 * source-event dedupe already drops every event, so no working setup loses anything.
 */
export const acquireAgentSignalDailyBudget = async (input: {
  kind: AgentSignalDailyBudgetKind;
  now?: number;
  userId: string;
}): Promise<AgentSignalBudgetDecision> => {
  const limit = DAILY_LIMITS[input.kind];

  let count: number | undefined;
  try {
    count = await redisService.agentSignal.countClassifierCall({
      userId: input.userId,
      utcDay: toUtcDay(input.now ?? Date.now()),
    });
  } catch (error) {
    console.error('[AgentSignal] Failed to read daily budget, skipping work:', {
      error,
      kind: input.kind,
      userId: input.userId,
    });

    return { allowed: false, kind: input.kind, limit, reason: 'unavailable' };
  }

  if (count === undefined) {
    log('budget store unavailable kind=%s user=%s', input.kind, input.userId);

    return { allowed: false, kind: input.kind, limit, reason: 'unavailable' };
  }

  if (count > limit) {
    log(
      'budget exceeded kind=%s user=%s count=%d limit=%d',
      input.kind,
      input.userId,
      count,
      limit,
    );

    return { allowed: false, count, kind: input.kind, limit, reason: 'exceeded' };
  }

  return { allowed: true, count, kind: input.kind, limit };
};

/**
 * Describes a denied budget decision for skip details and runtime traces.
 *
 * Before:
 * - `{ kind: 'feedback-classifier', limit: 200, reason: 'exceeded' }`
 *
 * After:
 * - `"Daily Agent Signal feedback-classifier budget exceeded (200/day)."`
 */
export const describeBudgetDenial = (decision: AgentSignalBudgetDecision) =>
  decision.reason === 'exceeded'
    ? `Daily Agent Signal ${decision.kind} budget exceeded (${decision.limit}/day).`
    : `Daily Agent Signal ${decision.kind} budget unavailable; skipped to stay within budget.`;
