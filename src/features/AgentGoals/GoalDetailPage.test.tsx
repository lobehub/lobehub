/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSidePanelProvider } from '@/features/RightPanel/WorkspaceSidePanel';

import GoalDetailPage from './GoalDetailPage';

const mocks = vi.hoisted(() => ({
  canEdit: true,
  graphError: undefined as unknown,
  hasSnapshot: true,
  hasSupervision: true,
  recovery: { pending: false } as { pending: boolean },
  showPortal: false,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/store/goal', () => ({
  goalSelectors: {
    goalGraph: () => () =>
      mocks.hasSnapshot
        ? {
            goal: {
              agentId: 'agt_manager',
              config: mocks.hasSupervision
                ? { manager: true, managerState: { topicId: 'tpc_manager' } }
                : {},
              id: 'goal_1',
              projectId: null,
              requirement: 'Reach 1,100 followers',
              status: 'review',
              title: 'Ship it',
            },
            nodes: [],
          }
        : undefined,
  },
  useGoalStore: (selector: (s: any) => unknown) =>
    selector({
      pauseGoal: vi.fn(),
      resumeGoal: vi.fn(),
      useFetchGoalGraph: () => ({ error: mocks.graphError, isLoading: false, mutate: vi.fn() }),
    }),
}));

vi.mock('@/features/Workspace/useLocateInOtherScope', () => ({
  useOtherScopeRecovery: () => mocks.recovery,
}));

vi.mock('@/components/Skeleton/GoalDetail', () => ({
  default: () => <div data-testid="goal-detail-skeleton" />,
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: any) => unknown) => selector({ featureFlags: {} }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: any) => unknown) => selector({ clearPortalStack: vi.fn() }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { currentViewType: () => undefined, showPortal: () => mocks.showPortal },
}));

vi.mock('@/store/global', () => {
  // The assignee picker reads persisted UI status (folded groups, recents).
  const state = { status: {}, toggleLeftPanel: vi.fn(), updateSystemStatus: vi.fn() };
  return {
    useGlobalStore: Object.assign((selector: (s: any) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { showLeftPanel: () => false },
}));

// The main-agent picker follows a handover to the new agent's route.
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.canEdit }) }));

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

// The toggle itself is store-backed (agent display meta); its own contract is
// that a press reaches `onToggle`, so the page tests drive the press, not the avatar.
vi.mock('./GoalSupervisorToggle', () => ({
  default: ({ label, onToggle }: { label: string; onToggle: () => void }) => (
    <button data-testid="goal-supervisor-toggle" onClick={onToggle}>
      {label}
    </button>
  ),
}));

