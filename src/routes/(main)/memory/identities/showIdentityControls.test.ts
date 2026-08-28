import { describe, expect, it } from 'vitest';

import { showIdentityControls } from './showIdentityControls';

const params = (overrides: Partial<Parameters<typeof showIdentityControls>[0]> = {}) => ({
  hasFilters: false,
  init: true,
  searchLoading: false,
  total: 0,
  ...overrides,
});

describe('showIdentityControls', () => {
  it('hides the controls for a genuinely empty collection', () => {
    expect(showIdentityControls(params())).toBe(false);
  });

  it('shows the controls once there are identities', () => {
    expect(showIdentityControls(params({ total: 3 }))).toBe(true);
  });

  it('stays hidden until the first page has resolved', () => {
    expect(showIdentityControls(params({ init: false, total: 3 }))).toBe(false);
  });

  it('keeps the search box when a filter returned no rows', () => {
    expect(showIdentityControls(params({ hasFilters: true }))).toBe(true);
  });

  it('holds the controls across a refetch, where total still describes the old query', () => {
    // Clearing a search on a non-empty collection: `hasFilters` already flipped
    // to false but `total` is still the filtered 0 until the fetch resolves.
    expect(showIdentityControls(params({ searchLoading: true }))).toBe(true);
  });
});
