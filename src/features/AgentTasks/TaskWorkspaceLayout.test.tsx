/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskWorkspaceLayout from './TaskWorkspaceLayout';

const mocks = vi.hoisted(() => ({
  isMobile: false,
  portalView: null as null | string,
  showArtifactInTopicDrawer: false,
  showPortal: false,
  taskAgentPanelExpanded: true,
}));

vi.mock('react-router', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router')) as typeof import('react-router');

  return {
    ...actual,
    Outlet: () => <div data-testid="task-workspace-outlet">outlet</div>,
  };
});

vi.mock('@/features/AgentTaskManager/Conversation', () => ({
  default: () => <div data-testid="task-agent-conversation" />,
}));

vi.mock('@/features/AgentTaskManager/TaskAgentProvider', () => ({
  TaskAgentProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal', () => ({
  useTopicDrawerArtifactPortal: () => mocks.showArtifactInTopicDrawer,
}));

vi.mock('@/features/Portal/router', () => ({
  PortalContent: () => <div data-testid="task-agent-portal" />,
}));

vi.mock('@/features/RightPanel', () => ({
  default: ({ children, expand }: { children: ReactNode; expand: boolean }) => (
    <div data-expand={String(expand)} data-testid="task-agent-manager">
      {children}
    </div>
  ),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      portalStack: mocks.portalView ? [{ type: mocks.portalView }] : [],
      showPortal: mocks.showPortal,
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({
      showTaskAgentPanel: mocks.taskAgentPanelExpanded,
      toggleTaskAgentPanel: vi.fn(),
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    showTaskAgentPanel: (state: { showTaskAgentPanel: boolean }) => state.showTaskAgentPanel,
  },
}));

vi.mock('@/features/Portal/Mobile', () => ({
  default: () => <div data-testid="mobile-task-portal" />,
}));
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

describe('TaskWorkspaceLayout', () => {
  beforeEach(() => {
    mocks.isMobile = false;
    mocks.portalView = null;
    mocks.showArtifactInTopicDrawer = false;
    mocks.showPortal = false;
    mocks.taskAgentPanelExpanded = true;
  });

  it('renders the task workspace without mutating global NavPanel state', () => {
    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('task-workspace-outlet')).toBeInTheDocument();
    expect(screen.getByTestId('task-agent-manager')).toBeInTheDocument();
    expect(screen.getByTestId('task-agent-conversation')).toBeInTheDocument();
  });

  it('renders portal content when an artifact is opened from a task conversation', () => {
    mocks.portalView = 'artifact';
    mocks.showPortal = true;
    mocks.taskAgentPanelExpanded = false;

    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('task-agent-portal')).toBeInTheDocument();
    expect(screen.queryByTestId('task-agent-conversation')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-agent-manager')).toHaveAttribute('data-expand', 'true');
  });

  it('leaves an artifact from the run drawer out of the task assistant panel', () => {
    mocks.portalView = 'artifact';
    mocks.showArtifactInTopicDrawer = true;
    mocks.showPortal = true;
    mocks.taskAgentPanelExpanded = false;

    render(<TaskWorkspaceLayout />);

    expect(screen.queryByTestId('task-agent-portal')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-agent-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('task-agent-manager')).toHaveAttribute('data-expand', 'false');
  });

  it('mounts the Portal surface instead of the desktop task manager on mobile', () => {
    mocks.isMobile = true;

    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('mobile-task-portal')).toBeInTheDocument();
    expect(screen.queryByTestId('task-agent-manager')).not.toBeInTheDocument();
  });
});
