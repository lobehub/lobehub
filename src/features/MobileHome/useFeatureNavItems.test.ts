import { renderHook } from '@testing-library/react';
import { FileText, HomeIcon, ListTodo, SearchIcon, Target } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeatureNavItems } from './useFeatureNavItems';

const mocks = vi.hoisted(() => ({
  enableProjects: false,
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

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => mocks.enableProjects },
}));

const keysOf = () => renderHook(() => useFeatureNavItems()).result.current.map((i) => i.key);

beforeEach(() => {
  mocks.enableProjects = false;
  mocks.workspaceSlug = null;
});

describe('useFeatureNavItems', () => {
  it('keeps the desktop destinations the tab bar does not cover, in sidebar order', () => {
    // Search has the home search bar; home / community live in the tab bar;
    // items desktop hides stay hidden.
    expect(keysOf()).toEqual(['tasks', 'pages']);
  });

  it('adds projects only while the projects lab is on', () => {
    mocks.enableProjects = true;

    expect(keysOf()).toEqual(['tasks', 'projects', 'pages']);
  });

  it('adds the workspace settings entry inside a workspace', () => {
    mocks.workspaceSlug = 'acme';

    expect(keysOf()).toEqual(['tasks', 'pages', 'settings']);
  });

  it('gives every item a destination the shortcut can navigate to', () => {
    mocks.enableProjects = true;
    mocks.workspaceSlug = 'acme';

    const items = renderHook(() => useFeatureNavItems()).result.current;

    expect(items.every((item) => typeof item.url === 'string' && item.url.startsWith('/'))).toBe(
      true,
    );
  });
});
