import { describe, expect, it, vi } from 'vitest';

import { fetchEventSource } from './index';

describe('fatal SSE error handlers', () => {
  it('rejects the caller when its onerror handler throws', async () => {
    const failure = new Error('fetch failed');
    const fatal = new Error('do not retry');
    const request = fetchEventSource('https://example.invalid/events', {
      fetch: vi.fn().mockRejectedValue(failure),
      onerror: () => {
        throw fatal;
      },
      onopen: async () => {},
    });
    await expect(request).rejects.toBe(fatal);
  }, 250);

  it('retains the handled-error completion behavior', async () => {
    const failure = new Error('fetch failed');
    const onerror = vi.fn();
    await expect(
      fetchEventSource('https://example.invalid/events', {
        fetch: vi.fn().mockRejectedValue(failure),
        onerror,
        onopen: async () => {},
      }),
    ).resolves.toBeUndefined();
    expect(onerror).toHaveBeenCalledWith(failure);
  });
});
