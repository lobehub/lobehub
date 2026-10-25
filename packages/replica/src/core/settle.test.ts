import { afterEach, describe, expect, it, vi } from 'vitest';

import { settleWithin } from './settle';

afterEach(() => vi.useRealTimers());

describe('settleWithin', () => {
  it('resolves as soon as the promise settles, rejection included', async () => {
    await expect(settleWithin(Promise.resolve('x'), 1000)).resolves.toBeUndefined();
    await expect(settleWithin(Promise.reject(new Error('io')), 1000)).resolves.toBeUndefined();
  });

  it('resolves at the deadline when the promise never settles', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    void settleWithin(new Promise(() => {}), 50).then(settled);
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledOnce();
  });
});
