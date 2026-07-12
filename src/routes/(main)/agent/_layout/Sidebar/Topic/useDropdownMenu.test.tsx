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

const chatStoreMock = vi.hoisted(() => ({
  refreshTopic: vi.fn(),
  topics: [] as Array<Record<string, unknown>>,
  updateTopicStatus: vi.fn(),
}));

const messageMock = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('antd', () => {
  return {
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
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: permissionMock[action],
    reason: '',
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      importTopic: vi.fn(),
      removeSessionTopics: vi.fn(),
      removeUnstarredTopic: vi.fn(),
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

describe('useTopicActionsDropdownMenu', () => {
  beforeEach(() => {
    permissionMock.create_content = true;
    permissionMock.edit_own_content = true;
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
