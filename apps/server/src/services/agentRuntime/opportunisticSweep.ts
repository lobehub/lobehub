import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { after } from '@/server/utils/scheduleAfterResponse';

import { StaleOperationReaper } from './StaleOperationReaper';

const log = debug('lobe-server:agent-runtime:opportunistic-sweep');

/**
 * Minimum spacing between two opportunistic sweeps, cluster-wide.
 *
 * One minute is the granularity the recovery needs: the reaper only considers a
 * run whose durable lease has been quiet for five minutes, and the gateway's
 * inactivity watchdog (the destructive path this exists to beat) waits thirty.
 */
export const OPPORTUNISTIC_SWEEP_INTERVAL_MS = 60_000;

/**
 * The Redis slot that decides which caller sweeps. Claimed with
 * `SET key … PX <interval> NX`: whoever sets it wins exactly one sweep, and no
 * other caller — another instance, another request, another inlined step — can
 * claim again until the TTL expires.
 */
export const OPPORTUNISTIC_SWEEP_SLOT_KEY = 'agent_runtime:stale_sweep:slot';

export interface OpportunisticSweepDeps {
  /** Resolves true for exactly one caller per interval, cluster-wide. */
  claim: () => Promise<boolean>;
  onError?: (error: unknown, phase: 'claim' | 'sweep') => void;
  sweep: () => Promise<unknown>;
}

/**
 * Run the stale-operation sweep at most once per interval, best-effort.
 *
 * Returns whether this caller won the slot, and therefore swept.
 *
 * Never throws: this is background repair riding on someone else's request, so
 * a sweep that fails (Redis blip, a poisoned row) must not surface as a failure
 * of the delivery that carried it, and a slot it failed to claim must not
 * either. `StaleOperationReaper.sweep` already isolates per-candidate failures;
 * this handles the failures outside that loop.
 */
export async function runOpportunisticSweep({
  claim,
  sweep,
  onError,
}: OpportunisticSweepDeps): Promise<boolean> {
  let claimed: boolean;
  try {
    claimed = await claim();
  } catch (error) {
    onError?.(error, 'claim');
    return false;
  }

  if (!claimed) return false;

  try {
    await sweep();
  } catch (error) {
    onError?.(error, 'sweep');
  }

  return true;
}

/**
 * Recover operations whose executing host died mid-step, without depending on a
 * scheduler being configured.
 *
 * `StaleOperationReaper` is the correct recovery for a run whose next step
 * never ran. It is deliberately conservative: it holds no authority over a run
 * it cannot resume, it prefers re-queueing the next step from Redis state over
 * reporting a death, and it only abandons once its redrive budget is spent.
 *
 * Its only entry point is the Vercel cron `/api/agent/reap-operations`, and the
 * project that deploys this server has **no `crons` entry** for that route — so
 * in production the sweep exists but is never invoked. That is not a cosmetic
 * gap. A run whose step-to-step handoff dies leaves its durable row `running`
 * with a frozen lease; nothing redrives it, and the only thing that eventually
 * notices is the gateway's *destructive* inactivity watchdog, which rewrites
 * the turn as `Operation abandoned: inactivity_watchdog` and finalizes the
 * trace as a failure. Observed 2026-10-02, one user in one afternoon:
 *
 * - four such runs, every one of them ending on a step that had asked for a
 *   device `runCommand` (waiting on CI) — the largest was 94 minutes and 521
 *   steps, and the watchdog killed it mid-task;
 * - the same topic was killed twice, hours apart.
 *
 * So run the same sweep from a path that is always exercised — the agent step
 * delivery — at most once per interval, cluster-wide.
 *
 * Deliberately not awaited by the caller. This must never add latency to, or
 * fail, a step delivery; that is also why it does not join the step loop's
 * `runWithScheduledWorkScope` (whose boundary flush would then wait on it).
 */
export const scheduleOpportunisticStaleSweep = (): void => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;

  after(() =>
    runOpportunisticSweep({
      claim: async () => {
        const claimed = await redis.set(
          OPPORTUNISTIC_SWEEP_SLOT_KEY,
          String(Date.now()),
          'PX',
          OPPORTUNISTIC_SWEEP_INTERVAL_MS,
          'NX',
        );

        return claimed === 'OK';
      },
      onError: (error, phase) => {
        // A failed tick is invisible by design (the delivery that hosted it
        // succeeded), so log it loudly enough to be found from the timeline.
        console.error(`[opportunistic-sweep] ${phase} failed: %O`, error);
      },
      sweep: async () => {
        const result = await new StaleOperationReaper(await getServerDB()).sweep();
        log('sweep: %O', result);
      },
    }),
  );
};
