import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskItemContextMenu } from './useTaskItemContextMenu';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  deleteTask: vi.fn(),
  messageSuccess: vi.fn(),
  modalConfirm: vi.fn(),
  refreshTaskList: vi.fn(),
  runTask: vi.fn(),
  transferItems: [
    { key: 'transfer-task', label: 'Transfer to...' },
    { key: 'copy-task', label: 'Copy to...' },
  ],
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  closeContextMenu: vi.fn(),
  copyToClipboard: mocks.copyToClipboard,
  Flexbox: ({ children }: { children?: ReactNode }) => React.createElement('div', {}, children),
  Icon: ({ icon: Icon }: { icon?: React.ComponentType }) =>
    Icon ? React.createElement(Icon) : React.createElement('span'),
}));

vi.mock('antd', () => ({
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

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
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
});
