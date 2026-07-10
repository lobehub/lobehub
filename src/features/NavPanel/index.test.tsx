import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/lobe-team/settings/general';

interface WorkspaceMock {
  activeWorkspaceId: string;
  workspaces: { id: string; slug: string }[];
}

interface NavPanelDraggableMockProps {
  activeContent: {
    key: string;
    node: ReactNode;
  };
}

const workspaceState: WorkspaceMock = {
  activeWorkspaceId: 'workspace-1',
  workspaces: [{ id: 'workspace-1', slug: 'lobe-team' }],
};

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () =>
    workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeWorkspaceId)
      ?.slug ?? null,
}));

vi.mock('@/routes/(main)/home/_layout/SidebarContent', () => ({
  default: () => <div>Home sidebar</div>,
}));

vi.mock('@/features/WorkspaceSetting/SideBar/Content', () => ({
  default: () => <div>Workspace settings sidebar</div>,
}));

vi.mock('@/routes/(main)/settings/_layout/SidebarContent', () => ({
  default: () => <div>Personal settings sidebar</div>,
}));

vi.mock('@/routes/(main)/agent/_layout/Sidebar/Content', () => ({
  default: () => <div>Agent sidebar</div>,
}));

vi.mock('@/routes/(main)/group/_layout/Sidebar/Content', () => ({
  default: () => <div>Group sidebar</div>,
}));

vi.mock('@/routes/(main)/community/_layout/Sidebar/Content', () => ({
  default: () => <div>Community sidebar</div>,
}));

vi.mock('@/routes/(main)/resource/(home)/_layout/SidebarContent', () => ({
  default: () => <div>Resource sidebar</div>,
}));

vi.mock('@/routes/(main)/memory/_layout/Sidebar/Content', () => ({
  default: () => <div>Memory sidebar</div>,
}));

vi.mock('@/routes/(main)/eval/_layout/Sidebar/Content', () => ({
  default: () => <div>Eval sidebar</div>,
}));

vi.mock('@/features/Pages/PageLayout/SidebarContent', () => ({
  default: () => <div>Page sidebar</div>,
}));

vi.mock('@/routes/(main)/(create)/image/_layout/Sidebar/Content', () => ({
  default: () => <div>Image sidebar</div>,
}));

vi.mock('@/routes/(main)/(create)/video/_layout/Sidebar/Content', () => ({
  default: () => <div>Video sidebar</div>,
}));

vi.mock('./components/NavPanelDraggable', () => ({
  NavPanelDraggable: ({ activeContent }: NavPanelDraggableMockProps) => (
    <div data-nav-key={activeContent.key} data-testid="nav-panel">
      {activeContent.node}
    </div>
  ),
}));

describe('NavPanel', () => {
  beforeEach(() => {
    pathname = '/lobe-team/settings/general';
  });

  it('uses workspace settings sidebar instead of a stale home snapshot on workspace settings routes', async () => {
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace settings sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
  });

  it('uses personal settings sidebar instead of a stale home snapshot on user settings routes', async () => {
    pathname = '/settings/profile';
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal settings sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
  });

  it('uses agent sidebar instead of a stale home snapshot on workspace agent routes', async () => {
    pathname = '/lobe-team/agent/agent-1';
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'agent');
    });
    expect(screen.getByText('Agent sidebar')).toBeInTheDocument();
    expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
  });

  it.each([
    '/lobe-team/resource',
    '/lobe-team/community',
    '/lobe-team/memory',
    '/lobe-team/page',
    '/lobe-team/image',
    '/lobe-team/video',
    '/lobe-team/eval',
    '/lobe-team/group/group-1',
  ])('does not keep a stale home snapshot on %s', async (route) => {
    pathname = route;
    const { default: NavPanel, NavPanelPortal } = await import('./index');

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Stale home snapshot</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).not.toHaveAttribute('data-nav-key', 'home');
  });

  it.each(['/group/group-1', '/group/group-1/profile', '/lobe-team/group/group-1/profile'])(
    'uses the group sidebar fallback instead of a stale home snapshot on %s',
    async (route) => {
      pathname = route;
      const { default: NavPanel, NavPanelPortal } = await import('./index');

      render(
        <>
          <NavPanelPortal navKey="home">
            <div>Stale home snapshot</div>
          </NavPanelPortal>
          <NavPanel />
        </>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'group');
      });
      expect(screen.getByText('Group sidebar')).toBeInTheDocument();
      expect(screen.queryByText('Stale home snapshot')).not.toBeInTheDocument();
    },
  );

  it('uses the group sidebar fallback before its route portal registers', async () => {
    pathname = '/group/group-1/profile';
    const { default: NavPanel } = await import('./index');

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'group');
    });
    expect(screen.getByText('Group sidebar')).toBeInTheDocument();
  });

  it('uses the community sidebar fallback before its route portal registers', async () => {
    pathname = '/lobe-team/community';
    const { default: NavPanel } = await import('./index');

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'discover');
    });
    expect(screen.getByText('Community sidebar')).toBeInTheDocument();
  });

  it.each(['/lobe-team/tasks', '/lobe-team/task/task-1'])(
    'keeps the home sidebar on %s because it has no route sidebar',
    async (route) => {
      pathname = route;
      const { default: NavPanel, NavPanelPortal } = await import('./index');

      render(
        <>
          <NavPanelPortal navKey="home">
            <div>Home navigation snapshot</div>
          </NavPanelPortal>
          <NavPanel />
        </>,
      );

      await waitFor(() => {
        expect(screen.getByText('Home navigation snapshot')).toBeInTheDocument();
      });
      expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'home');
    },
  );
});
