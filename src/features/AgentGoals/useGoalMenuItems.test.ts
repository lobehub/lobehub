import type { DropdownItem } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalItemMenu } from './useGoalMenuItems';

const mocks = vi.hoisted(() => ({
  confirmDelete: vi.fn(),
  deleteOptions: undefined as { onDeleted?: () => void } | undefined,
  navigate: vi.fn(),
  store: {
    closeGoal: vi.fn(),
    pauseGoal: vi.fn(),
    refreshGoals: vi.fn(),
    resumeGoal: vi.fn(),
    startGoal: vi.fn(),
  },
  transferItems: null as DropdownItem[] | null,
}));

vi.mock('@/business/client/hooks/useGoalTransferMenuItem', () => ({
  useGoalTransferMenuItem: () => mocks.transferItems,
}));

vi.mock('@/store/goal', () => ({
  useGoalStore: (selector: (s: typeof mocks.store) => unknown) => selector(mocks.store),
}));
vi.mock('@/hooks/useResourceManageable', () => ({ useResourceManageable: () => true }));
vi.mock('./useGoalActions', () => ({
  useConfirmDeleteGoal: (options: { onDeleted?: () => void }) => {
    mocks.deleteOptions = options;
    return mocks.confirmDelete;
  },
  useGoalShareUrl: () => 'https://app.lobehub.com/goal/goal_1',
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const goal = { agentId: 'agt_1', id: 'goal_1', status: 'running', userId: 'user_1' };

const pickStatus = (items: DropdownItem[], next: string) => {
  const status = items.find((item) => item && 'key' in item && item.key === 'status') as any;
  const choice = status.children.find((child: any) => child.key === `status-${next}`);
  return choice.onClick();
};

describe('useGoalItemMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transferItems = null;
    mocks.store.pauseGoal.mockResolvedValue(undefined);
    mocks.store.resumeGoal.mockResolvedValue(undefined);
  });

  // The row renders its status from the list, which the store's status
  // actions do not refresh: without the refetch the row keeps the old status.
  it('refetches the project list a status change was made from', async () => {
    const { result } = renderHook(() =>
      useGoalItemMenu({ agentId: 'agt_1', goal, projectId: 'proj_1' }),
    );

    await act(async () => pickStatus(result.current, 'paused'));

    expect(mocks.store.pauseGoal).toHaveBeenCalledWith('goal_1');
    expect(mocks.store.refreshGoals).toHaveBeenCalledWith('project:proj_1');
  });

  it("refetches the agent's list on an agent page", async () => {
    const { result } = renderHook(() =>
      useGoalItemMenu({
        agentId: 'agt_1',
        goal: { ...goal, status: 'paused' },
        routeAgentId: 'agt_1',
      }),
    );

    await act(async () => pickStatus(result.current, 'running'));

    expect(mocks.store.resumeGoal).toHaveBeenCalledWith('goal_1');
    expect(mocks.store.refreshGoals).toHaveBeenCalledWith('agt_1');
  });

  it('keeps the reader on the list after a delete', () => {
    renderHook(() => useGoalItemMenu({ agentId: 'agt_1', goal, routeAgentId: 'agt_1' }));

    // A host-supplied onDeleted replaces the redirect to the goal list.
    expect(mocks.deleteOptions?.onDeleted).toBeTypeOf('function');
  });

  it('places the cross-workspace copy entry above the delete group', () => {
    mocks.transferItems = [{ key: 'copy-goal', label: 'Copy to…' }];
    const { result } = renderHook(() =>
      useGoalItemMenu({ agentId: 'agt_1', goal, routeAgentId: 'agt_1' }),
    );

    const keys = result.current.map((item) => (item && 'key' in item ? item.key : item?.type));
    expect(keys.slice(-4)).toEqual(['copyLink', 'copy-goal', 'divider', 'delete']);
  });
});
