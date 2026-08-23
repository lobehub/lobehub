/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingAcceptanceCheckList } from './PendingAcceptanceCheckList';
import TaskAcceptance from './TaskAcceptance';

// The section links out to the acceptance report, so it needs router context.
const render = (ui: ReactNode) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

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
  currentPortalView: null as null | string,
  confirmModal: vi.fn(),
  deleteAcceptance: vi.fn(),
  mutateBundle: vi.fn(),
  mutateSubject: vi.fn(),
  navigate: vi.fn(),
  openAcceptance: vi.fn(),
  openAcceptanceCheck: vi.fn(),
  subjectArgs: [] as unknown[],
  toggleTaskAgentPanel: vi.fn(),
  updateVerifyConfig: vi.fn(),
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
  confirmModal: (opts: unknown) => mocks.confirmModal(opts),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn() } }) },
}));

vi.mock('antd-style', () => ({
  cx: (...classNames: unknown[]) => classNames.filter(Boolean).join(' '),
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
    colorTextQuaternary: '#aaa',
    colorTextSecondary: '#666',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => <div>loading</div> }));

vi.mock('@/features/Verify', async () => ({
  // The real row/list primitives: the assertions cover the shared grammar.
  ...(await vi.importActual('@/features/Verify/CriterionList')),
  CheckRow: ({ check }: { check: { title: string } }) => (
    <div data-testid="acceptance-check-detail">detail: {check.title}</div>
  ),
  checkHeadMeta: () => ({ color: 'green', icon: () => null }),
  shouldGroupChecks: (checkCount: number) => checkCount > 10,
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
  useAcceptanceBySubject: (...args: unknown[]) => {
    mocks.subjectArgs = args;
    return {
      data: mocks.acceptanceSubject,
      error: undefined,
      isLoading: false,
      mutate: mocks.mutateSubject,
    };
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/services/verify', () => ({
  verifyService: {
    deleteAcceptance: (id: string) => mocks.deleteAcceptance(id),
    reviewChecks: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      openAcceptance: mocks.openAcceptance,
      openAcceptanceCheck: mocks.openAcceptanceCheck,
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { currentViewType: () => mocks.currentPortalView },
}));

vi.mock('@/store/chat/slices/portal/initialState', () => ({
  PortalViewType: { TaskDetail: 'taskDetail' },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ toggleTaskAgentPanel: mocks.toggleTaskAgentPanel }),
}));

vi.mock('@/store/task', () => {
  const useTaskStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTaskId: 'T-231',
      taskDetailMap: { 'T-231': { id: 'task-database-231', identifier: 'T-231' } },
    });
  useTaskStore.getState = () => ({
    updateVerifyConfig: mocks.updateVerifyConfig,
  });
  return { useTaskStore };
});

vi.mock('../shared/AccordionArrowIcon', () => ({ default: () => <span>arrow</span> }));
vi.mock('./TaskVerifyConfig', () => ({
  default: () => <div data-testid="task-acceptance-criteria">criteria</div>,
}));

