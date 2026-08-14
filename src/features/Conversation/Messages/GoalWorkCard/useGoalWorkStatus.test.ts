import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalWorkStatus } from './useGoalWorkStatus';

const mocks = vi.hoisted(() => ({
  taskDetailMap: {} as Record<string, { config?: unknown; name?: string; startedAt?: string }>,
  useAcceptanceBundle: vi.fn(() => ({ data: undefined })),
  useAcceptanceBySubject: vi.fn(() => ({ data: undefined })),
  useFetchTaskDetail: vi.fn(),
}));

vi.mock('@/features/Verify', () => ({
  useAcceptanceBundle: mocks.useAcceptanceBundle,
  useAcceptanceBySubject: mocks.useAcceptanceBySubject,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: unknown) => unknown) =>
    selector({
      taskDetailMap: mocks.taskDetailMap,
      useFetchTaskDetail: mocks.useFetchTaskDetail,
    }),
}));

describe('useGoalWorkStatus', () => {
  beforeEach(() => {
    mocks.taskDetailMap = {};
    vi.clearAllMocks();
  });

  it('does not poll acceptance for a plain task callback', () => {
    mocks.taskDetailMap['T-1'] = { config: {} };

    const { result } = renderHook(() => useGoalWorkStatus({ identifier: 'T-1', taskId: 'task-1' }));

    expect(result.current.isGoal).toBe(false);
    expect(mocks.useAcceptanceBySubject).toHaveBeenCalledWith('task', null);
  });

  it('polls acceptance after task detail identifies a Goal task', () => {
    mocks.taskDetailMap['T-2'] = {
      config: { goal: {} },
      startedAt: '2026-08-14T08:00:00.000Z',
    };

    const { result } = renderHook(() => useGoalWorkStatus({ identifier: 'T-2', taskId: 'task-2' }));

    expect(result.current.isGoal).toBe(true);
    expect(result.current.startedAt).toBe('2026-08-14T08:00:00.000Z');
    expect(mocks.useAcceptanceBySubject).toHaveBeenCalledWith('task', 'task-2');
  });

  it('keeps polling for a Goal tracker before task detail loads', () => {
    renderHook(() => useGoalWorkStatus({ goalKnown: true, identifier: 'T-3', taskId: 'task-3' }));

    expect(mocks.useAcceptanceBySubject).toHaveBeenCalledWith('task', 'task-3');
  });
});
