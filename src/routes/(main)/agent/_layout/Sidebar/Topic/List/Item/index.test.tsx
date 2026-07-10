/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopicItem from './index';

const useTopicNavigationMock = vi.hoisted(() => vi.fn());
const prefetchMessagesMock = vi.hoisted(() => vi.fn());
const agentRuntimeRunningMock = vi.hoisted(() => ({ value: false }));
const runningStartTimeMock = vi.hoisted(() => ({ value: undefined as number | undefined }));
const topicUnreadCompletedMock = vi.hoisted(() => ({ value: false }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <div data-testid="topic-item-icon" />,
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Skeleton: {
    Button: (props: Record<string, unknown>) => <div {...props} />,
  },
  Tag: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children, style }: { children?: ReactNode; style?: CSSProperties }) => (
    <span style={style}>{children}</span>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    dotContainer: 'dotContainer',
    neonDot: 'neonDot',
    neonDotWrapper: 'neonDotWrapper',
  }),
  cssVar: {
    colorInfo: '#00f',
    colorTextDescription: '#999',
  },
  keyframes: () => 'keyframes',
  useTheme: () => ({ isDarkMode: false }),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    description,
    extra,
    href,
    title,
  }: {
    active?: boolean;
    description?: ReactNode;
    extra?: ReactNode;
    href?: string;
    title?: ReactNode;
  }) => (
    <div data-active={String(active)} data-href={href} data-testid="nav-item">
      {title}
      {description}
      {extra}
    </div>
  ),
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
  // `agentMap` is read by `agentSelectors.isCurrentAgentHeterogeneous` →
  // `currentAgentConfig`, which would otherwise throw on `undefined.agentMap`.
  useAgentStore: (
    selector: (state: { activeAgentId: string; agentMap: Record<string, unknown> }) => unknown,
  ) => selector({ activeAgentId: 'agt_test', agentMap: {} }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      prefetchMessages: typeof prefetchMessagesMock;
      topicLoadingIds: string[];
      topicRenamingId: string;
    }) => unknown,
  ) =>
    selector({ prefetchMessages: prefetchMessagesMock, topicLoadingIds: [], topicRenamingId: '' }),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    getAgentRuntimeStartTimeByContext: () => () => runningStartTimeMock.value,
    getVisibleAgentRuntimeStartTimeByContext: () => () => runningStartTimeMock.value,
    isAgentRuntimeRunningByContext: () => () => agentRuntimeRunningMock.value,
    isAgentRuntimeVisiblyRunningByContext: () => () => false,
    isTopicUnreadCompleted: () => () => topicUnreadCompletedMock.value,
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: { addTab: () => void }) => unknown) =>
    selector({ addTab: vi.fn() }),
}));
vi.mock('../../hooks/useTopicNavigation', () => ({
  useTopicNavigation: () => useTopicNavigationMock(),
}));
vi.mock('./MetaHoverCard', () => ({
  default: () => null,
}));
vi.mock('./metaCardData', () => ({
  PR_STATE_VISUAL: {},
  getPullRequestState: () => 'open',
  // Return undefined so TopicItem skips the hover Popover wrapper in tests.
  getTopicMetaCard: () => undefined,
}));
vi.mock('./Actions', () => ({
  default: () => null,
}));
vi.mock('./Editing', () => ({
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
    agentRuntimeRunningMock.value = false;
    runningStartTimeMock.value = undefined;
    topicUnreadCompletedMock.value = false;
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

    render(<TopicItem active={false} id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('nav-item')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('topic-thread-list')).toHaveAttribute('data-topic-id', 'tpc_test');
  });

  it('does not highlight a stale topic while visiting non-topic agent sub-routes', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: true,
      isInTopicContextRoute: false,
      navigateToTopic: vi.fn(),
      routeTopicId: undefined,
    });

    render(<TopicItem active id="tpc_test" title="Topic" />);

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
});
