import { describe, expect, it } from 'vitest';

import { getDashboardPath, getHomeDashboardRedirect } from './path';

describe('getDashboardPath', () => {
  it('opens a project board inside its project', () => {
    expect(getDashboardPath({ id: 'd-1', projectId: 'prj_1' })).toBe(
      '/project/prj_1/dashboard/d-1',
    );
  });

  it('opens a home board on the home dashboards', () => {
    expect(getDashboardPath({ id: 'd-1', projectId: null })).toBe('/dashboard/d-1');
    expect(getDashboardPath({ id: 'd-1' })).toBe('/dashboard/d-1');
  });
});

describe('getHomeDashboardRedirect', () => {
  it('sends a project board to its project path', () => {
    expect(getHomeDashboardRedirect({ id: 'd-1', projectId: 'prj_1' })).toBe(
      '/project/prj_1/dashboard/d-1',
    );
  });

  it('keeps a home board on the home route', () => {
    expect(getHomeDashboardRedirect({ id: 'd-1', projectId: null })).toBeUndefined();
    expect(getHomeDashboardRedirect({ id: 'd-1' })).toBeUndefined();
  });

  it('does not redirect before the board has loaded', () => {
    expect(getHomeDashboardRedirect(undefined)).toBeUndefined();
    expect(getHomeDashboardRedirect(null)).toBeUndefined();
  });
});
