import { describe, expect, it, vi } from 'vitest';

import { retryWithBackoff } from '../retryWithBackoff';

describe('retryWithBackoff', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation error'));

    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 2 }),
    ).rejects.toThrow('validation error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 2 }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('should retry on rate limit errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 503 errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 502 errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('502 Bad Gateway'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on ETIMEDOUT code', async () => {
    const err = new Error('connect ETIMEDOUT');
    (err as any).code = 'ETIMEDOUT';
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on ECONNREFUSED code', async () => {
    const err = new Error('connect ECONNREFUSED');
    (err as any).code = 'ECONNREFUSED';
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on socket hang up message', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on "too many requests" (case insensitive)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Too Many Requests'))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-Error values', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 2 }),
    ).rejects.toBe('string error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not retry when maxRetries=0', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 0 }),
    ).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should succeed without retry when maxRetries=0', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { baseDelayMs: 1, maxRetries: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
