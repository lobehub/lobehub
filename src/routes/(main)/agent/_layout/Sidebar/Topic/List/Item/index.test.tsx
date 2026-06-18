/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TopicItem from './index';

const useTopicNavigationMock = vi.hoisted(() => vi.fn());
const runningStartTimeMock = vi.hoisted(() => ({ value: undefined as number | undefined }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <div data-testid="topic-item-icon" />,
  Skeleton: {
    Button: (props: Record<string, unknown>) => <div {...props} />,
  },
  Tag: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
vi.mock('@/const/url', () => ({
  SESSION_CHAT_TOPIC_URL: (agentId: string, topicId: string) => `/agent/${agentId}/${topicId}`,
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    extra,
    href,
    title,
  }: {
    active?: boolean;
    extra?: ReactNode;
    href?: string;
    title?: ReactNode;
  }) => (
    <div data-active={String(active)} data-href={href} data-testid="nav-item">
      {title}
      {extra}
    </div>
  ),
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
    selector: (state: { topicLoadingIds: string[]; topicRenamingId: string }) => unknown,
  ) => selector({ topicLoadingIds: [], topicRenamingId: '' }),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    getAgentRuntimeStartTimeByContext: () => () => runningStartTimeMock.value,
    isTopicUnreadCompleted: () => () => false,
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: { addTab: () => void }) => unknown) =>
    selector({ addTab: vi.fn() }),
}));
vi.mock('../../hooks/useTopicNavigation', () => ({
  useTopicNavigation: () => useTopicNavigationMock(),
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
    runningStartTimeMock.value = undefined;
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
});
