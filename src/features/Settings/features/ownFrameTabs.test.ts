import { describe, expect, it } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import {
  getSettingsContainerMaxWidth,
  SETTINGS_CONTAINER_MAX_WIDTH,
  SETTINGS_PLANS_MAX_WIDTH,
} from './ownFrameTabs';

describe('getSettingsContainerMaxWidth', () => {
  it('gives the Plans tab a wider column than the shared one', () => {
    expect(getSettingsContainerMaxWidth(SettingsTabs.Plans)).toBe(SETTINGS_PLANS_MAX_WIDTH);
    expect(SETTINGS_PLANS_MAX_WIDTH).toBeGreaterThan(SETTINGS_CONTAINER_MAX_WIDTH);
  });

  it('lets the subscription account list span the pane, as on the workspace page', () => {
    expect(getSettingsContainerMaxWidth(SettingsTabs.SubscriptionAccounts)).toBe('100%');
  });

  it('keeps every other tab on the shared column', () => {
    expect(getSettingsContainerMaxWidth(SettingsTabs.Billing)).toBe(SETTINGS_CONTAINER_MAX_WIDTH);
    expect(getSettingsContainerMaxWidth(SettingsTabs.Appearance)).toBe(
      SETTINGS_CONTAINER_MAX_WIDTH,
    );
  });
});
