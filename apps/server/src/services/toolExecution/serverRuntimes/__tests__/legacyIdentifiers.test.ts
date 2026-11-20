import { DashboardIdentifier, LegacyDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { GoalIdentifier, LegacyGoalIdentifier } from '@lobechat/builtin-tool-goal';
import { describe, expect, it } from 'vitest';

import { hasServerRuntime } from '../index';

describe('renamed builtin tools', () => {
  // Calls approved after a rename still name the tool by its old identifier.
  it.each([
    [GoalIdentifier, LegacyGoalIdentifier],
    [DashboardIdentifier, LegacyDashboardIdentifier],
  ])('runs %s calls persisted as %s', (identifier, legacy) => {
    expect(hasServerRuntime(identifier)).toBe(true);
    expect(hasServerRuntime(legacy)).toBe(true);
  });
});
