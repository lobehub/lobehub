import { describe, expect, it } from 'vitest';

import { shouldSyncGroupRoute } from './groupRouteScope';

describe('shouldSyncGroupRoute', () => {
  it('only syncs the active desktop tab', () => {
    expect(shouldSyncGroupRoute(true, 'tab-a', 'tab-a')).toBe(true);
    expect(shouldSyncGroupRoute(true, 'tab-b', 'tab-a')).toBe(false);
  });

  it('syncs web routes without a tab context', () => {
    expect(shouldSyncGroupRoute(false, null, null)).toBe(true);
  });
});
