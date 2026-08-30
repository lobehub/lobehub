/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { removeDraft, saveDraft } from '@/features/ChatInput/draftStorage';

import TopicItem from './index';

const useTopicNavigationMock = vi.hoisted(() => vi.fn());
const prefetchMessagesMock = vi.hoisted(() => vi.fn());
const activeTopicIdMock = vi.hoisted(() => ({ value: undefined as string | undefined }));
const agentRuntimeRunningMock = vi.hoisted(() => ({ value: false }));
const runningStartTimeMock = vi.hoisted(() => ({ value: undefined as number | undefined }));
const topicUnreadCompletedMock = vi.hoisted(() => ({ value: false }));
const topicMetaCardMock = vi.hoisted(() => ({
  value: undefined as { pullRequest?: { state: string } } | undefined,
}));
const topicDraftKey = 'main_agt_test_tpc_test';

// Assertions key on the raw lucide displayName, which the real Icon does not
// expose in the DOM.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Icon: ({
    'aria-label': ariaLabel,
    icon,
    role,
  }: {
    'aria-label'?: string;
    'icon'?: { displayName?: string };
    'role'?: string;
  }) => (
    <div
      aria-label={ariaLabel}
      data-icon={icon?.displayName}
      data-testid="topic-item-icon"
      role={role}
    />
  ),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
  },
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    description,
    extra,
    href,
    icon,
    slots,
    title,
  }: {
    active?: boolean;
    description?: ReactNode;
    extra?: ReactNode;
    href?: string;
    icon?: ReactNode;
    slots?: { titlePrefix?: ReactNode };
    title?: ReactNode;
  }) => (
    <div data-active={String(active)} data-href={href} data-testid="nav-item">
      {icon}
      <span data-testid="nav-item-title-prefix">{slots?.titlePrefix}</span>
      {title}
      {description}
      <span data-testid="nav-item-extra">{extra}</span>
    </div>
  ),
}));
vi.mock('@/components/RingLoading', () => ({
  default: () => <div data-testid="ring-loading" />,
}));
vi.mock('@/features/ChatInput/ControlBar/DirIcon', () => ({
  default: () => <span data-testid="dir-icon" />,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'team',
}));
vi.mock('@/routes/(main)/agent/channel/const', () => ({
  getPlatformIcon: () => null,
}));
vi.mock('@/store/agent', () => ({
  // `agentMap` is read by `agentSelectors.currentAgentVisibility`.
  useAgentStore: (
    selector: (state: { activeAgentId: string; agentMap: Record<string, unknown> }) => unknown,
  ) => selector({ activeAgentId: 'agt_test', agentMap: {} }),
}));
vi.mock('@/store/chat', () => {
  const useChatStore = (
    selector: (state: {
      activeThreadId?: string;
      activeTopicId?: string;
      prefetchMessages: typeof prefetchMessagesMock;
    }) => unknown,
  ) => selector({ activeTopicId: activeTopicIdMock.value, prefetchMessages: prefetchMessagesMock });
  useChatStore.getState = () => ({ prefetchMessages: prefetchMessagesMock });
  return { useChatStore };
});
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    getAgentRuntimeStartTimeByContext: () => () => runningStartTimeMock.value,
    getVisibleAgentRuntimeStartTimeByContext: () => () => runningStartTimeMock.value,
    isAgentRuntimeRunningByContext: () => () => agentRuntimeRunningMock.value,
    isAgentRuntimeVisiblyRunningByContext: () => () => false,
    isTopicUnreadCompleted: () => () => topicUnreadCompletedMock.value,
    isTopicVisiblyRunning: () => () => false,
  },
}));
vi.mock('@/store/electron', () => {
  const useElectronStore = (selector: (state: { addTab: () => void }) => unknown) =>
    selector({ addTab: vi.fn() });
  useElectronStore.getState = () => ({ addTab: vi.fn() });
  return { useElectronStore };
});
vi.mock('../../hooks/useTopicNavigation', () => ({
  useTopicNavigation: () => useTopicNavigationMock(),
}));
vi.mock('./MetaHoverCard', () => ({
  default: () => null,
}));
vi.mock('./metaCardData', () => ({
  PR_STATE_VISUAL: { open: { color: '#0a0', icon: () => null, labelKey: 'metaCard.pr.open' } },
  getPullRequestState: () => 'open',
  // Defaults to undefined so TopicItem skips the hover Popover wrapper in tests.
  getTopicMetaCard: () => topicMetaCardMock.value,
}));
vi.mock('./Actions', () => ({
  default: () => null,
}));
vi.mock('./useDropdownMenu', () => ({
  useTopicItemDropdownMenu: () => ({ dropdownMenu: [] }),
}));
vi.mock('../../TopicListContent/ThreadList', () => ({
  default: ({ topicId }: { topicId: string }) => (
    <div data-testid="topic-thread-list" data-topic-id={topicId} />
  ),
}));

