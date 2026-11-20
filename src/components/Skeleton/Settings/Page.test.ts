import { describe, expect, it } from 'vitest';

import { OWN_FRAME_TABS } from '@/features/Settings/features/ownFrameTabs';
import type { SettingsTabs } from '@/store/global/initialState';

import { resolveSettingsSkeletonTab } from './Page';
import { getSettingsTabSkeleton, SETTINGS_TAB_SKELETONS } from './tabs';

describe('resolveSettingsSkeletonTab', () => {
  it('reads the tab and its sub-segment', () => {
    expect(resolveSettingsSkeletonTab('/settings/messenger/discord')).toEqual({
      sub: 'discord',
      tab: 'messenger',
    });
    expect(resolveSettingsSkeletonTab('/settings/billing')).toEqual({ tab: 'billing' });
  });

  it('opens the profile for the bare settings path', () => {
    expect(resolveSettingsSkeletonTab('/settings')).toEqual({ tab: 'profile' });
  });
});

describe('SETTINGS_TAB_SKELETONS', () => {
  it('ignores inherited object keys', () => {
    expect(getSettingsTabSkeleton('toString')).toBeUndefined();
  });

  it('gives every own-frame tab with a registered skeleton a page', () => {
    for (const tab of OWN_FRAME_TABS) {
      const skeleton = SETTINGS_TAB_SKELETONS[tab as SettingsTabs];
      if (skeleton) expect(skeleton.Page, tab).toBeDefined();
    }
  });

  it('only gives own-frame tabs a page of their own', () => {
    for (const [tab, skeleton] of Object.entries(SETTINGS_TAB_SKELETONS)) {
      if (skeleton?.Page) expect(OWN_FRAME_TABS.has(tab), tab).toBe(true);
    }
  });
});
