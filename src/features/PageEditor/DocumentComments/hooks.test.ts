import { describe, expect, it } from 'vitest';

import { ANCHORED_EAGER_PAGE_LIMIT, nextEagerPageCount } from './hooks';

describe('nextEagerPageCount', () => {
  it('requests one more page while under the budget', () => {
    expect(nextEagerPageCount(1, ANCHORED_EAGER_PAGE_LIMIT)).toBe(2);
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT - 1, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT,
    );
  });

  it('stops at the budget instead of draining every page', () => {
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT,
    );
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT + 3, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT + 3,
    );
  });

  it('never fetches ahead with a zero budget (the panel is closed or it is the document list)', () => {
    expect(nextEagerPageCount(1, 0)).toBe(1);
  });
});