describe('TopicItem active state', () => {
  afterEach(() => {
    prefetchMessagesMock.mockClear();
    activeTopicIdMock.value = undefined;
    agentRuntimeRunningMock.value = false;
    runningStartTimeMock.value = undefined;
    topicUnreadCompletedMock.value = false;
    topicMetaCardMock.value = undefined;
    removeDraft(topicDraftKey);
    vi.useRealTimers();
  });

  it('keeps the current topic highlighted on topic page sub-routes', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: true,
      isInTopicContextRoute: true,
      navigateToTopic: vi.fn(),
      routeTopicId: 'tpc_test',
      urlTopicId: 'tpc_test',
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('nav-item')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('topic-thread-list')).toHaveAttribute('data-topic-id', 'tpc_test');
  });

  it('does not highlight a stale topic while visiting non-topic agent sub-routes', () => {
    activeTopicIdMock.value = 'tpc_test';
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: true,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('nav-item')).toHaveAttribute('data-active', 'false');
    expect(screen.queryByTestId('topic-thread-list')).not.toBeInTheDocument();
  });

  it('prefixes the cmd-click href with the active workspace slug', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('nav-item')).toHaveAttribute(
      'data-href',
      '/team/agent/agt_test/tpc_test',
    );
  });

  it('replaces the draft title prefix text with a pencil icon', () => {
    saveDraft(topicDraftKey, { root: {} });
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    const draftIcon = within(screen.getByTestId('nav-item-title-prefix')).getByRole('img');
    expect(draftIcon).toHaveAttribute('data-icon', 'PencilLine');
    expect(draftIcon).toHaveAccessibleName();
    expect(within(screen.getByTestId('nav-item-extra')).queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows running elapsed time in the nav item extra slot', () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 0, 1, 0, 0, 33);
    vi.setSystemTime(now);
    runningStartTimeMock.value = now - 33_000;
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" status="running" title="Topic" />);

    expect(screen.getByText('00:33')).toBeInTheDocument();
  });

  it('preserves the masked running-tail icon state for the active topic', () => {
    activeTopicIdMock.value = 'tpc_test';
    agentRuntimeRunningMock.value = true;
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: true,
      navigateToTopic: vi.fn(),
      routeTopicId: 'tpc_test',
      urlTopicId: 'tpc_test',
    });

    render(<TopicItem id="tpc_test" status="running" title="Topic" />);

    expect(screen.queryByTestId('ring-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('topic-item-icon')).not.toBeInTheDocument();
  });

  it('keeps idle topics iconless', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.queryByTestId('topic-item-icon')).not.toBeInTheDocument();
  });

  it('prefetches messages when a topic is an unread completion', async () => {
    topicUnreadCompletedMock.value = true;
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    await waitFor(() => {
      expect(prefetchMessagesMock).toHaveBeenCalledWith({
        agentId: 'agt_test',
        scope: 'main',
        topicId: 'tpc_test',
      });
    });
  });

  it('prefetches unread completed messages after the runtime stops', async () => {
    agentRuntimeRunningMock.value = true;
    topicUnreadCompletedMock.value = true;
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    const { rerender } = render(<TopicItem id="tpc_test" title="Topic" />);

    expect(prefetchMessagesMock).not.toHaveBeenCalled();

    agentRuntimeRunningMock.value = false;
    rerender(<TopicItem id="tpc_test" title="Topic done" />);

    await waitFor(() => {
      expect(prefetchMessagesMock).toHaveBeenCalledWith({
        agentId: 'agt_test',
        scope: 'main',
        topicId: 'tpc_test',
      });
    });
  });

  it('shows the topic worktree and branch from structured metadata', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(
      <TopicItem
        showWorkingDirectory
        id="tpc_test"
        title="Topic"
        metadata={{
          workingDirectory: '/repo-fix',
          workingDirectoryConfig: {
            git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
            path: '/repo',
            repoType: 'git',
          },
        }}
      />,
    );

    expect(screen.getByText('repo/repo-fix · fix')).toBeInTheDocument();
  });

  // The unread dot and the linked-PR marker compete for the same icon slot, and
  // unread is one of the three `pending` attention states, so it has to win.
  it('keeps the unread dot visible when the topic has a linked pull request', () => {
    topicUnreadCompletedMock.value = true;
    topicMetaCardMock.value = { pullRequest: { state: 'open' } };
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('topic-unread-dot')).toBeInTheDocument();
  });

  it('shows the pull request marker once the topic is no longer unread', () => {
    topicMetaCardMock.value = { pullRequest: { state: 'open' } };
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" title="Topic" />);

    expect(screen.queryByTestId('topic-unread-dot')).not.toBeInTheDocument();
    expect(screen.getByTestId('topic-item-icon')).toBeInTheDocument();
  });

  it.each([
    ['scheduled', 'Clock'],
    ['completed', 'CircleCheck'],
  ] as const)('keeps the %s status above linked pull request metadata', (status, icon) => {
    topicMetaCardMock.value = { pullRequest: { state: 'open' } };
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: false,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem id="tpc_test" status={status} title="Topic" />);

    expect(screen.getByTestId('topic-item-icon')).toHaveAttribute('data-icon', icon);
  });
});
