import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mobileRoutes } from '@/spa/router/mobileRouter.config';
import { SidebarTabKey } from '@/store/global/initialState';

import { shouldShowMobileNav } from './index';
import { getMobileActiveTabKey } from './NavBar';

describe('mobile workspace navigation', () => {
  it('keeps the workspace root on the mobile workspace home route', () => {
    const matches = matchRoutes(mobileRoutes, '/acme');
    const leafRoute = matches?.at(-1)?.route;
    const leafElementType = (leafRoute?.element as { type?: { name?: string } } | undefined)?.type;

    expect(matches?.map((match) => match.route.path)).toContain(':workspaceSlug');
    expect(leafRoute?.index).toBe(true);
    expect(leafElementType?.name).not.toBe('Navigate');
  });

  it('shows bottom nav on personal and workspace list roots only', () => {
    expect(shouldShowMobileNav('/', null)).toBe(true);
    expect(shouldShowMobileNav('/acme', 'acme')).toBe(true);
    expect(shouldShowMobileNav('/acme/community', 'acme')).toBe(true);
    expect(shouldShowMobileNav('/agent/inbox', null)).toBe(false);
    expect(shouldShowMobileNav('/community/agent/jailbreak', null)).toBe(false);
  });

  it('normalizes active bottom nav tabs for personal and workspace paths', () => {
    expect(getMobileActiveTabKey('/')).toBe(SidebarTabKey.Chat);
    expect(getMobileActiveTabKey('/acme')).toBe(SidebarTabKey.Chat);
    expect(getMobileActiveTabKey('/community')).toBe(SidebarTabKey.Community);
    expect(getMobileActiveTabKey('/acme/community')).toBe(SidebarTabKey.Community);
    expect(getMobileActiveTabKey('/agent/inbox')).toBe(SidebarTabKey.Chat);
    expect(getMobileActiveTabKey('/acme/agent/inbox')).toBe(SidebarTabKey.Chat);
  });
});
