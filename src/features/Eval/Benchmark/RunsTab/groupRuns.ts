import type { AgentEvalRunListItem } from '@lobechat/types';

export interface RunGroup {
  agentId?: string | null;
  agentTitle?: string;
  /** Creation time of the batch's first run. */
  createdAt: number;
  datasetId: string;
  datasetName?: string;
  key: string;
  runs: AgentEvalRunListItem[];
}

/**
 * Runs of one agent × dataset created this close together came from one
 * "create run" with several models (the server creates them back to back).
 */
export const BATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * A cross-model comparison re-issues frozen calls instead of running an agent;
 * it has no agent or subject model to group by and lives on its own page.
 */
export const isReplayRun = (run: Pick<AgentEvalRunListItem, 'config'>) =>
  run.config?.executionMode === 'replay';

const time = (date?: Date | string) => (date ? new Date(date).getTime() : 0);

/**
 * Pass rate (0–1) of a run with at least one judged case, else undefined — a
 * run whose cases all errored has no pass rate, not a 0% one.
 */
export const getRunPassRate = (run: AgentEvalRunListItem): number | undefined => {
  const metrics = run.metrics;
  const judged = (metrics?.passedCases ?? 0) + (metrics?.failedCases ?? 0);
  if (judged === 0) return undefined;
  return metrics?.passRate ?? run.passRate ?? undefined;
};

const byResult = (a: AgentEvalRunListItem, b: AgentEvalRunListItem) => {
  const pa = getRunPassRate(a);
  const pb = getRunPassRate(b);
  if (pa !== undefined && pb !== undefined && pa !== pb) return pb - pa;
  if (pa !== undefined && pb === undefined) return -1;
  if (pa === undefined && pb !== undefined) return 1;
  return time(b.createdAt) - time(a.createdAt);
};

/**
 * Line up runs that share agent × dataset × creation batch, so one agent
 * evaluated on several models reads as a side-by-side comparison. Groups are
 * ordered newest first; inside a group the best pass rate leads and runs
 * without a result come last.
 */
export const groupRuns = (runs: AgentEvalRunListItem[]): RunGroup[] => {
  const buckets = new Map<string, AgentEvalRunListItem[]>();

  for (const run of runs) {
    if (isReplayRun(run)) continue;
    const agentId = run.targetAgentId ?? run.targetAgent?.id ?? '';
    const key = `${run.datasetId}::${agentId}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(run);
    else buckets.set(key, [run]);
  }

  const groups: RunGroup[] = [];

  for (const [bucketKey, bucket] of buckets) {
    const ordered = [...bucket].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    let current: AgentEvalRunListItem[] = [];
    let last = Number.NEGATIVE_INFINITY;

    const flush = () => {
      if (current.length === 0) return;
      const first = current[0];
      groups.push({
        agentId: first.targetAgentId ?? first.targetAgent?.id ?? null,
        agentTitle: first.targetAgent?.title ?? first.config?.agentSnapshot?.title ?? undefined,
        createdAt: time(first.createdAt),
        datasetId: first.datasetId,
        datasetName: first.datasetName,
        key: `${bucketKey}::${first.id}`,
        runs: [...current].sort(byResult),
      });
      current = [];
    };

    for (const run of ordered) {
      const at = time(run.createdAt);
      if (at - last > BATCH_WINDOW_MS) flush();
      current.push(run);
      last = at;
    }
    flush();
  }

  return groups.sort((a, b) => b.createdAt - a.createdAt);
};
