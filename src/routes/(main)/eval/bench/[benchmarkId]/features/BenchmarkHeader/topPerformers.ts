import type { AgentEvalRunListItem } from '@lobechat/types';

import { contenderKeyOf, contenderName } from '@/features/LobeBench/benchmarkRanking';

export interface TopPerformer {
  avgPassRate: number;
  name: string;
}

/**
 * The best performers of completed runs, by average pass rate. A run of an
 * Agent stands for that Agent; a run of a bare model (Lobe Bench) stands for
 * its contender, the model with its settings, under the run's name.
 */
export const topPerformersOf = (runs: AgentEvalRunListItem[], limit = 3): TopPerformer[] => {
  const groups = new Map<string, { name: string; passRates: number[] }>();
  for (const run of runs) {
    const agentId = run.targetAgentId || run.targetAgent?.id;
    const key = agentId ? `agent:${agentId}` : `contender:${contenderKeyOf(run)}`;
    const name = run.targetAgent?.title || run.targetAgent?.id || contenderName(run);
    const group = groups.get(key) ?? { name, passRates: [] };
    group.passRates.push(run.passRate ?? run.metrics?.passRate ?? 0);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ name, passRates }) => ({
      avgPassRate: passRates.reduce((a, b) => a + b, 0) / passRates.length,
      name,
    }))
    .sort((a, b) => b.avgPassRate - a.avgPassRate)
    .slice(0, limit);
};
