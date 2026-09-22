import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canGoNative } from '@/libs/contextMenu/canGoNative';

import { useTaskItemContextMenu } from './useTaskItemContextMenu';

const mocks = vi.hoisted(() => ({
  closeContextMenu: vi.fn(),
  copyToClipboard: vi.fn(),
  deleteTask: vi.fn(),
  messageSuccess: vi.fn(),
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

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: mocks.copyToClipboard,
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
      deleteTask: typeof mocks.deleteTask;
      refreshTaskList: typeof mocks.refreshTaskList;
      runTask: typeof mocks.runTask;
      updateTask: typeof mocks.updateTask;
      updateTaskStatus: typeof mocks.updateTaskStatus;
    }) => unknown,
  ) =>
    selector({
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
  });

  it('does not render adjacent dividers around transfer actions', () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
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

  it('copies the global task detail link in global route scope', async () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu(
        {
          assigneeAgentId: 'agent-1',
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
    expect(mocks.runTask).toHaveBeenCalledWith('T-1');
  });

  it('routes the keyboard-shortcut submenu selection through @/libs/contextMenu', () => {
    const { result } = renderHook(() =>
      useTaskItemContextMenu({
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
