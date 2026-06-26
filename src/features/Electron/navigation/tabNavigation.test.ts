import { describe, expect, it } from 'vitest';

import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

import { resolveTabNavigationAction } from './tabNavigation';

const tab = (id: string, url: string): TabItem => ({
  id,
  lastVisited: 1,
  url,
});

describe('resolveTabNavigationAction', () => {
  it('adds a tab when the active bucket has no active tab', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: null,
        currentUrl: '/agent/personal-agent',
        tabs: [],
      }),
    ).toEqual({ type: 'add', url: '/agent/personal-agent' });
  });

  it('updates the active tab when the current bucket has no matching target', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'workspace',
        currentUrl: '/acme/group/g1',
        tabs: [tab('workspace', '/acme/agent/a1')],
      }),
    ).toEqual({ id: 'workspace', type: 'update', url: '/acme/group/g1' });
  });

  it('activates an existing tab with the same target inside the active bucket', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'personal',
        currentUrl: '/acme/agent/a1?b=2&a=1',
        tabs: [tab('personal', '/agent/a1'), tab('workspace', '/acme/agent/a1?a=1&b=2')],
      }),
    ).toEqual({ id: 'workspace', type: 'activate' });
  });
});
