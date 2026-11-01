import { DashboardIdentifier, LegacyDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { describe, expect, it } from 'vitest';

import { getFeatureDisabledToolIds, isToolEnabledByFeatureFlags } from './featureGates';

describe('feature-gated builtin tools', () => {
  it('drops the dashboard tool unless the dashboard flag is on', () => {
    expect(getFeatureDisabledToolIds(undefined)).toContain(DashboardIdentifier);
    expect(getFeatureDisabledToolIds(undefined)).toContain(LegacyDashboardIdentifier);
    expect(getFeatureDisabledToolIds({ enableDashboard: false })).toContain(DashboardIdentifier);
    expect(getFeatureDisabledToolIds({ enableDashboard: true })).not.toContain(DashboardIdentifier);
    expect(getFeatureDisabledToolIds({ enableDashboard: true })).not.toContain(
      LegacyDashboardIdentifier,
    );
  });

  it('only gates tools that declare a flag', () => {
    expect(isToolEnabledByFeatureFlags(DashboardIdentifier, {})).toBe(false);
    expect(isToolEnabledByFeatureFlags(DashboardIdentifier, { enableDashboard: true })).toBe(true);
    expect(isToolEnabledByFeatureFlags('lobe-web-browsing', {})).toBe(true);
  });
});
