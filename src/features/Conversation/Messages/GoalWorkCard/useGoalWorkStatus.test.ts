import type { GoalGraphSnapshot } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalWorkStatus } from './useGoalWorkStatus';

const mocks = vi.hoisted(() => ({
  goalGraphById: {} as Record<string, unknown>,
  useFetchGoalGraph: vi.fn(),
}));

vi.mock('@/store/goal', () => ({
  goalSelectors: {
    goalGraph: (goalId?: string | null) => (state: { goalGraphById: Record<string, unknown> }) =>
      goalId ? state.goalGraphById[goalId] : undefined,
  },
  useGoalStore: (selector: (state: unknown) => unknown) =>
    selector({
      goalGraphById: mocks.goalGraphById,
      useFetchGoalGraph: mocks.useFetchGoalGraph,
    }),
}));

const node = (id: string, kind: string, status: string) => ({ id, kind, status });

const snapshot = (overrides: Partial<GoalGraphSnapshot> = {}) =>
  ({
    decisions: [],
    edges: [],
    events: [],
    goal: {
      agentId: 'agt-1',
      id: 'goal-1',
      startedAt: new Date('2026-08-14T08:00:00.000Z'),
      status: 'running',
      title: 'Reproduce nanoGPT',
    },
    nodes: [],
    workVersions: [],
    ...overrides,
  }) as unknown as GoalGraphSnapshot;

describe('useGoalWorkStatus', () => {
  beforeEach(() => {
    mocks.goalGraphById = {};
    vi.clearAllMocks();
  });

  it('falls back to the drafted criteria count until the graph resolves', () => {
    const { result } = renderHook(() => useGoalWorkStatus({ criteriaCount: 3, goalId: 'goal-1' }));

    expect(mocks.useFetchGoalGraph).toHaveBeenCalledWith('goal-1');
    expect(result.current.progress).toMatchObject({ phase: 'running', total: 3 });
    expect(result.current.title).toBeUndefined();
  });

  it('counts every terminal Work node as closed', () => {
    mocks.goalGraphById['goal-1'] = snapshot({
      nodes: [
        node('w1', 'task', 'resolved'),
        node('w2', 'task', 'retired'),
        node('w3', 'task', 'active'),
        node('f1', 'finding', 'resolved'),
      ] as never,
    });

    const { result } = renderHook(() => useGoalWorkStatus({ goalId: 'goal-1' }));

    expect(result.current.progress).toMatchObject({ passed: 2, total: 3 });
    expect(result.current.agentId).toBe('agt-1');
    expect(result.current.title).toBe('Reproduce nanoGPT');
  });

  it('reads a pending gate as waiting on the user', () => {
    mocks.goalGraphById['goal-1'] = snapshot({
      decisions: [{ status: 'pending' }] as never,
      nodes: [node('w1', 'task', 'active')] as never,
    });

    const { result } = renderHook(() => useGoalWorkStatus({ goalId: 'goal-1' }));

    expect(result.current.progress.phase).toBe('waiting');
  });
});
