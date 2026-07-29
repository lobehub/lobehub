/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const permissionMock = vi.hoisted(() => ({
  create_content: true,
  edit_own_content: true,
}));
const workspaceMock = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }));
const workspaceOwnerMock = vi.hoisted(() => ({ isOwner: false }));
const confirmModalMock = vi.hoisted(() => vi.fn());
const openWorkspaceDeleteAllModalMock = vi.hoisted(() => vi.fn());
const removeGroupTopicsMock = vi.hoisted(() => vi.fn());
const removeUnstarredTopicMock = vi.hoisted(() => vi.fn());
const userMock = vi.hoisted(() => ({ currentUserId: 'user-1' as string | undefined }));

const chatStoreMock = vi.hoisted(() => ({
  refreshTopic: vi.fn(),
  topics: [] as Array<Record<string, unknown>>,
  updateTopicStatus: vi.fn(),
}));

const messageMock = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn() }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceMock.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => workspaceOwnerMock.isOwner,
}));

vi.mock('@/features/WorkspaceDeleteAllModal', () => ({
  openWorkspaceDeleteAllModal: openWorkspaceDeleteAllModalMock,
}));

vi.mock('@/store/user', () => ({
  useUserStore: () => userMock.currentUserId,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: confirmModalMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: messageMock,
      modal: {
        confirm: vi.fn(),
        error: vi.fn(),
      },
    }),
  },
  Upload: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupId: 'group-1',
      importTopic: vi.fn(),
      removeGroupTopics: removeGroupTopicsMock,
      removeUnstarredTopic: removeUnstarredTopicMock,
      refreshTopic: chatStoreMock.refreshTopic,
      topics: chatStoreMock.topics,
      updateTopicStatus: chatStoreMock.updateTopicStatus,
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { currentTopics: (s: { topics: Array<Record<string, unknown>> }) => s.topics },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      topicPageSize: 20,
      updateSystemStatus: vi.fn(),
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    topicPageSize: (s: { topicPageSize: number }) => s.topicPageSize,
  },
}));

const getMenuItem = (
  items: NonNullable<ReturnType<typeof useTopicActionsDropdownMenu>>,
  key: string,
) => items.find((item) => item && 'key' in item && item.key === key);

