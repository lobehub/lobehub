/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicItem from './index';

const useTopicNavigationMock = vi.hoisted(() => vi.fn());

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
  createStyles: () => () => ({
    cx: (...classNames: Array<false | string | undefined>) => classNames.filter(Boolean).join(' '),
    styles: {
      container: 'container',
      dot: 'dot',
    },
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
vi.mock('@/features/Electron/titlebar/RecentlyViewed/plugins', () => ({
  pluginRegistry: { parseUrl: vi.fn() },
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ active, title }: { active?: boolean; title?: ReactNode }) => (
    <div data-active={String(active)} data-testid="nav-item">
      {title}
    </div>
  ),
}));
vi.mock('@/routes/(main)/agent/channel/const', () => ({
  getPlatformIcon: () => null,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agt_test' }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: { topicLoadingIds: string[]; topicRenamingId: string }) => unknown,
  ) => selector({ topicLoadingIds: [], topicRenamingId: '' }),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
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
  default: () => <div data-testid="topic-thread-list" />,
}));

describe('TopicItem active state', () => {
  it('keeps the current topic highlighted on topic page sub-routes', () => {
    useTopicNavigationMock.mockReturnValue({
      isInAgentSubRoute: true,
      isInTopicContextRoute: true,
      navigateToTopic: vi.fn(),
      routeTopicId: 'tpc_test',
    });

    render(<TopicItem active={false} id="tpc_test" title="Topic" />);

    expect(screen.getByTestId('nav-item')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('topic-thread-list')).toBeInTheDocument();
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
});
