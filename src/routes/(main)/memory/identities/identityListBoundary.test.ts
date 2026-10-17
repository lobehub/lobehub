import { describe, expect, it } from 'vitest';

import { identityListBoundary } from './identityListBoundary';

const failure = new Error('offline');

describe('identityListBoundary', () => {
  it('renders the rows of the query on screen', () => {
    expect(identityListBoundary({ error: undefined, init: true, isStaleQuery: false })).toEqual({
      error: undefined,
      isResetting: false,
      showRows: true,
    });
  });

  it('hides the previous query’s rows while the new query resolves', () => {
    expect(identityListBoundary({ error: undefined, init: true, isStaleQuery: true })).toEqual({
      error: undefined,
      isResetting: true,
      showRows: false,
    });
  });

  it('surfaces the failure instead of the previous query’s rows when the new query fails', () => {
    const state = identityListBoundary({ error: failure, init: true, isStaleQuery: true });

    expect(state.showRows).toBe(false);
    expect(state.error).toBe(failure);
  });

  it('keeps the rows of the query on screen when only its revalidation fails', () => {
    expect(identityListBoundary({ error: failure, init: true, isStaleQuery: false })).toEqual({
      error: undefined,
      isResetting: false,
      showRows: true,
    });
  });

  it('shows the failure of a first load', () => {
    const state = identityListBoundary({ error: failure, init: false, isStaleQuery: true });

    expect(state.error).toBe(failure);
    expect(state.showRows).toBe(false);
  });
});
