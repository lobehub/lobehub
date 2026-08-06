import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavPanel from './index';
import { NavPanelPortal } from './NavPanelPortal';
import { clearNavPanelRegistry } from './registry';
import NavPanelShell from './Shell';

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

vi.mock('./components/NavPanelDraggable', () => ({
  NavPanelDraggable: ({ activeContent }: NavPanelDraggableMockProps) => (
    <div data-nav-key={activeContent.key} data-testid="nav-panel">
      {activeContent.node}
    </div>
  ),
}));

vi.mock('@/features/HomeSidebar/Content', () => ({
  default: () => <div>Home sidebar</div>,
}));

describe('NavPanel', () => {
  beforeEach(() => {
    pathname = '/lobe-team/settings/general';
    clearNavPanelRegistry();
  });

  it('selects the route-owned entry instead of a concurrently registered Home entry', async () => {
    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanelPortal navKey="workspace-settings">
          <div>Workspace settings sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace settings sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'workspace-settings');
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });

  it('uses the Home entry for routes without a dedicated navigation panel', async () => {
    pathname = '/lobe-team/tasks';

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByText('Home sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'home');
  });

  it('shows a route-keyed fallback instead of stale Home content while a dedicated portal loads', async () => {
    pathname = '/lobe-team/community';

    render(
      <>
        <NavPanelPortal navKey="home">
          <div>Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'pending:discover');
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });

  it('gives the settings skeleton a search placeholder', async () => {
    pathname = '/settings/profile';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-sidebar-skeleton-search')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sidebar-skeleton-nav')).not.toBeInTheDocument();
  });

  it('drops the search placeholder for the searchless workspace settings sidebar', async () => {
    pathname = '/lobe-team/settings/general';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-sidebar-skeleton-search')).not.toBeInTheDocument();
  });

  it('shapes the skeleton per nav key: discover is header-plus-nav with no body', async () => {
    pathname = '/community';

    render(<NavPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-sidebar-skeleton-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sidebar-skeleton-search')).not.toBeInTheDocument();
  });

  it('does not let an older owner cleanup remove the newer entry for the same key', async () => {
    const Harness = ({ showOld }: { showOld: boolean }) => (
      <>
        {showOld && (
          <NavPanelPortal key="old" navKey="home">
            <div>Old Home sidebar</div>
          </NavPanelPortal>
        )}
        <NavPanelPortal key="new" navKey="home">
          <div>New Home sidebar</div>
        </NavPanelPortal>
        <NavPanel />
      </>
    );

    pathname = '/';
    const { rerender } = render(<Harness showOld />);

    await waitFor(() => {
      expect(screen.getByText('New Home sidebar')).toBeInTheDocument();
    });

    rerender(<Harness showOld={false} />);

    await waitFor(() => {
      expect(screen.getByText('New Home sidebar')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });
});

describe('NavPanelShell', () => {
  beforeEach(() => {
    clearNavPanelRegistry();
  });

  it('provides the Home entry on routes that never mount the Home layout', async () => {
    pathname = '/tasks';

    render(<NavPanelShell />);

    await waitFor(() => {
      expect(screen.getByText('Home sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-panel')).toHaveAttribute('data-nav-key', 'home');
    expect(screen.queryByTestId('nav-sidebar-skeleton')).not.toBeInTheDocument();
  });

  it('still yields to a dedicated route panel', async () => {
    pathname = '/community';

    render(<NavPanelShell />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-sidebar-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByText('Home sidebar')).not.toBeInTheDocument();
  });
});
