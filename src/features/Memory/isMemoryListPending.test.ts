import { describe, expect, it } from 'vitest';

import { isMemoryListPending } from './isMemoryListPending';

describe('isMemoryListPending', () => {
  it('uses full-surface loading for an initial request', () => {
    expect(isMemoryListPending({ error: undefined, initialized: false, loading: true })).toBe(true);
  });

  it('uses full-surface loading while a list resets', () => {
    expect(
      isMemoryListPending({
        error: undefined,
        initialized: true,
        loading: true,
        resetting: true,
      }),
    ).toBe(true);
  });

  it('keeps settled rows visible while a later page loads', () => {
    expect(isMemoryListPending({ error: undefined, initialized: true, loading: true })).toBe(false);
  });

  it('uses full-surface loading when retrying a surfaced error', () => {
    expect(
      isMemoryListPending({ error: new Error('failed'), initialized: true, loading: true }),
    ).toBe(true);
  });

  it('settles into the error state after a failed request', () => {
    expect(
      isMemoryListPending({ error: new Error('failed'), initialized: true, loading: false }),
    ).toBe(false);
  });
});
