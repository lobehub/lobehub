import { describe, expect, it, vi } from 'vitest';

import { runWithLockRetry } from './retry';

describe('runWithLockRetry', () => {
  it('retries lock timeouts with increasing delays and succeeds', async () => {
    const firstLockError = { cause: { code: '55P03' } };
    const secondLockError = { code: '55P03' };
    const migrate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(firstLockError)
      .mockRejectedValueOnce(secondLockError)
      .mockResolvedValueOnce(undefined);
    const wait = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(runWithLockRetry(migrate, wait)).resolves.toBeUndefined();

    expect(migrate).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenNthCalledWith(1, 1000);
    expect(wait).toHaveBeenNthCalledWith(2, 3000);
  });

  it('does not retry non-lock errors and rethrows the same error', async () => {
    const error = { code: '23505' };
    const migrate = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const wait = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(runWithLockRetry(migrate, wait)).rejects.toBe(error);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('rethrows the final lock error after the maximum number of attempts', async () => {
    const error = { code: '55P03' };
    const migrate = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const wait = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(runWithLockRetry(migrate, wait)).rejects.toBe(error);

    expect(migrate).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenNthCalledWith(1, 1000);
    expect(wait).toHaveBeenNthCalledWith(2, 3000);
  });
});
