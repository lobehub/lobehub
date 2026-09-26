import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskDetailMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  allowed: true,
  clearPortalStack: vi.fn(),
  confirmModal: vi.fn(),
  deleteTask: vi.fn(),
  openRenameModal: vi.fn(),
  refreshTaskDetail: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({ confirmModal: mocks.confirmModal }));
vi.mock('@/components/RenameModal', () => ({ openRenameModal: mocks.openRenameModal }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions', () => ({
  useTaskCopyActions: () => ({
    link: 'https://app.lobehub.com/agent/agt_1/task/T-7/fix-login',
    taskId: 'T-7',
  }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ clearPortalStack: mocks.clearPortalStack }),
}));
vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: unknown) => unknown) =>
    selector({
      deleteTask: mocks.deleteTask,
      internal_refreshTaskDetail: mocks.refreshTaskDetail,
      taskDetailMap: { 'T-7': { name: 'Fix login' } },
      updateTask: mocks.updateTask,
    }),
}));

describe('useTaskDetailMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowed = true;
  });

  it('declares rename, copy link, copy id, refresh and delete', () => {
    const { result } = renderHook(() => useTaskDetailMoreMenu());

    expect(result.current).toMatchObject({
      copyId: 'T-7',
      copyLink: 'https://app.lobehub.com/agent/agt_1/task/T-7/fix-login',
    });
    expect(Object.keys(result.current!).sort()).toEqual(
      ['copyId', 'copyLink', 'delete', 'refresh', 'rename'].sort(),
    );
  });

  it('closes the panel after deleting instead of leaving for the task list', async () => {
    const { result } = renderHook(() => useTaskDetailMoreMenu());
    result.current!.delete!();

    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.deleteTask).toHaveBeenCalledWith('T-7');
    expect(mocks.clearPortalStack).toHaveBeenCalledOnce();
  });

  it('renames the task name', async () => {
    const { result } = renderHook(() => useTaskDetailMoreMenu());
    result.current!.rename!();

    const { defaultValue, onSave } = mocks.openRenameModal.mock.calls[0][0];
    expect(defaultValue).toBe('Fix login');
    await onSave('Fix sign-in');
    expect(mocks.updateTask).toHaveBeenCalledWith('T-7', { name: 'Fix sign-in' });
  });

  it('refreshes the task detail cache', () => {
    const { result } = renderHook(() => useTaskDetailMoreMenu());
    result.current!.refresh!();

    expect(mocks.refreshTaskDetail).toHaveBeenCalledWith('T-7');
  });

  it('hides rename and delete for members who cannot edit tasks', () => {
    mocks.allowed = false;
    const { result } = renderHook(() => useTaskDetailMoreMenu());

    expect(result.current?.rename).toBeUndefined();
    expect(result.current?.delete).toBeUndefined();
  });
});
