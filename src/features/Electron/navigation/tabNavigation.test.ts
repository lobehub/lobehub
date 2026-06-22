import { describe, expect, it } from 'vitest';

import { resolveTabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

import { resolveTabNavigationAction } from './tabNavigation';

const tab = (id: string, url: string): TabItem => ({
  id,
  lastVisited: 1,
  scope: resolveTabScope(url),
  url,
});

describe('resolveTabNavigationAction', () => {
  it('opens a new tab when navigation crosses from personal to workspace scope', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'personal',
        currentUrl: '/acme/agent/workspace-agent',
        tabs: [tab('personal', '/agent/personal-agent')],
      }),
    ).toEqual({ type: 'add', url: '/acme/agent/workspace-agent' });
  });

  it('opens a new tab when navigation crosses from workspace to personal scope', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'workspace',
        currentUrl: '/agent/personal-agent',
        tabs: [tab('workspace', '/acme/agent/workspace-agent')],
      }),
    ).toEqual({ type: 'add', url: '/agent/personal-agent' });
  });

  it('updates the active tab for same-scope navigation', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'workspace',
        currentUrl: '/acme/group/g1',
        tabs: [tab('workspace', '/acme/agent/a1')],
      }),
    ).toEqual({ id: 'workspace', type: 'update', url: '/acme/group/g1' });
  });

  it('activates an existing tab with the same scoped target', () => {
    expect(
      resolveTabNavigationAction({
        activeTabId: 'personal',
        currentUrl: '/acme/agent/a1?b=2&a=1',
        tabs: [tab('personal', '/agent/a1'), tab('workspace', '/acme/agent/a1?a=1&b=2')],
      }),
    ).toEqual({ id: 'workspace', type: 'activate' });
  });
});
