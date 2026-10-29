import type { GoalSpend } from '@lobechat/types';
import { formatUsageValue } from '@lobechat/utils';

import { formatUsd } from '@/features/AgentGoals/goalPresentation';
import type { GoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

/**
 * The per-Task rows of the budget panel, ordered by spend. A Task whose runs
 * have not settled keeps its row at $0: it is still consuming rounds. Token
 * counts are read for magnitude, so they climb K → M → B like every other
 * token count in the product.
 */
export const costBreakdownRows = (graph: GoalGraphView, spend?: GoalSpend) => {
  const nodeByTaskId = new Map(
    graph.nodes
      .filter((view) => view.node.taskId)
      .map((view) => [view.node.taskId!, view] as const),
  );
  return (spend?.byTask ?? [])
    .map((row) => ({
      ...row,
      costLabel: formatUsd(row.totalCost),
      tokensLabel: formatUsageValue(row.totalTokens),
      view: nodeByTaskId.get(row.taskId),
    }))
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);
};

/**
 * The widths of the token and cost columns. Both figures are monospace, so a
 * column as wide as its longest value in `ch` right-aligns every row: `12.4K`
 * sits under `98.4M`, and a `$118.31` row does not push its tokens left.
 */
export const costBreakdownColumns = (rows: ReturnType<typeof costBreakdownRows>) => ({
  cost: `${Math.max(0, ...rows.map((row) => row.costLabel.length))}ch`,
  tokens: `${Math.max(0, ...rows.map((row) => row.tokensLabel.length))}ch`,
});