describe('TaskAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptanceSubject = null;
    mocks.bundle = undefined;
    mocks.currentPortalView = null;
  });

  it('renders the configured criteria in the same slot before an acceptance aggregate exists', () => {
    render(<TaskAcceptance />);

    expect(screen.getByTestId('task-acceptance-criteria')).toBeInTheDocument();
    expect(mocks.subjectArgs).toEqual(['task', 'task-database-231']);
  });

  it('keeps a small pending checklist flat with the Acceptance check row grammar', () => {
    const onOpen = vi.fn();

    render(
      <PendingAcceptanceCheckList
        groupLabel={'Ungrouped'}
        items={[
          { id: 'criterion-1', title: 'Word count' },
          { id: 'criterion-2', title: 'Markdown structure' },
        ]}
        onOpen={onOpen}
      />,
    );

    expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument();
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Word count'));
    expect(onOpen).toHaveBeenCalledWith({ id: 'criterion-1', title: 'Word count' });
  });

  it('shows the pending checklist group only after it exceeds ten checks', () => {
    render(
      <PendingAcceptanceCheckList
        groupLabel={'Ungrouped'}
        items={Array.from({ length: 11 }, (_, index) => ({
          id: `criterion-${index + 1}`,
          title: `Check ${index + 1}`,
        }))}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    expect(screen.getByText('Check 11')).toBeInTheDocument();
  });

  it('opens the selected check and expands its Acceptance panel from Task detail', () => {
    mocks.currentPortalView = 'taskDetail';
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

    expect(screen.queryByTestId('task-acceptance-criteria')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
    expect(screen.queryByText('taskDetail.acceptance.collapseAll')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Create task'));
    expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledWith(true);
    expect(mocks.openAcceptanceCheck).toHaveBeenCalledWith('acceptance-1', 'c1');
  });

  it('opens the acceptance report in the panel rather than navigating away', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [{ category: 'Setup', id: 'c1', seq: 1, title: 'Create task' }],
      isOwner: true,
    };

    render(<TaskAcceptance />);

    fireEvent.click(screen.getByText('taskDetail.acceptance.openReport'));
    expect(mocks.toggleTaskAgentPanel).toHaveBeenCalledWith(true);
    expect(mocks.openAcceptance).toHaveBeenCalledWith('acceptance-1');
  });

  it('groups a checklist with more than 10 checks', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: Array.from({ length: 11 }, (_, index) => ({
        category: index < 6 ? 'Setup' : 'Result',
        id: `c${index + 1}`,
        seq: index + 1,
        title: `Check ${index + 1}`,
      })),
      isOwner: true,
    };

    render(<TaskAcceptance />);

    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('taskDetail.acceptance.collapseAll')).toBeInTheDocument();
    expect(screen.getByText('Check 11')).toBeInTheDocument();
  });

  it('removes the acceptance and clears the task verify config from the header delete button', async () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [{ category: 'Setup', id: 'c1', seq: 1, title: 'Create task' }],
      isOwner: true,
    };

    render(<TaskAcceptance />);

    fireEvent.click(screen.getByText('taskDetail.acceptance.remove'));
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAcceptance).not.toHaveBeenCalled();

    const opts = mocks.confirmModal.mock.calls[0][0] as { onOk: () => Promise<void> };
    await opts.onOk();

    expect(mocks.deleteAcceptance).toHaveBeenCalledWith('acceptance-1');
    expect(mocks.updateVerifyConfig).toHaveBeenCalledWith('T-231', {
      enabled: false,
      requirement: null,
      verifyCriteriaIds: null,
    });
    // Config clears BEFORE the aggregate is deleted: the inverse order could
    // destroy the record and then fail, leaving a stale config to recreate it.
    expect(mocks.updateVerifyConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteAcceptance.mock.invocationCallOrder[0],
    );
    expect(mocks.mutateSubject).toHaveBeenCalled();
  });

  it('aborts removal without deleting the aggregate when the config clear fails', async () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [{ category: 'Setup', id: 'c1', seq: 1, title: 'Create task' }],
      isOwner: true,
    };
    mocks.updateVerifyConfig.mockRejectedValueOnce(new Error('config write failed'));

    render(<TaskAcceptance />);

    fireEvent.click(screen.getByText('taskDetail.acceptance.remove'));
    const opts = mocks.confirmModal.mock.calls[0][0] as { onOk: () => Promise<void> };
    await expect(opts.onOk()).rejects.toThrow('config write failed');

    expect(mocks.deleteAcceptance).not.toHaveBeenCalled();
    expect(mocks.mutateSubject).not.toHaveBeenCalled();
  });

  it('hides the remove button when the viewer does not own the acceptance', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [{ category: 'Setup', id: 'c1', seq: 1, title: 'Create task' }],
      isOwner: false,
    };

    render(<TaskAcceptance />);

    expect(screen.getByText('Create task')).toBeInTheDocument();
    expect(screen.queryByText('taskDetail.acceptance.remove')).not.toBeInTheDocument();
  });

  it('keeps the Acceptance cross-round union visible in Task detail', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: [
        { category: 'Current', id: 'c1', seq: 1, title: 'Current check' },
        { category: 'Historical', id: 'old', seq: 2, title: 'Removed check' },
      ],
      isOwner: true,
    };

    render(<TaskAcceptance />);

    expect(screen.getByText('Current check')).toBeInTheDocument();
    expect(screen.getByText('Removed check')).toBeInTheDocument();
  });

  it('groups a checklist only after it exceeds ten checks', () => {
    mocks.acceptanceSubject = { id: 'acceptance-1' };
    mocks.bundle = {
      acceptance: { id: 'acceptance-1', requirement: 'Everything is verifiable.' },
      checks: Array.from({ length: 11 }, (_, index) => ({
        category: index < 6 ? 'Setup' : 'Result',
        id: `c${index + 1}`,
        seq: index + 1,
        title: `Check ${index + 1}`,
      })),
      isOwner: true,
    };

    render(<TaskAcceptance />);

    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('taskDetail.acceptance.collapseAll')).toBeInTheDocument();
    expect(screen.getByText('Check 11')).toBeInTheDocument();
  });
});
