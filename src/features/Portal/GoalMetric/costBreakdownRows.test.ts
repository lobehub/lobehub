import type { GoalSpend } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

import { costBreakdownColumns, costBreakdownRows } from './costBreakdownRows';

const graph = (taskIds: string[]) =>
  ({
    nodes: taskIds.map((taskId, index) => ({ node: { taskId, title: `Task ${index}` } })),
  }) as unknown as GoalGraphView;

const spend = (byTask: GoalSpend['byTask']) =>
  ({ byTask, runs: byTask.length, totalCost: 0, totalTokens: 0 }) as GoalSpend;

describe('costBreakdownRows', () => {
  // Regression: a local helper only ever divided by 1000, so a Task that used
  // 98,445,300 tokens read "98445.3k tokens".
  it('climbs the token units K → M → B', () => {
    const rows = costBreakdownRows(
      graph(['a', 'b', 'c', 'd']),
      spend([
        { runs: 1, taskId: 'a', totalCost: 29.25, totalTokens: 98_445_300 },
        { runs: 1, taskId: 'b', totalCost: 3, totalTokens: 12_400 },
        { runs: 1, taskId: 'c', totalCost: 2, totalTokens: 1_250_000_000 },
        { runs: 1, taskId: 'd', totalCost: 1, totalTokens: 640 },
      ]),
    );

    expect(rows.map((row) => row.tokensLabel)).toEqual(['98.4M', '12.4K', '1.3B', '640']);
  });

  it('orders by spend, then tokens, and keeps unsettled Tasks at $0', () => {
    const rows = costBreakdownRows(
      graph(['a', 'b']),
      spend([
        { runs: 1, taskId: 'unsettled', totalCost: 0, totalTokens: 82_027_400 },
        { runs: 1, taskId: 'b', totalCost: 11.03, totalTokens: 31_323_400 },
        { runs: 1, taskId: 'a', totalCost: 0, totalTokens: 20_815_400 },
      ]),
    );

    expect(rows.map((row) => row.taskId)).toEqual(['b', 'unsettled', 'a']);
    expect(rows.find((row) => row.taskId === 'unsettled')?.view).toBeUndefined();
    expect(rows.find((row) => row.taskId === 'a')?.view?.node.title).toBe('Task 0');
  });
});

describe('costBreakdownColumns', () => {
  // Regression: each figure hugged its own text, so `12.4K` sat a character
  // off from `98.4M` and a wider cost shifted its row's tokens left.
  it('sizes each column to its longest value so every row right-aligns', () => {
    const rows = costBreakdownRows(
      graph(['a', 'b', 'c']),
      spend([
        { runs: 1, taskId: 'a', totalCost: 118.31, totalTokens: 98_445_300 },
        { runs: 1, taskId: 'b', totalCost: 0.38, totalTokens: 12_400 },
        { runs: 1, taskId: 'c', totalCost: 0, totalTokens: 640 },
      ]),
    );

    expect(rows.map((row) => row.costLabel)).toEqual(['$118.31', '$0.38', '$0']);
    expect(costBreakdownColumns(rows)).toEqual({ cost: '7ch', tokens: '5ch' });
  });
});
