import { DashboardIdentifier, LegacyDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { describe, expect, it } from 'vitest';

import {
  getFeatureDisabledToolIds,
  getLabDisabledToolIds,
  isToolEnabledByFeatureFlags,
  isToolEnabledByLab,
} from './featureGates';

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

describe('Labs-gated builtin tools', () => {
  it('drops lobe-session unless Better Coding Experience is on', () => {
    expect(getLabDisabledToolIds(undefined)).toContain('lobe-session');
    expect(getLabDisabledToolIds({ enableBetterCodingExperience: false })).toContain(
      'lobe-session',
    );
    expect(getLabDisabledToolIds({ enableBetterCodingExperience: true })).not.toContain(
      'lobe-session',
    );
  });

  it('lists lobe-session only with the lab on, and leaves ungated tools alone', () => {
    expect(isToolEnabledByLab('lobe-session', {})).toBe(false);
    expect(isToolEnabledByLab('lobe-session', { enableBetterCodingExperience: true })).toBe(true);
    expect(isToolEnabledByLab('lobe-task', undefined)).toBe(true);
  });
});