describe('group useTopicActionsDropdownMenu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
    workspaceMock.activeWorkspaceId = null;
    workspaceOwnerMock.isOwner = false;
    confirmModalMock.mockReset();
    openWorkspaceDeleteAllModalMock.mockReset();
    removeGroupTopicsMock.mockReset();
    removeUnstarredTopicMock.mockReset();
    userMock.currentUserId = 'user-1';
    chatStoreMock.topics = [];
    chatStoreMock.refreshTopic.mockReset();
    chatStoreMock.updateTopicStatus.mockReset();
    messageMock.info.mockReset();
    messageMock.success.mockReset();
  });

  it('disables topic write management actions for workspace viewers', () => {
    permissionMock.create_content = false;
    permissionMock.edit_own_content = false;

    const { result } = renderHook(() => useTopicActionsDropdownMenu());

    expect(getMenuItem(result.current!, 'import')).toMatchObject({ disabled: true });
    expect(getMenuItem(result.current!, 'archiveMergedPullRequests')).toMatchObject({
      disabled: true,
    });
    expect(getMenuItem(result.current!, 'deleteUnstarred')).toMatchObject({ disabled: true });
    expect(getMenuItem(result.current!, 'deleteAll')).toMatchObject({ disabled: true });
  });

  it('keeps the personal delete-all copy and deletes through the group scope', async () => {
    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const item = getMenuItem(result.current!, 'deleteAll');

    expect(item).toMatchObject({ label: 'actions.removeAll' });
    if (item && 'onClick' in item) item.onClick?.({} as never);

    const [{ content, onOk, title }] = confirmModalMock.mock.calls[0];
    expect(content).toBe('actions.confirmRemoveAll');
    expect(title).toBe('actions.removeAll');
    await onOk();
    expect(removeGroupTopicsMock).toHaveBeenCalledWith('group-1', 'own');
  });

  it('uses caller-scoped delete-all copy for workspace members', async () => {
    workspaceMock.activeWorkspaceId = 'workspace-1';

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const item = getMenuItem(result.current!, 'deleteAll');

    expect(item).toMatchObject({ label: 'actions.removeAllOwn' });
    if (item && 'onClick' in item) item.onClick?.({} as never);
    expect(confirmModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'actions.confirmRemoveAllOwn',
        title: 'actions.removeAllOwn',
      }),
    );
    expect(getMenuItem(result.current!, 'deleteAllWorkspace')).toBeUndefined();
    await confirmModalMock.mock.calls[0][0].onOk();
    expect(removeGroupTopicsMock).toHaveBeenCalledWith('group-1', 'own');
  });

  it('gives workspace owners separate own and workspace maintenance actions', async () => {
    workspaceMock.activeWorkspaceId = 'workspace-1';
    workspaceOwnerMock.isOwner = true;
    chatStoreMock.topics = [
      {
        id: 'own-merged',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'active',
        userId: 'user-1',
      },
      {
        id: 'other-merged',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'active',
        userId: 'user-2',
      },
    ];

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const ownItem = getMenuItem(result.current!, 'deleteAll');
    const workspaceArchiveItem = getMenuItem(result.current!, 'archiveMergedPullRequestsWorkspace');
    const workspaceUnstarredItem = getMenuItem(result.current!, 'deleteUnstarredWorkspace');
    const workspaceItem = getMenuItem(result.current!, 'deleteAllWorkspace');

    expect(ownItem).toMatchObject({ label: 'actions.removeAllOwn' });
    if (ownItem && 'onClick' in ownItem) ownItem.onClick?.({} as never);
    await confirmModalMock.mock.calls[0][0].onOk();
    expect(removeGroupTopicsMock).toHaveBeenCalledWith('group-1', 'own');

    expect(workspaceArchiveItem).toMatchObject({
      label: 'actions.archiveMergedPullRequestsWorkspace',
    });
    if (workspaceArchiveItem && 'onClick' in workspaceArchiveItem) {
      workspaceArchiveItem.onClick?.({} as never);
    }
    expect(confirmModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'actions.confirmArchiveMergedPullRequestsWorkspace' }),
    );
    await confirmModalMock.mock.calls[1][0].onOk();
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledTimes(2);
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 'own-merged',
    });
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 'other-merged',
    });

    expect(workspaceUnstarredItem).toMatchObject({
      label: 'actions.removeUnstarredWorkspace',
    });
    if (workspaceUnstarredItem && 'onClick' in workspaceUnstarredItem) {
      workspaceUnstarredItem.onClick?.({} as never);
    }
    expect(openWorkspaceDeleteAllModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        acknowledgeText: 'actions.confirmRemoveUnstarredWorkspaceAcknowledge',
        description: 'actions.confirmRemoveUnstarredWorkspace',
        title: 'actions.removeUnstarredWorkspace',
      }),
    );
    await openWorkspaceDeleteAllModalMock.mock.calls[0][0].onConfirm();
    expect(removeUnstarredTopicMock).toHaveBeenCalledWith({ onlyOwn: false });

    expect(workspaceItem).toMatchObject({ label: 'actions.removeAllWorkspace' });
    if (workspaceItem && 'onClick' in workspaceItem) workspaceItem.onClick?.({} as never);
    expect(openWorkspaceDeleteAllModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgeText: 'actions.confirmRemoveAllWorkspaceAcknowledge',
        description: 'actions.confirmRemoveAllWorkspace',
        title: 'actions.removeAllWorkspace',
      }),
    );
    await openWorkspaceDeleteAllModalMock.mock.calls[1][0].onConfirm();
    expect(removeGroupTopicsMock).toHaveBeenCalledWith('group-1', 'workspace');
  });

  it('keeps member maintenance actions but scopes them to topics they created', async () => {
    workspaceMock.activeWorkspaceId = 'workspace-1';
    chatStoreMock.topics = [
      {
        id: 'own-merged',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'active',
        userId: 'user-1',
      },
      {
        id: 'other-merged',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'active',
        userId: 'user-2',
      },
    ];

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const archiveItem = getMenuItem(result.current!, 'archiveMergedPullRequests');
    const deleteUnstarredItem = getMenuItem(result.current!, 'deleteUnstarred');

    expect(archiveItem).toMatchObject({ label: 'actions.archiveMergedPullRequestsOwn' });
    if (archiveItem && 'onClick' in archiveItem) await archiveItem.onClick?.({} as never);
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledOnce();
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 'own-merged',
    });

    expect(deleteUnstarredItem).toMatchObject({ label: 'actions.removeUnstarredOwn' });
    if (deleteUnstarredItem && 'onClick' in deleteUnstarredItem) {
      deleteUnstarredItem.onClick?.({} as never);
    }
    expect(confirmModalMock.mock.calls[0][0]).toMatchObject({
      content: 'actions.confirmRemoveUnstarredOwn',
      title: 'actions.removeUnstarredOwn',
    });
    await confirmModalMock.mock.calls[0][0].onOk();
    expect(removeUnstarredTopicMock).toHaveBeenCalledWith({ onlyOwn: true });
    expect(getMenuItem(result.current!, 'archiveMergedPullRequestsWorkspace')).toBeUndefined();
    expect(getMenuItem(result.current!, 'deleteUnstarredWorkspace')).toBeUndefined();
  });

  it('archives only unfinished topics whose pull requests are merged', async () => {
    chatStoreMock.topics = [
      {
        id: 'merged',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'active',
      },
      {
        id: 'open',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'OPEN' } } } },
        },
        status: 'active',
      },
      {
        id: 'completed',
        metadata: {
          workingDirectoryConfig: {
            git: { github: { pullRequest: { mergedAt: '2026-07-10T00:00:00Z' } } },
          },
        },
        status: 'completed',
      },
      {
        id: 'unread',
        metadata: {
          workingDirectoryConfig: { git: { github: { pullRequest: { state: 'MERGED' } } } },
        },
        status: 'unread',
      },
    ];

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const item = getMenuItem(result.current!, 'archiveMergedPullRequests');

    expect(item && 'onClick' in item).toBe(true);
    if (item && 'onClick' in item) await item.onClick?.({} as never);

    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledOnce();
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 'merged',
    });
    expect(chatStoreMock.refreshTopic).toHaveBeenCalledOnce();
    expect(messageMock.success).toHaveBeenCalledWith('actions.archiveMergedPullRequestsSuccess');
  });
});
