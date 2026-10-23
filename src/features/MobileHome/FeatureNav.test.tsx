/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { FileText, HomeIcon, ListTodo, SearchIcon, Target } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FeatureNav from './FeatureNav';

const mocks = vi.hoisted(() => ({
  enableProjects: false,
  navigate: vi.fn(),
  workspaceSlug: null as null | string,
}));

vi.mock('@/hooks/useNavLayout', () => ({
  useNavLayout: () => ({
    bottomMenuItems: [
      { icon: FileText, key: 'community', title: 'Community', url: '/community' },
      { icon: FileText, key: 'pages', title: 'Pages', url: '/page' },
    ],
    topNavItems: [
      { icon: SearchIcon, key: 'search', onClick: vi.fn(), title: 'Search' },
      { icon: HomeIcon, key: 'home', title: 'Home', url: '/' },
      { icon: ListTodo, key: 'tasks', title: 'Tasks', url: '/tasks' },
      // `useNavLayout` hides goals while the lab is off.
      { hidden: true, icon: Target, key: 'goals', title: 'Goals', url: '/goals' },
    ],
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => mocks.enableProjects },
}));

const keys = () =>
  screen
    .getAllByRole('link')
    .map((item) => item.dataset.testid?.replace('mobile-feature-nav-', ''));

beforeEach(() => {
  mocks.enableProjects = false;
  mocks.navigate.mockClear();
  mocks.workspaceSlug = null;
});

describe('MobileHome FeatureNav', () => {
  it('lists the desktop sidebar destinations the tab bar does not already cover', () => {
    render(<FeatureNav />);

    // Search needs the desktop command palette entry; home / community live in the tab bar;
    // hidden items stay hidden.
    expect(keys()).toEqual(['tasks', 'pages']);
  });

  it('adds projects only while the projects lab is on', () => {
    mocks.enableProjects = true;
    render(<FeatureNav />);

    expect(keys()).toEqual(['tasks', 'projects', 'pages']);
  });

  it('adds the workspace settings entry inside a workspace', () => {
    mocks.workspaceSlug = 'acme';
    render(<FeatureNav />);

    expect(keys()).toEqual(['tasks', 'pages', 'settings']);
  });

  it('navigates workspace-aware to the item url', () => {
    render(<FeatureNav />);

    fireEvent.click(screen.getByTestId('mobile-feature-nav-pages'));

    expect(mocks.navigate).toHaveBeenCalledWith('/page');
  });
});
