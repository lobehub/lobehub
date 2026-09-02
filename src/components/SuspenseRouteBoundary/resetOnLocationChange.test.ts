import { describe, expect, it } from 'vitest';

import { resetOnLocationChange, routeResetKey } from './resetOnLocationChange';

describe('routeResetKey', () => {
  it('separates two queries on the same path', () => {
    expect(routeResetKey('/community/skill', '?page=1')).not.toBe(
      routeResetKey('/community/skill', '?page=2'),
    );
  });
});

describe('resetOnLocationChange', () => {
  const error = new Error('boom');

  it('keeps the failure while the location is unchanged', () => {
    expect(resetOnLocationChange('/eval', { error, resetKey: '/eval' })).toBeNull();
  });

  it('clears the failure when the pathname changes', () => {
    expect(
      resetOnLocationChange('/community/model', { error, resetKey: '/community/agent' }),
    ).toEqual({ error: undefined, resetKey: '/community/model' });
  });

  it('clears the failure when only the query changes', () => {
    expect(
      resetOnLocationChange('/community/skill?page=2', {
        error,
        resetKey: '/community/skill?page=1',
      }),
    ).toEqual({ error: undefined, resetKey: '/community/skill?page=2' });
  });
});