vi.mock('@/features/Portal/router', () => ({
  PortalContent: () => <div data-testid="goal-portal-content" />,
}));
vi.mock('@/features/Favorites', () => ({
  FavoriteButton: () => null,
  useCurrentFavoritePath: () => '/favorite-path',
  useFavoriteMenuItem: () => null,
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
vi.mock('./GoalChat', () => ({
  default: ({
    agentId,
    initialMessage,
    initialTopicId,
  }: {
    agentId: string;
    initialMessage?: string;
    initialTopicId?: string;
  }) => (
    <div
      data-agent-id={agentId}
      data-initial-message={initialMessage}
      data-initial-topic-id={initialTopicId}
      data-testid="goal-chat"
    />
  ),
}));
vi.mock('./GoalDetailActions', () => ({ default: () => null }));
vi.mock('./GoalHeaderMetrics', () => ({ default: () => null }));
vi.mock('./GoalRequirement', () => ({ default: () => <div data-testid="goal-requirement" /> }));
vi.mock('./NorthStarMetrics', () => ({ default: () => <div data-testid="goal-north-star" /> }));
// The result page's composer lives inside ProcessControl; the page owns where
// its message goes, so the stub only exposes the hand-off.
vi.mock('./ProcessControl', () => ({
  default: ({ onFollowUp }: { onFollowUp?: (message: string) => void }) =>
    onFollowUp ? (
      <button data-testid="goal-follow-up" onClick={() => onFollowUp('what next?')}>
        follow up
      </button>
    ) : null,
}));
vi.mock('./GoalSupervision', () => ({
  GoalSupervision: ({
    initialMessage,
    onOpenChat,
    onSelectTopic,
    topicId,
  }: {
    initialMessage?: string;
    onOpenChat?: () => void;
    onSelectTopic?: (topicId: string) => void;
    topicId: string;
  }) => (
    <div data-initial-message={initialMessage} data-testid="goal-supervision">
      {topicId}
      {onOpenChat && (
        <button data-testid="goal-supervision-open-chat" onClick={onOpenChat}>
          open chat
        </button>
      )}
      {onSelectTopic && (
        <button
          data-testid="goal-supervision-pick-topic"
          onClick={() => onSelectTopic('tpc_other')}
        >
          pick topic
        </button>
      )}
    </div>
  ),
}));

describe('GoalDetailPage', () => {
  beforeEach(() => {
    mocks.canEdit = true;
    mocks.graphError = undefined;
    mocks.hasSnapshot = true;
    mocks.hasSupervision = true;
    mocks.recovery = { pending: false };
    mocks.showPortal = false;
  });

  // The measured numbers are what executing the requirement has observed, so
  // they read below it as its outcome.
  it('renders the north-star metrics below the requirement', () => {
    render(<GoalDetailPage goalId={'goal_1'} />);

    expect(
      screen
        .getByTestId('goal-requirement')
        .compareDocumentPosition(screen.getByTestId('goal-north-star')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // On the agent-less route the task workspace owns the portal host, but the
  // supervision record has no other home: the supervising agent's avatar must
  // still open it, and must name it as the supervision record to open.
  it('opens the supervision record from the supervising agent avatar on the agent-less route', () => {
    render(
      <WorkspaceSidePanelProvider>
        <GoalDetailPage goalId={'goal_1'} />
      </WorkspaceSidePanelProvider>,
    );

    expect(screen.getByTestId('goal-supervisor-toggle')).toHaveTextContent(
      'goalProcess.manager.viewTrace',
    );
    fireEvent.click(screen.getByTestId('goal-supervisor-toggle'));

    expect(screen.getByTestId('goal-supervision')).toHaveTextContent('tpc_manager');
    expect(screen.getByTestId('goal-right-panel')).toHaveAttribute('data-expand', 'true');
  });

  // The fallback has to resolve on the agent-less route too: there the route
  // names no agent and an unmanaged goal has no record, so the goal row's own
  // agent is the only thing that can say whose conversation this is.
  it('falls back to the goal agent’s conversation without a route agent or a record', () => {
    mocks.hasSupervision = false;
    render(<GoalDetailPage goalId={'goal_1'} />);

    expect(screen.getByTestId('goal-supervisor-toggle')).toHaveTextContent('goalChat.title');
    fireEvent.click(screen.getByTestId('goal-supervisor-toggle'));

    expect(screen.getByTestId('goal-chat')).toHaveAttribute('data-agent-id', 'agt_manager');
    expect(screen.getByTestId('goal-right-panel')).toHaveAttribute('data-expand', 'true');
  });

  // The result page's composer talks to the same conversation the header opens:
  // the supervision record when the goal has one, the side chat otherwise.
  it('sends a result follow-up into the supervision record when the goal has one', () => {
    render(<GoalDetailPage agentId={'agt_manager'} goalId={'goal_1'} />);

    fireEvent.click(screen.getByTestId('goal-follow-up'));

    expect(screen.getByTestId('goal-supervision')).toHaveAttribute(
      'data-initial-message',
      'what next?',
    );
    expect(screen.getByTestId('goal-right-panel')).toHaveAttribute('data-expand', 'true');
  });

  it('sends a result follow-up into the side chat when the goal has no record', () => {
    mocks.hasSupervision = false;
    render(<GoalDetailPage agentId={'agt_manager'} goalId={'goal_1'} />);

    fireEvent.click(screen.getByTestId('goal-follow-up'));

    expect(screen.getByTestId('goal-chat')).toHaveAttribute('data-initial-message', 'what next?');
  });

  // A viewer can read the result but the backend would reject their turn, so
  // the page offers no composer rather than one that fails on send.
  it('offers no result follow-up to someone who cannot create content', () => {
    mocks.canEdit = false;
    render(<GoalDetailPage agentId={'agt_manager'} goalId={'goal_1'} />);

    expect(screen.queryByTestId('goal-follow-up')).not.toBeInTheDocument();
  });

  // A goal bound to its supervision record keeps the panel on that topic: the
  // record offers no way out to a new or another conversation.
  it('keeps a bound goal’s panel on its supervision record', () => {
    render(<GoalDetailPage agentId={'agt_manager'} goalId={'goal_1'} />);

    fireEvent.click(screen.getByTestId('goal-supervisor-toggle'));

    expect(screen.getByTestId('goal-supervision')).toHaveTextContent('tpc_manager');
    expect(screen.queryByTestId('goal-supervision-open-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-supervision-pick-topic')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-chat')).not.toBeInTheDocument();
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

  // A 404 may only mean the goal lives in another of the user's spaces; while
  // those are probed the page keeps its loading frame instead of going blank.
  it('keeps the page skeleton while another space is being probed', () => {
    mocks.hasSnapshot = false;
    mocks.graphError = { data: { code: 'NOT_FOUND', httpStatus: 404 } };
    mocks.recovery = { pending: true };

    render(<GoalDetailPage goalId={'goal_1'} />);

    expect(screen.getByTestId('goal-detail-skeleton')).toBeTruthy();
  });
});
