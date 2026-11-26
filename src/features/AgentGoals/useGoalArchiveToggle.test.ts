import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalArchiveToggle } from './useGoalArchiveToggle';

const mocks = vi.hoisted(() => ({
  canManage: true,
  store: { archiveGoal: vi.fn() },
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('@lobehub/ui', () => ({ toast: mocks.toast }));
vi.mock('@/store/goal', () => ({
  useGoalStore: (selector: (s: typeof mocks.store) => unknown) => selector(mocks.store),
}));
vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.canManage,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const base = { creatorUserId: 'user_1', goalId: 'goal_1' };

describe('useGoalArchiveToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canManage = true;
    mocks.store.archiveGoal.mockResolvedValue(undefined);
  });

  it('archives a completed goal and reports it', async () => {
    const onArchived = vi.fn();
    const { result } = renderHook(() =>
      useGoalArchiveToggle({ ...base, archivedAt: null, onArchived, status: 'achieved' }),
    );

    expect(result.current).toMatchObject({
      deniedReason: undefined,
      isArchived: false,
      label: 'goalList.archive',
    });
    await act(() => result.current.toggle());

    expect(mocks.store.archiveGoal).toHaveBeenCalledWith('goal_1', true);
    expect(mocks.toast.success).toHaveBeenCalledWith('goalList.archiveSuccess');
    expect(onArchived).toHaveBeenCalled();
  });

  it('restores an archived goal whatever its status', async () => {
    const { result } = renderHook(() =>
      useGoalArchiveToggle({ ...base, archivedAt: '2026-11-03T00:00:00.000Z', status: 'running' }),
    );

    expect(result.current).toMatchObject({ deniedReason: undefined, label: 'goalList.unarchive' });
    await act(() => result.current.toggle());

    expect(mocks.store.archiveGoal).toHaveBeenCalledWith('goal_1', false);
  });

  it('only repeats why a goal still in flight cannot be archived', async () => {
    const { result } = renderHook(() =>
      useGoalArchiveToggle({ ...base, archivedAt: null, status: 'running' }),
    );

    expect(result.current.deniedReason).toBe('goalList.archiveBlocked');
    await act(() => result.current.toggle());

    expect(mocks.store.archiveGoal).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalledWith('goalList.archiveBlocked');
  });

  it('refuses a member who may not manage the goal', async () => {
    mocks.canManage = false;
    const { result } = renderHook(() =>
      useGoalArchiveToggle({ ...base, archivedAt: null, status: 'achieved' }),
    );

    await act(() => result.current.toggle());

    expect(mocks.store.archiveGoal).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalledWith('goalList.archiveDenied');
  });

  it('reports a failed archive', async () => {
    mocks.store.archiveGoal.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useGoalArchiveToggle({ ...base, archivedAt: null, status: 'canceled' }),
    );

    await act(() => result.current.toggle());

    expect(mocks.toast.error).toHaveBeenCalledWith('goalList.archiveFailed');
  });
});
