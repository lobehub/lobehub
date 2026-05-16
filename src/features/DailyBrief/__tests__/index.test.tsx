import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DailyBrief from '..';

interface MockBrief {
  id: string;
  title: string;
}

const mocks = vi.hoisted(() => ({
  state: {
    briefs: [] as MockBrief[],
    isBriefsInit: true,
    isLogin: true,
    recommendationsVisible: true,
  },
  useFetchBriefs: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'brief.title': 'Brief',
        'brief.viewAllTasks': 'View all tasks',
      };
      return map[key] || key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer', () => ({
  default: () => <div data-testid="topic-chat-drawer" />,
}));

vi.mock('@/features/DocumentModal/Preview', () => ({
  default: () => <div data-testid="document-preview-modal" />,
}));

vi.mock('@/features/Recommendations', () => ({
  default: () => <div>Recommendations</div>,
  useRecommendationsVisible: () => mocks.state.recommendationsVisible,
}));

vi.mock('@/routes/(main)/home/features/components/GroupBlock', () => ({
  default: ({
    action,
    children,
    title,
  }: {
    action?: ReactNode;
    children: ReactNode;
    title?: ReactNode;
  }) => (
    <section data-testid="group-block">
      <header>
        {title}
        {action}
      </header>
      {children}
    </section>
  ),
}));

vi.mock('@/store/brief', () => ({
  useBriefStore: (
    selector: (state: {
      briefs: MockBrief[];
      isBriefsInit: boolean;
      useFetchBriefs: typeof mocks.useFetchBriefs;
    }) => unknown,
  ) =>
    selector({
      briefs: mocks.state.briefs,
      isBriefsInit: mocks.state.isBriefsInit,
      useFetchBriefs: mocks.useFetchBriefs,
    }),
}));

vi.mock('@/store/brief/selectors', () => ({
  briefListSelectors: {
    briefs: (state: { briefs: MockBrief[] }) => state.briefs,
    isBriefsInit: (state: { isBriefsInit: boolean }) => state.isBriefsInit,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { isLogin: boolean }) => unknown) =>
    selector({ isLogin: mocks.state.isLogin }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  authSelectors: {
    isLogin: (state: { isLogin: boolean }) => state.isLogin,
  },
}));

vi.mock('../BriefCard', () => ({
  default: ({ brief }: { brief: MockBrief }) => <article>{brief.title}</article>,
}));

vi.mock('../BriefCardSkeleton', () => ({
  BriefCardSkeleton: () => <div>Brief skeleton</div>,
}));

beforeEach(() => {
  mocks.state.briefs = [];
  mocks.state.isBriefsInit = true;
  mocks.state.isLogin = true;
  mocks.state.recommendationsVisible = true;
  mocks.useFetchBriefs.mockClear();
});

describe('DailyBrief', () => {
  it('renders recommendations without the brief group header when no briefs are available', () => {
    render(<DailyBrief />);

    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.queryByTestId('group-block')).not.toBeInTheDocument();
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
    expect(screen.queryByText('View all tasks')).not.toBeInTheDocument();
  });

  it('renders the brief group header when briefs are available', () => {
    mocks.state.briefs = [{ id: 'brief-1', title: 'Brief item' }];

    render(<DailyBrief />);

    expect(screen.getByTestId('group-block')).toBeInTheDocument();
    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.getByText('Brief item')).toBeInTheDocument();
    expect(screen.getByText('View all tasks')).toBeInTheDocument();
  });
});
