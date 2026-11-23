/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
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

const messageMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));

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

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: confirmModalMock,
  toast: messageMock,
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: messageMock,
      modal: {
        confirm: vi.fn(),
        error: vi.fn(),
      },
    }),
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        activeGroupId: 'group-1',
        importTopic: vi.fn(),
        removeGroupTopics: removeGroupTopicsMock,
        removeUnstarredTopic: removeUnstarredTopicMock,
        refreshTopic: chatStoreMock.refreshTopic,
        topics: chatStoreMock.topics,
        updateTopicStatus: chatStoreMock.updateTopicStatus,
      }),
    { getState: () => chatStoreMock },
  ),
}));

// Each topic's linked PRs come from its Work rows; a fixture's `prStatus`
// stands for one linked PR in that state.
vi.mock('@/services/work', () => ({
  workService: {
    listTopicsPullRequests: vi.fn(async (ids: string[]) =>
      Object.fromEntries(
        chatStoreMock.topics.flatMap((topic) =>
          ids.includes(topic.id as string) && topic.prStatus
            ? [
                [
                  topic.id,
                  [
                    {
                      identifier: 'lobehub/lobehub#1',
                      linkedAt: new Date('2026-11-20T00:00:00Z'),
                      number: 1,
                      repoFullName: 'lobehub/lobehub',
                      scm: null,
                      source: 'created',
                      status: topic.prStatus,
                      title: null,
                      url: null,
                      vouched: true,
                      workId: 'work-1',
                    },
                  ],
                ],
              ]
            : [],
        ),
      ),
    ),
  },
}));

vi.mock('@/store/device/gitReview/store', () => ({
  useGitReviewStore: { getState: () => ({ gitPullRequestDetailMap: {} }) },
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
    expect(getMenuItem(result.current!, 'deleteUnstarred')).toBeUndefined();
    expect(getMenuItem(result.current!, 'deleteAll')).toBeUndefined();
  });

  it('does not expose bulk delete actions in the topic menu', () => {
    const { result } = renderHook(() => useTopicActionsDropdownMenu());

    expect(getMenuItem(result.current!, 'deleteUnstarred')).toBeUndefined();
    expect(getMenuItem(result.current!, 'deleteAll')).toBeUndefined();
  });

  it('gives workspace owners separate own and workspace maintenance actions', async () => {
    workspaceMock.activeWorkspaceId = 'workspace-1';
    workspaceOwnerMock.isOwner = true;
    chatStoreMock.topics = [
      {
        id: 'own-merged',
        prStatus: 'merged',
        status: 'active',
        userId: 'user-1',
      },
      {
        id: 'other-merged',
        prStatus: 'merged',
        status: 'active',
        userId: 'user-2',
      },
    ];

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const workspaceArchiveItem = getMenuItem(result.current!, 'archiveMergedPullRequestsWorkspace');
    const workspaceUnstarredItem = getMenuItem(result.current!, 'deleteUnstarredWorkspace');
    const workspaceItem = getMenuItem(result.current!, 'deleteAllWorkspace');

    expect(workspaceArchiveItem).toMatchObject({
      label: 'actions.archiveMergedPullRequestsWorkspace',
    });
    if (workspaceArchiveItem && 'onClick' in workspaceArchiveItem) {
      workspaceArchiveItem.onClick?.({} as never);
    }
    expect(confirmModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'actions.confirmArchiveMergedPullRequestsWorkspace',
        title: 'actions.archiveMergedPullRequestsWorkspace',
      }),
    );
    await confirmModalMock.mock.calls[0][0].onOk();
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
      label: 'actions.removeUnpinnedWorkspace',
    });
    if (workspaceUnstarredItem && 'onClick' in workspaceUnstarredItem) {
      workspaceUnstarredItem.onClick?.({} as never);
    }
    expect(openWorkspaceDeleteAllModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        acknowledgeText: 'actions.confirmRemoveUnpinnedWorkspaceAcknowledge',
        description: 'actions.confirmRemoveUnpinnedWorkspace',
        title: 'actions.removeUnpinnedWorkspace',
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
        prStatus: 'merged',
        status: 'active',
        userId: 'user-1',
      },
      {
        id: 'other-merged',
        prStatus: 'merged',
        status: 'active',
        userId: 'user-2',
      },
    ];

    const { result } = renderHook(() => useTopicActionsDropdownMenu());
    const archiveItem = getMenuItem(result.current!, 'archiveMergedPullRequests');

    expect(archiveItem).toMatchObject({ label: 'actions.archiveMergedPullRequestsOwn' });
    if (archiveItem && 'onClick' in archiveItem) await archiveItem.onClick?.({} as never);
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledOnce();
    expect(chatStoreMock.updateTopicStatus).toHaveBeenCalledWith({
      status: 'completed',
      topicId: 'own-merged',
    });

    expect(getMenuItem(result.current!, 'deleteUnstarred')).toBeUndefined();
    expect(getMenuItem(result.current!, 'deleteAll')).toBeUndefined();
    expect(getMenuItem(result.current!, 'archiveMergedPullRequestsWorkspace')).toBeUndefined();
    expect(getMenuItem(result.current!, 'deleteUnstarredWorkspace')).toBeUndefined();
  });

  it('archives only unfinished topics whose pull requests are merged', async () => {
    chatStoreMock.topics = [
      {
        id: 'merged',
        prStatus: 'merged',
        status: 'active',
      },
      {
        id: 'open',
        prStatus: 'open',
        status: 'active',
      },
      {
        id: 'completed',
        prStatus: 'merged',
        status: 'completed',
      },
      {
        id: 'unread',
        prStatus: 'merged',
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
