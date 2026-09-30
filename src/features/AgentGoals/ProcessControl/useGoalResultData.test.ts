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
const graphWith = (acceptanceStatus: string, nodeStatus: string) =>
  ({
    goal: { config: { acceptance: { criteriaIds: ['crit-1'] } }, id: 'goal-1' },
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
