import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';

import { useTaskItemContextMenu } from './useTaskItemContextMenu';

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  manageable: true,
  closeContextMenu: vi.fn(),
  copyToClipboard: vi.fn(),
  deleteTask: vi.fn(),
  messageSuccess: vi.fn(),
  toastError: vi.fn(),
  modalConfirm: vi.fn(),
  refreshTaskList: vi.fn(),
  runTask: vi.fn(),
  transferItems: [
    { key: 'transfer-task', label: 'Move to…' },
    { key: 'copy-task', label: 'Copy to...' },
  ],
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<{ toast: Record<string, unknown> }>();
  return {
    ...actual,
    copyToClipboard: mocks.copyToClipboard,
    toast: { ...actual.toast, error: mocks.toastError, success: vi.fn() },
  };
});

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageableChecker: () => () => mocks.manageable,
}));

vi.mock('@/libs/contextMenu', () => ({
  closeContextMenu: mocks.closeContextMenu,
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: { success: mocks.messageSuccess },
      modal: { confirm: mocks.modalConfirm },
    }),
  },
}));

vi.mock('@/business/client/hooks/useTaskTransferMenuItem', () => ({
  useTaskTransferMenuItem: () => mocks.transferItems,
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { inboxAgentId: string }) => unknown) =>
    selector({ inboxAgentId: 'inbox-agent' }),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: { inboxAgentId: string }) => state.inboxAgentId,
  },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (
    selector: (state: {
      archiveTask: typeof mocks.archiveTask;
      deleteTask: typeof mocks.deleteTask;
      refreshTaskList: typeof mocks.refreshTaskList;
      runTask: typeof mocks.runTask;
      updateTask: typeof mocks.updateTask;
      updateTaskStatus: typeof mocks.updateTaskStatus;
    }) => unknown,
  ) =>
    selector({
      archiveTask: mocks.archiveTask,
      deleteTask: mocks.deleteTask,
      refreshTaskList: mocks.refreshTaskList,
      runTask: mocks.runTask,
      updateTask: mocks.updateTask,
      updateTaskStatus: mocks.updateTaskStatus,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: ReactNode; ns?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

describe('useTaskItemContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manageable = true;
  });

  it('does not render adjacent dividers around transfer actions', () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
        id: 'task_1',
        identifier: 'T-1',
        priority: 0,
        status: 'backlog',
      }),
    );

    const itemTypes = result.current.items.map((item) =>
      item && typeof item === 'object' && 'type' in item ? item.type : 'item',
    );

    expect(
      itemTypes.some((type, index) => type === 'divider' && itemTypes[index + 1] === 'divider'),
    ).toBe(false);
  });

  describe('archive action', () => {
    const findArchiveItem = (archivedAt?: Date | null) => {
      const { result } = renderHook(() =>
        useTaskItemContextMenu({
          archivedAt,
          id: 'task_1',
          identifier: 'T-1',
          priority: 0,
          status: 'completed',
        }),
      );
      return result.current.items.find(
        (item) => item && typeof item === 'object' && 'key' in item && item.key === 'archive',
      ) as { label: string; onClick: (info: unknown) => Promise<void> } | undefined;
    };
    const click = (item?: { onClick: (info: unknown) => Promise<void> }) =>
      item!.onClick({ domEvent: { stopPropagation: vi.fn() } });

    it('archives an unarchived task', async () => {
      const item = findArchiveItem(null);
      expect(item?.label).toBe('taskList.contextMenu.archive');

      await click(item);

      expect(mocks.archiveTask).toHaveBeenCalledWith('task_1', true);
    });

    it('restores an archived task', async () => {
      const item = findArchiveItem(new Date());
      expect(item?.label).toBe('taskList.contextMenu.unarchive');

      await click(item);

      expect(mocks.archiveTask).toHaveBeenCalledWith('task_1', false);
    });

    it('keeps restore available on an archived task whose work could still run', async () => {
      const { result } = renderHook(() =>
        useTaskItemContextMenu({
          archivedAt: new Date(),
          id: 'task_1',
          identifier: 'T-1',
          priority: 0,
          status: 'running',
        }),
      );
      const item = result.current.items.find(
        (entry) => entry && typeof entry === 'object' && 'key' in entry && entry.key === 'archive',
      ) as { desc?: string; disabled: boolean; onClick: (info: unknown) => Promise<void> };

      expect(item.disabled).toBe(false);
      expect(item.desc).toBeUndefined();
      await item.onClick({ domEvent: { stopPropagation: vi.fn() } });
      expect(mocks.archiveTask).toHaveBeenCalledWith('task_1', false);
    });

    it('disables archiving work that can still run and says why', async () => {
      const { result } = renderHook(() =>
        useTaskItemContextMenu({
          archivedAt: null,
          automationMode: 'heartbeat',
          heartbeatInterval: 600,
          id: 'task_1',
          identifier: 'T-1',
          priority: 0,
          status: 'backlog',
        }),
      );
      const item = result.current.items.find(
        (entry) => entry && typeof entry === 'object' && 'key' in entry && entry.key === 'archive',
      ) as { desc?: string; disabled: boolean; onClick: (info: unknown) => Promise<void> };

      expect(item.disabled).toBe(true);
      expect(item.desc).toBe('taskList.contextMenu.archiveBlocked');
      await item.onClick({ domEvent: { stopPropagation: vi.fn() } });
      expect(mocks.archiveTask).not.toHaveBeenCalled();
    });

    it('tells the user when the archive request fails', async () => {
      mocks.archiveTask.mockRejectedValueOnce(new Error('BAD_REQUEST'));
      const item = findArchiveItem(null);

      await click(item);

      expect(mocks.toastError).toHaveBeenCalledWith('taskList.contextMenu.archiveFailed');
    });

    it("lets a member who can't manage the task still archive it", async () => {
      mocks.manageable = false;
      const item = findArchiveItem(null) as unknown as {
        desc?: string;
        disabled: boolean;
        onClick: (info: unknown) => Promise<void>;
      };

      expect(item.disabled).toBe(false);
      expect(item.desc).toBeUndefined();
      await click(item);
      expect(mocks.archiveTask).toHaveBeenCalledWith('task_1', true);
    });

    it('offers no Run now on an archived task', () => {
      const { result } = renderHook(() =>
        useTaskItemContextMenu({
          archivedAt: new Date(),
          id: 'task_1',
          identifier: 'T-1',
          priority: 0,
          status: 'backlog',
        }),
      );
      const keys = result.current.items.map((entry) =>
        entry && typeof entry === 'object' && 'key' in entry ? entry.key : undefined,
      );
      expect(keys).not.toContain('runNow');
    });

    it('leaves the action out when the caller does not know the archive state', () => {
      expect(findArchiveItem(undefined)).toBeUndefined();
    });
  });

  it('copies the global task detail link in global route scope', async () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu(
        {
          assigneeAgentId: 'agent-1',
          id: 'task_1',
          identifier: 'T-1',
          priority: 0,
          status: 'backlog',
        },
        'global',
      ),
    );

    const copyLinkItem = result.current.items.find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'copyLink',
    );

    await (copyLinkItem as { onClick: (info: unknown) => Promise<void> }).onClick({
      domEvent: { stopPropagation: vi.fn() },
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('https://example.com/task/T-1');
  });

  it('runs a member-assigned task without replacing its assignee with the inbox agent', async () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
        assigneeUserId: 'user-1',
        id: 'task_1',
        identifier: 'T-1',
        priority: 0,
        status: 'backlog',
      }),
    );

    const runNowItem = result.current.items.find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'runNow',
    );

    await (runNowItem as { onClick: (info: unknown) => Promise<void> }).onClick({
      domEvent: { stopPropagation: vi.fn() },
    });

    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.runTask).toHaveBeenCalledWith('task_1');
  });

  it('routes the keyboard-shortcut submenu selection through @/libs/contextMenu', () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
        id: 'task_1',
        identifier: 'T-1',
        priority: 0,
        status: 'backlog',
      }),
    );

    act(() => {
      result.current.onContextMenu();
    });

    const statusItem = result.current.items.find(
      (item) => item && typeof item === 'object' && 'key' in item && item.key === 'status',
    ) as { onTitleMouseEnter?: () => void };

    act(() => {
      statusItem.onTitleMouseEnter?.();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    });

    expect(mocks.closeContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('menu ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('must stay web because the status/priority submenus depend on number-shortcut extra badges', () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
        id: 'task_1',
        identifier: 'T-1',
        priority: 0,
        status: 'backlog',
      }),
    );

    expect(canGoNative(result.current.items)).toBe(false);
    expect({
      menu: 'AgentTasks/taskItem',
      native: canGoNative(result.current.items),
    }).toMatchSnapshot();
  });
});
