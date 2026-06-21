import { describe, expect, it } from 'vitest';

import { getActiveTabKeyFromPathname } from '@/hooks/useActiveTabKey';
import { SidebarTabKey } from '@/store/global/initialState';

import { shouldShowMobileNav } from './mobileNavigation';

describe('mobile navigation normalization', () => {
  it('marks the mobile root as the chat tab', () => {
    expect(getActiveTabKeyFromPathname('/', { rootTabKey: SidebarTabKey.Chat })).toBe(
      SidebarTabKey.Chat,
    );
  });

  it('uses the workspace sub-route as the active tab', () => {
    expect(
      getActiveTabKeyFromPathname('/acme/community', {
        activeWorkspaceSlug: 'acme',
        rootTabKey: SidebarTabKey.Chat,
      }),
    ).toBe(SidebarTabKey.Community);
  });

  it('shows the bottom nav on workspace sub-tabs', () => {
    expect(shouldShowMobileNav('/acme/community', 'acme')).toBe(true);
    expect(shouldShowMobileNav('/acme/agent/inbox', 'acme')).toBe(true);
  });
});
