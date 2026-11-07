import { describe, expect, it, vi } from 'vitest';

import { createSingleFlight } from './singleFlight';

/** A promise plus the handles to settle it from the test body. */
const deferred = <T>() => {
  let resolve!: (_value: T) => void;
  let reject!: (_reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

describe('createSingleFlight', () => {
  /**
   * The regression this exists for: Market rotates refresh tokens, so the second
   * of two overlapping refreshes replays a consumed token and fails. That
   * phantom failure used to wipe the credentials the first refresh had just
   * stored, stranding the user signed out with no refresh token left to recover
   * with.
   */
  it('runs the operation once for callers that overlap', async () => {
    const singleFlight = createSingleFlight<string>();
    const gate = deferred<string>();
    const run = vi.fn(() => gate.promise);

    const first = singleFlight(run);
    const second = singleFlight(run);

    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve('fresh-token');

    await expect(first).resolves.toBe('fresh-token');
    // The straggler observes the winner's result rather than a failure of its own
    await expect(second).resolves.toBe('fresh-token');
  });

  it('hands every overlapping caller the same promise', () => {
    const singleFlight = createSingleFlight<string>();
    const gate = deferred<string>();

    const first = singleFlight(() => gate.promise);
    const second = singleFlight(() => gate.promise);

    expect(second).toBe(first);

    gate.resolve('done');
  });

  it('is not a cache — a call after settling performs fresh work', async () => {
    const singleFlight = createSingleFlight<number>();
    const run = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(singleFlight(run)).resolves.toBe(1);
    await expect(singleFlight(run)).resolves.toBe(2);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection with overlapping callers and then recovers', async () => {
    const singleFlight = createSingleFlight<string>();
    const gate = deferred<string>();
    const failing = vi.fn(() => gate.promise);

    const first = singleFlight(failing);
    const second = singleFlight(failing);

    gate.reject(new Error('invalid_grant'));

    await expect(first).rejects.toThrow('invalid_grant');
    await expect(second).rejects.toThrow('invalid_grant');

    // A failed flight must not wedge the gate shut
    const succeeding = vi.fn().mockResolvedValue('recovered');
    await expect(singleFlight(succeeding)).resolves.toBe('recovered');
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
