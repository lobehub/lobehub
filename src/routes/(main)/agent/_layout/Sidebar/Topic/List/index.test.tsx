/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicList from './index';

const pushMock = vi.hoisted(() => vi.fn());
const closeAllTopicsDrawerMock = vi.hoisted(() => vi.fn());
const permissionMock = vi.hoisted(() => ({
  create_content: true,
}));
const chatStoreStateMock = vi.hoisted(() => ({
  activeAgentId: 'agent-1',
  activeThreadId: undefined as string | undefined,
  activeTopicId: undefined as string | undefined,
  allTopicsDrawerOpen: false,
  closeAllTopicsDrawer: closeAllTopicsDrawerMock,
  hasMore: true,
  isExpandingPageSize: false,
  isUndefinedTopics: false,
  topicLength: 0,
  topics: [],
}));

vi.mock('@/features/NavPanel/components/EmptyNavItem', () => ({
  default: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick: () => void;
    title: string;
  }) => (
    <button disabled={disabled} type="button" onClick={disabled ? undefined : onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ onClick, title }: { onClick: () => void; title: string }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="skeleton-list" />,
}));

vi.mock('@/hooks/useFetchChatTopics', () => ({
  useFetchChatTopics: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content') => ({
    allowed: permissionMock[action],
    reason: permissionMock[action] ? '' : 'requires member',
  }),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof chatStoreStateMock) => unknown) =>
    selector(chatStoreStateMock),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicLength: (state: { topicLength: number }) => state.topicLength,
    displayTopicsForSidebar: () => (state: typeof chatStoreStateMock) => state.topics,
    hasMoreTopicsForSidebar: (state: typeof chatStoreStateMock) => state.hasMore,
    isExpandingPageSize: (state: typeof chatStoreStateMock) => state.isExpandingPageSize,
    isUndefinedTopics: (state: { isUndefinedTopics: boolean }) => state.isUndefinedTopics,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { topicPageSize: number }) => unknown) =>
    selector({ topicPageSize: 20 }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    topicPageSize: (state: { topicPageSize: number }) => state.topicPageSize,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (
    selector: (state: { topicIncludeCompleted: boolean; topicSortBy: string }) => unknown,
  ) => selector({ topicIncludeCompleted: false, topicSortBy: 'updatedAt' }),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    topicIncludeCompleted: (state: { topicIncludeCompleted: boolean }) =>
      state.topicIncludeCompleted,
    topicSortBy: (state: { topicSortBy: string }) => state.topicSortBy,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../AllTopicsDrawer', () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="all-topics-drawer" />
  ),
}));

vi.mock('../hooks/useAgentTopicGroupMode', () => ({
  useAgentTopicGroupMode: () => ({ topicGroupMode: 'flat' }),
}));

vi.mock('../TopicListContent/ByProjectMode', () => ({
  default: () => <div data-testid="by-project-mode" />,
}));

vi.mock('../TopicListContent/ByTimeMode', () => ({
  default: () => <div data-testid="by-time-mode" />,
}));

vi.mock('./Item', () => ({
  default: () => <div data-testid="topic-item" />,
}));

// Partial mock: keep every real export (e.g. `lobeStaticStylish`, which
// `createStaticStyles` reads at import time in transitively-loaded modules like
// ShareModal/useContainerStyles) and override only Flexbox. A full mock returning
// just Flexbox drops those exports and crashes collection whenever the suite's
// module graph evaluates one of them.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe('Agent topic list', () => {
  beforeEach(() => {
    pushMock.mockReset();
    closeAllTopicsDrawerMock.mockReset();
    permissionMock.create_content = true;
    chatStoreStateMock.hasMore = true;
    chatStoreStateMock.isExpandingPageSize = false;
    chatStoreStateMock.topicLength = 0;
    chatStoreStateMock.topics = [];
  });

  it('opens the agent chat route from the empty start topic entry', () => {
    render(<TopicList />);

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1');
  });

  it('disables the empty start topic entry for workspace viewers', () => {
    permissionMock.create_content = false;

    render(<TopicList />);

    const startButton = screen.getByRole('button', { name: 'actions.addNewTopic' });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('opens all agent topics from the view-all entry', () => {
    render(<TopicList />);

    fireEvent.click(screen.getByRole('button', { name: 'topic.viewAll' }));

    expect(pushMock).toHaveBeenCalledWith('/agent/agent-1/topics');
  });
});
