import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoalGraphView } from './goalGraphViewModel';
import { useGoalResultData } from './useGoalResultData';

const mocks = vi.hoisted(() => ({
  getAcceptanceBundle: vi.fn(),
  getCriteria: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/services/verify', () => ({
  verifyService: {
    getAcceptanceBundle: mocks.getAcceptanceBundle,
    getCriteria: mocks.getCriteria,
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );

/** A Goal whose final acceptance Task carries acceptance `acc-1`. */
const graphWith = (acceptanceStatus: string, nodeStatus: string, goalStatus = 'achieved') =>
  ({
    goal: {
      config: { acceptance: { criteriaIds: ['crit-1'] } },
      id: 'goal-1',
      status: goalStatus,
    },
    nodes: [
      {
        acceptance: { id: 'acc-1', status: acceptanceStatus },
        node: {
          id: 'node-acceptance',
          kind: 'task',
          status: nodeStatus,
          title: GOAL_ACCEPTANCE_TASK_TITLE,
        },
      },
    ],
  }) as unknown as GoalGraphView;

const bundle = (status: string) => ({
  acceptance: { status },
  canReview: true,
  checks: [],
  rounds: [],
});

describe('useGoalResultData', () => {
  beforeEach(() => {
    mocks.getAcceptanceBundle.mockReset();
    mocks.getCriteria.mockReset();
    mocks.getCriteria.mockResolvedValue([{ id: 'crit-1', title: 'Works' }]);
  });

  /**
   * Regression: after 提出修改 the rework keeps the same acceptance id, so the
   * bundle stayed on the rejected round — the sign-off bar kept reading 修改中
   * and hid the review actions until a reload.
   */
  it('re-reads the acceptance once the polled graph moves it on after a rework', async () => {
    mocks.getAcceptanceBundle.mockResolvedValueOnce(bundle('rejected'));
    const { rerender, result } = renderHook(({ graph }) => useGoalResultData(graph), {
      initialProps: { graph: graphWith('rejected', 'active') },
      wrapper,
    });
    await waitFor(() => expect(result.current.acceptanceStatus).toBe('rejected'));

    mocks.getAcceptanceBundle.mockResolvedValueOnce(bundle('delivered'));
    rerender({ graph: graphWith('delivered', 'resolved') });

    await waitFor(() => expect(result.current.acceptanceStatus).toBe('delivered'));
    expect(mocks.getAcceptanceBundle).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: a rework ends by putting the Goal back on `achieved` — exactly
   * when the graph poll stops. The snapshot it stops on can still carry the
   * acceptance node's pre-rework status, so keyed on the acceptance alone the
   * bundle stayed on the rejected round: the sign-off strip kept reading 修改中
   * with no accept button, and the criteria count froze at the rework's starting
   * point (2/3) until the page was reloaded. The Goal moving on is its own
   * reason to re-read the latest round.
   */
  it('re-reads the latest round when the Goal returns to achieved after a rework', async () => {
    const criteriaIds = ['crit-1', 'crit-2', 'crit-3'];
    mocks.getCriteria.mockResolvedValue(criteriaIds.map((id) => ({ id, title: id })));

    const reworkGraph = (goalStatus: string) =>
      ({
        goal: { config: { acceptance: { criteriaIds } }, id: 'goal-1', status: goalStatus },
        nodes: [
          {
            // The graph the poll stops on: the Goal has moved back on, the
            // acceptance node still reads the rejected round from the rework.
            acceptance: { id: 'acc-1', status: 'rejected' },
            node: {
              id: 'node-acceptance',
              kind: 'task',
              status: 'active',
              title: GOAL_ACCEPTANCE_TASK_TITLE,
            },
          },
        ],
      }) as unknown as GoalGraphView;

    const round = (id: string, roundIndex: number) => ({ run: { id, roundIndex } });
    const check = (criterionId: string, roundId: string, verdict: string) => ({
      evidence: [],
      id: criterionId,
      result: {
        id: `res-${criterionId}-${roundId}`,
        sourceCriterionId: criterionId,
        status: verdict,
        verdict,
        verifyRunId: roundId,
      },
    });

    mocks.getAcceptanceBundle.mockResolvedValueOnce({
      acceptance: { status: 'rejected' },
      canReview: true,
      checks: [
        check('crit-1', 'run-1', 'passed'),
        check('crit-2', 'run-1', 'passed'),
        check('crit-3', 'run-1', 'failed'),
      ],
      rounds: [round('run-1', 1)],
    });

    const { rerender, result } = renderHook(({ graph }) => useGoalResultData(graph), {
      initialProps: { graph: reworkGraph('running') },
      wrapper,
    });
    await waitFor(() => expect(result.current.acceptanceStatus).toBe('rejected'));
    expect(result.current.outcomes.filter((outcome) => outcome.state === 'passed')).toHaveLength(2);

    // 返工完成：Goal 回到「已达成」，新一轮验收 3/3 落地。
    mocks.getAcceptanceBundle.mockResolvedValueOnce({
      acceptance: { status: 'delivered' },
      canReview: true,
      checks: [
        check('crit-1', 'run-2', 'passed'),
        check('crit-2', 'run-2', 'passed'),
        check('crit-3', 'run-2', 'passed'),
      ],
      rounds: [round('run-1', 1), round('run-2', 2)],
    });
    rerender({ graph: reworkGraph('achieved') });

    await waitFor(() => expect(result.current.acceptanceStatus).toBe('delivered'));
    await waitFor(() =>
      expect(result.current.outcomes.filter((outcome) => outcome.state === 'passed')).toHaveLength(
        3,
      ),
    );
    expect(mocks.getAcceptanceBundle).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: a failed read fell back to empty data, so criteria rendered as
   * unjudged and the sign-off vanished with no error and no way to retry.
   */
  it('reports a failed read instead of passing empty data off as a result', async () => {
    mocks.getAcceptanceBundle.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useGoalResultData(graphWith('delivered', 'resolved')), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    mocks.getAcceptanceBundle.mockResolvedValueOnce(bundle('delivered'));
    await result.current.retry();
    await waitFor(() => expect(result.current.error).toBeUndefined());
    expect(result.current.acceptanceStatus).toBe('delivered');
  });
});
