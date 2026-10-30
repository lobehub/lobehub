export interface ProbeShardBudget {
  maxProbesPerShard: number;
  maxRunDurationMs: number;
  maxShardDurationMs: number;
  maxShards: number;
  probeReserveMs: number;
}

const diagnosticBudget: Readonly<ProbeShardBudget> = Object.freeze({
  maxProbesPerShard: 64,
  maxRunDurationMs: 15 * 60_000,
  maxShardDurationMs: 30_000,
  maxShards: 16,
  probeReserveMs: 3000,
});

interface ProbeShard {
  completedProbeIds: string[];
  durationMs: number;
  id: string;
  probeIds: string[];
  status: 'RUNNING' | 'COMPLETED' | 'BUDGET_EXCEEDED' | 'ERROR';
  variant: string;
}

/** In-process execution only: not an ingestion/approval API for remote shards.
 * Tests may tighten budgets, never expand the trusted diagnostic bounds. */
export const createProbeShardController = (
  options: { budget?: Partial<ProbeShardBudget>; clock?: () => number } = {},
) => {
  const budget = Object.freeze({ ...diagnosticBudget, ...options.budget });
  if (
    Object.entries(budget).some(
      ([key, value]) =>
        !Number.isSafeInteger(value) ||
        value < (key === 'probeReserveMs' ? 0 : 1) ||
        value > diagnosticBudget[key as keyof ProbeShardBudget],
    ) ||
    budget.probeReserveMs >= Math.min(budget.maxShardDurationMs, budget.maxRunDurationMs)
  )
    throw new Error('INVALID_PROBE_SHARD_BUDGET');
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const shards: ProbeShard[] = [];
  const gaps = new Set<string>();
  const attempted = new Set<string>();
  const completed = new Set<string>();
  let active: { pending?: string; shard: ProbeShard; started: number } | undefined;

  const closeShard = () => {
    if (!active) return;
    active.shard.durationMs = clock() - active.started;
    if (active.pending) {
      active.shard.status = 'ERROR';
      gaps.add('PROBE_SHARD_INCOMPLETE');
    } else if (active.shard.durationMs > budget.maxShardDurationMs) {
      active.shard.status = 'BUDGET_EXCEEDED';
      gaps.add('PROBE_SHARD_TIME_BUDGET_EXCEEDED');
    } else active.shard.status = 'COMPLETED';
    active = undefined;
  };
  const remaining = () => {
    if (!active?.pending) throw new Error('PROBE_NOT_RUNNING');
    const now = clock();
    if (now >= started + budget.maxRunDurationMs) throw new Error('PROBE_RUN_TIME_BUDGET_EXCEEDED');
    const milliseconds =
      Math.min(started + budget.maxRunDurationMs, active.started + budget.maxShardDurationMs) - now;
    if (milliseconds <= 0) throw new Error('PROBE_SHARD_TIME_BUDGET_EXCEEDED');
    return milliseconds;
  };

  return {
    budget,
    capacity: budget.maxProbesPerShard * budget.maxShards,
    beginProbe: (id: string, variant: string) => {
      if (attempted.has(id)) throw new Error('DUPLICATE_PROBE_EXECUTION');
      if (active?.pending) throw new Error('PROBE_ALREADY_RUNNING');
      const now = clock();
      if (now - started >= budget.maxRunDurationMs - budget.probeReserveMs) {
        closeShard();
        gaps.add('PROBE_RUN_TIME_BUDGET_EXCEEDED');
        return undefined;
      }
      if (
        active &&
        (active.shard.variant !== variant ||
          active.shard.probeIds.length >= budget.maxProbesPerShard ||
          now - active.started >= budget.maxShardDurationMs - budget.probeReserveMs)
      )
        closeShard();
      const newShard = !active;
      if (!active) {
        if (shards.length >= budget.maxShards) {
          gaps.add('PROBE_SHARD_COUNT_BUDGET_EXCEEDED');
          return undefined;
        }
        const shard: ProbeShard = {
          completedProbeIds: [],
          durationMs: 0,
          id: `shard-${shards.length + 1}`,
          probeIds: [],
          status: 'RUNNING',
          variant,
        };
        active = { shard, started: now };
        shards.push(shard);
      }
      attempted.add(id);
      active.pending = id;
      active.shard.probeIds.push(id);
      return { newShard, shardId: active.shard.id };
    },
    remaining,
    runOperation: async <T>(operation: () => Promise<T>): Promise<T> => {
      // Check before invoking the operation: an already-created Promise would
      // start browser work even if reading the remaining budget then throws.
      const milliseconds = remaining();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('BROWSER_OPERATION_TIMEOUT')), milliseconds);
        });
        return await Promise.race([operation(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    completeProbe: (id: string) => {
      if (active?.pending !== id) throw new Error('PROBE_COMPLETION_MISMATCH');
      active.pending = undefined;
      active.shard.completedProbeIds.push(id);
      completed.add(id);
    },
    closeShard,
    report: (plannedProbeIds: string[]) => {
      const planned = new Set(plannedProbeIds);
      if (planned.size !== plannedProbeIds.length) throw new Error('DUPLICATE_PLANNED_PROBE');
      if ([...attempted].some((id) => !planned.has(id)))
        throw new Error('EXECUTED_PROBE_NOT_PLANNED');
      closeShard();
      if (clock() - started > budget.maxRunDurationMs) gaps.add('PROBE_RUN_TIME_BUDGET_EXCEEDED');
      const unexecutedProbeIds = plannedProbeIds.filter((id) => !completed.has(id));
      if (unexecutedProbeIds.length) gaps.add('PROBE_EXECUTION_INCOMPLETE');
      return {
        budget,
        durationMs: clock() - started,
        gaps: [...gaps],
        gateEligible: false as const,
        mode: 'bounded-in-process-shards' as const,
        plannedProbeIds,
        shards,
        summary: {
          completedProbes: completed.size,
          completedShards: shards.filter((shard) => shard.status === 'COMPLETED').length,
          failedShards: shards.filter((shard) => shard.status !== 'COMPLETED').length,
          plannedProbes: plannedProbeIds.length,
          shards: shards.length,
          unexecutedProbes: unexecutedProbeIds.length,
        },
        unexecutedProbeIds,
      };
    },
  };
};
