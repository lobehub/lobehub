/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSidePanelProvider } from '@/features/RightPanel/WorkspaceSidePanel';

import GoalDetailPage from './GoalDetailPage';

const mocks = vi.hoisted(() => ({ showPortal: false }));

const snapshot = {
  goal: {
    agentId: 'agt_manager',
    config: { manager: true, managerState: { topicId: 'tpc_manager' } },
    id: 'goal_1',
    projectId: null,
    requirement: null,
    status: 'review',
    title: 'Ship it',
  },
  nodes: [],
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/store/goal', () => ({
  goalSelectors: { goalGraph: () => () => snapshot },
  useGoalStore: (selector: (s: any) => unknown) =>
    selector({
      pauseGoal: vi.fn(),
      resumeGoal: vi.fn(),
      useFetchGoalGraph: () => ({ error: undefined, isLoading: false, mutate: vi.fn() }),
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: any) => unknown) => selector({ clearPortalStack: vi.fn() }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { currentViewType: () => undefined, showPortal: () => mocks.showPortal },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: Object.assign(
    (selector: (s: any) => unknown) => selector({ toggleLeftPanel: vi.fn() }),
    { getState: () => ({ toggleLeftPanel: vi.fn() }) },
  ),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { showLeftPanel: () => false },
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

vi.mock('@/features/Portal/usePortalPanelWidth', () => ({
  usePortalPanelWidth: () => ({ maxWidth: 800, minWidth: 300, updateWidth: vi.fn(), width: 400 }),
}));

vi.mock('@/features/RightPanel', () => ({
  default: ({ children, expand }: { children: ReactNode; expand: boolean }) => (
    <div data-expand={String(expand)} data-testid="goal-right-panel">
      {children}
    </div>
  ),
}));

vi.mock('@/features/RightPanel/ToggleRightPanelButton', () => ({ default: () => null }));
vi.mock('@/features/Portal/router', () => ({
  PortalContent: () => <div data-testid="goal-portal-content" />,
}));
vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: { left: ReactNode; right: ReactNode }) => (
    <div>
      {left}
      {right}
    </div>
  ),
}));
vi.mock('@/features/AgentBreadcrumb', () => ({ default: () => null }));
vi.mock('@/features/AgentBreadcrumb/useAgentRoutePath', () => ({
  useAgentRoutePath: () => () => '/',
}));
vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./GoalChat', () => ({ default: () => <div data-testid="goal-chat" /> }));
vi.mock('./GoalDetailActions', () => ({ default: () => null }));
vi.mock('./GoalHeaderMetrics', () => ({ default: () => null }));
vi.mock('./GoalRequirement', () => ({ default: () => null }));
vi.mock('./NorthStarMetrics', () => ({ default: () => null }));
vi.mock('./ProcessControl', () => ({ default: () => null }));
vi.mock('./GoalSupervision', () => ({
  GoalSupervision: ({ topicId }: { topicId: string }) => (
    <div data-testid="goal-supervision">{topicId}</div>
  ),
}));

describe('GoalDetailPage', () => {
  beforeEach(() => {
    mocks.showPortal = false;
  });

  // On the agent-less route the task workspace owns the portal host, but the
  // supervision trace has no other home: "View trace" must still open it.
  it('opens the supervision trace on the agent-less workspace route', () => {
    render(
      <WorkspaceSidePanelProvider>
        <GoalDetailPage goalId={'goal_1'} />
      </WorkspaceSidePanelProvider>,
    );

    fireEvent.click(screen.getByText('goalProcess.manager.viewTrace'));

    expect(screen.getByTestId('goal-supervision')).toHaveTextContent('tpc_manager');
    expect(screen.getByTestId('goal-right-panel')).toHaveAttribute('data-expand', 'true');
  });

  it('leaves drill-downs to the workspace portal host on the agent-less route', () => {
    mocks.showPortal = true;
    render(
      <WorkspaceSidePanelProvider>
        <GoalDetailPage goalId={'goal_1'} />
      </WorkspaceSidePanelProvider>,
    );

    expect(screen.queryByTestId('goal-portal-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('goal-right-panel')).toHaveAttribute('data-expand', 'false');
  });

  it('hosts drill-downs itself outside the task workspace', () => {
    mocks.showPortal = true;
    render(<GoalDetailPage agentId={'agt_manager'} goalId={'goal_1'} />);

    expect(screen.getByTestId('goal-portal-content')).toBeInTheDocument();
  });
});
