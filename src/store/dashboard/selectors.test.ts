import { describe, expect, it } from 'vitest';

import type { DashboardStore } from './action';
import { dashboardSelectors } from './selectors';

const storeWith = (userId: string) =>
  ({ dashboardDetailMap: { d1: { id: 'd1', items: [], userId } } }) as unknown as DashboardStore;

describe('dashboardSelectors.canManageDashboard', () => {
  it('offers layout editing to the board creator only', () => {
    expect(dashboardSelectors.canManageDashboard('d1', 'u-owner')(storeWith('u-owner'))).toBe(true);
    expect(dashboardSelectors.canManageDashboard('d1', 'u-member')(storeWith('u-owner'))).toBe(
      false,
    );
  });

  it('offers nothing before the board or the user is known', () => {
    expect(dashboardSelectors.canManageDashboard('d1', undefined)(storeWith('u-owner'))).toBe(
      false,
    );
    expect(dashboardSelectors.canManageDashboard('d2', 'u-owner')(storeWith('u-owner'))).toBe(
      false,
    );
  });
});
