import debug from 'debug';
import pMap from 'p-map';

import { GoalModel } from '@/database/models/goal';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

import { advanceGoal } from './advanceGoal';
import { GOAL_ADVANCE_PATH } from './scheduler';
import { GoalSubscriptionService } from './subscriptions';

let subscriptionAfter: string | undefined;

const log = debug('lobe-server:workflows:goal:sweep');

/**
 * How long a Work may hold its operation lease before the sweep treats the goal
 * as stalled. Above the coordinator's own claim TTL so a healthy run is never
 * swept while it is between heartbeats.
 */
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/** Goals advanced at once: each advance reads and writes the graph and may start Work. */
const ADVANCE_CONCURRENCY = 5;
/** Concurrent QStash publishes in queue mode. */
const PUBLISH_CONCURRENCY = 10;

const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ reason, status: 'rejected' }),
  );

export interface GoalSweepPayload {
  /** Only report what would be advanced. */
  dryRun?: boolean;
  limit?: number;
  /** Override the stale window, in milliseconds. */
  staleAfterMs?: number;
}

export interface GoalSweepResult {
  advanced: number;
  dryRun?: boolean;
  stalled: number;
  success: true;
}

/**
 * Cron-style safety net for goal advancement.
 *
 * The fast path is event-driven — creating a goal, resolving a gate, or a Work
 * Task settling all queue an advance. This sweep exists because that path can
 * be missed: a queue message can be dropped, a runner can die between
 * dispatching a Work and writing its outcome, and a Work can outlive its
 * operation lease with nobody left to reclaim it. Without it, one lost message
 * strands a long-horizon goal forever.
 *
 * Driven by the QStash Schedule `lobe-goal-sweep` through `/api/workflows/goal/sweep`
 * (signature-verified by `qstashAuth`), or, on a long-running server without
 * QStash, by the built-in scheduler (`services/builtinScheduler`). Global scan,
 * no per-user auth.
 */
export async function sweepGoals(payload: GoalSweepPayload = {}): Promise<GoalSweepResult> {
  const { dryRun = false, limit = 200, staleAfterMs = DEFAULT_STALE_AFTER_MS } = payload;

  const db = await getServerDB();
  if (!dryRun)
    subscriptionAfter = await GoalSubscriptionService.reconcile(
      db,
      subscriptionAfter,
      Math.min(limit, 100),
    );
  const stalled = await GoalModel.listStalled(db, {
    limit,
    staleBefore: new Date(Date.now() - staleAfterMs),
  });

  log('scan: stalled=%d dryRun=%s', stalled.length, dryRun);

  if (dryRun || stalled.length === 0) {
    return { advanced: 0, dryRun, stalled: stalled.length, success: true };
  }

  const advanced = await fanout(
    stalled.map((goal) => ({
      goalId: goal.id,
      trigger: 'sweep' as const,
      userId: goal.userId,
      workspaceId: goal.workspaceId ?? undefined,
    })),
  );

  return { advanced, stalled: stalled.length, success: true };
}

interface StalledGoal {
  goalId: string;
  trigger: 'sweep';
  userId: string;
  workspaceId?: string;
}

/**
 * Hand each goal off individually so one that throws cannot take the sweep
 * down with it, and so each gets its own retry budget in queue mode.
 */
const fanout = async (goals: StalledGoal[]): Promise<number> => {
  const results = appEnv.enableQueueAgentRuntime
    ? await publishAll(goals)
    : await pMap(goals, (goal) => settle(advanceGoal(goal)), { concurrency: ADVANCE_CONCURRENCY });

  let advanced = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') advanced += 1;
    else
      console.error('[goal/sweep] advance failed goal=%s: %O', goals[index].goalId, result.reason);
  }
  return advanced;
};

const publishAll = async (goals: StalledGoal[]) => {
  if (!process.env.APP_URL) {
    throw new Error('APP_URL is required to fan out goal advances via QStash');
  }
  const url = `${process.env.APP_URL.replace(/\/$/, '')}${GOAL_ADVANCE_PATH}`;

  return pMap(goals, (body) => settle(qstashClient.publishJSON({ body, url })), {
    concurrency: PUBLISH_CONCURRENCY,
  });
};
