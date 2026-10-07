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

describe('dashboardSelectors.isDashboardOutsideProject', () => {
  const storeWithProject = (projectId: string | null) =>
    ({
      dashboardDetailMap: { d1: { id: 'd1', items: [], projectId, userId: 'u' } },
    }) as unknown as DashboardStore;

  it('accepts a board of the route project', () => {
    expect(dashboardSelectors.isDashboardOutsideProject('d1', 'p1')(storeWithProject('p1'))).toBe(
      false,
    );
  });

  it('rejects a home board and another project board', () => {
    expect(dashboardSelectors.isDashboardOutsideProject('d1', 'p1')(storeWithProject(null))).toBe(
      true,
    );
    expect(dashboardSelectors.isDashboardOutsideProject('d1', 'p1')(storeWithProject('p2'))).toBe(
      true,
    );
  });

  it('waits for the board to load', () => {
    expect(dashboardSelectors.isDashboardOutsideProject('d2', 'p1')(storeWithProject('p2'))).toBe(
      false,
    );
  });
});
