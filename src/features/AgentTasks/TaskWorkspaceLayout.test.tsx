/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceSidePanel } from '@/features/RightPanel/WorkspaceSidePanel';

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
  const { useWorkspaceSidePanel } = await import('@/features/RightPanel/WorkspaceSidePanel');

  const Outlet = () => (
    <div data-testid="task-workspace-outlet">
      <span data-testid="side-panel-host">{String(useWorkspaceSidePanel())}</span>
    </div>
  );

  return {
    ...actual,
    Outlet,
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

const SidePanelProbe = () => (
  <span data-testid="side-panel-host">{String(useWorkspaceSidePanel())}</span>
);

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

  // The routed page must be able to tell that the side panel is already taken:
  // a second portal host would render the same detail twice and squeeze the
  // page's own content to nothing beside its copy (review feedback, r1).
  it('tells the routed page that the layout already owns the side panel', () => {
    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('side-panel-host')).toHaveTextContent('true');
  });

  it('reports no layout-owned side panel outside the workspace layout', () => {
    render(<SidePanelProbe />);

    expect(screen.getByTestId('side-panel-host')).toHaveTextContent('false');
  });
});
