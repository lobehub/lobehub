/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskAcceptance from './TaskAcceptance';

const mocks = vi.hoisted(() => ({
  acceptanceSubject: null as null | { id: string },
  bundle: undefined as
    | undefined
    | {
        acceptance: { id: string; requirement: string };
        checks: Array<{
          category: string;
          id: string;
          seq: number;
          title: string;
        }>;
        isOwner: boolean;
      },
  mutateBundle: vi.fn(),
  mutateSubject: vi.fn(),
  openAcceptanceCheck: vi.fn(),
  toggleTaskAgentPanel: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
  Block: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Drawer: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <aside>{children}</aside> : null,
  Flexbox: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Icon: () => <span />,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn() } }) },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    body: 'body',
    drawerBody: 'drawerBody',
    error: 'error',
    group: 'group',
    groupHeader: 'groupHeader',
    list: 'list',
    row: 'row',
    seq: 'seq',
  }),
  cssVar: {
    colorTextDescription: '#999',
    colorTextSecondary: '#666',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => <div>loading</div> }));

vi.mock('@/features/Verify', () => ({
  CheckRow: ({ check }: { check: { title: string } }) => (
    <div data-testid="acceptance-check-detail">detail: {check.title}</div>
  ),
  checkHeadMeta: () => ({ color: 'green', icon: () => null }),
  groupChecks: (checks: Array<{ category: string }>) =>
    [...new Set(checks.map((check) => check.category))].map((category) => ({
      checks: checks.filter((check) => check.category === category),
      key: `category:${category}`,
      label: category,
    })),
  useAcceptanceBundle: () => ({
    data: mocks.bundle,
    error: undefined,
    isLoading: false,
    mutate: mocks.mutateBundle,
  }),
  useAcceptanceBySubject: () => ({
    data: mocks.acceptanceSubject,
    error: undefined,
    mutate: mocks.mutateSubject,
  }),
}));

vi.mock('@/services/verify', () => ({
  verifyService: { reviewChecks: vi.fn() },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openAcceptanceCheck: mocks.openAcceptanceCheck }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { currentViewType: () => null },
}));

vi.mock('@/store/chat/slices/portal/initialState', () => ({
  PortalViewType: { TaskDetail: 'taskDetail' },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ toggleTaskAgentPanel: mocks.toggleTaskAgentPanel }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTaskId: 'T-231' }),
}));

vi.mock('../shared/AccordionArrowIcon', () => ({ default: () => <span>arrow</span> }));

describe('TaskAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptanceSubject = null;
    mocks.bundle = undefined;
  });

  it('stays absent when the task has no acceptance aggregate', () => {
    const { container } = render(<TaskAcceptance />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders grouped checks and opens the selected check in the Acceptance portal', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [
        { category: 'Setup', id: 'c1', seq: 1, title: 'Create task' },
        { category: 'Result', id: 'c2', seq: 2, title: 'Show result' },
      ],
      isOwner: true,
    };

    render(<TaskAcceptance />);

    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Create task'));
    expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledWith(true);
    expect(mocks.openAcceptanceCheck).toHaveBeenCalledWith('acceptance-1', 'c1');
  });
});
