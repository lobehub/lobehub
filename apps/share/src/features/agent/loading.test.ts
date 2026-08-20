import { describe, expect, it } from 'vitest';

import { shouldShowSharedAgentLoader } from './loading';

describe('shouldShowSharedAgentLoader', () => {
  it('keeps hydrated content visible during client revalidation', () => {
    expect(shouldShowSharedAgentLoader({ hasData: true, isLoading: true })).toBe(false);
  });

  it('shows the loader before shared agent data is available', () => {
    expect(shouldShowSharedAgentLoader({ hasData: false, isLoading: true })).toBe(true);
  });
});
