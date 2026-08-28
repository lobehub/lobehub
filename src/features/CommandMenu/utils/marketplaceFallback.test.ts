import { describe, expect, it } from 'vitest';

import { shouldShowMarketplaceFallback } from './marketplaceFallback';

const base = {
  hasLocalTopicResults: false,
  hasResults: false,
  isLoading: false,
  typeFilter: undefined,
};

describe('shouldShowMarketplaceFallback', () => {
  it('should show once the search settles with no results', () => {
    expect(shouldShowMarketplaceFallback(base)).toBe(true);
  });

  it('should hide when the search has results', () => {
    expect(shouldShowMarketplaceFallback({ ...base, hasResults: true })).toBe(false);
  });

  it('should hide when local generation topics match', () => {
    expect(shouldShowMarketplaceFallback({ ...base, hasLocalTopicResults: true })).toBe(false);
  });

  it('should hide while the search is still loading', () => {
    expect(shouldShowMarketplaceFallback({ ...base, isLoading: true })).toBe(false);
  });

  it('should hide when a type filter is active', () => {
    expect(shouldShowMarketplaceFallback({ ...base, typeFilter: 'mcp' })).toBe(false);
  });
});
