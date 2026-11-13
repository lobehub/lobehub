import { describe, expect, it, vi } from 'vitest';

import { settleInOrder } from './utils';

vi.mock('../finalizeHeteroDispatchError', () => ({ finalizeHeteroDispatchError: vi.fn() }));

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const failLater = (ms: number, message: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms));

describe('settleInOrder', () => {
  it('returns every value in argument order, however they finish', async () => {
    await expect(settleInOrder([later(20, 'a'), later(0, 1), later(10, true)])).resolves.toEqual([
      'a',
      1,
      true,
    ]);
  });

  it('rethrows the first failure in argument order, not the first to happen', async () => {
    await expect(
      settleInOrder([later(0, 'ok'), failLater(20, 'first'), failLater(0, 'second')]),
    ).rejects.toThrow('first');
  });

  it('waits for every read to settle before rethrowing', async () => {
    let slowSettled = false;
    const slow = later(20, 'slow').then((value) => {
      slowSettled = true;
      return value;
    });

    await expect(settleInOrder([failLater(0, 'boom'), slow])).rejects.toThrow('boom');
    expect(slowSettled).toBe(true);
  });
});
