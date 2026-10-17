import { describe, expect, it, vi } from 'vitest';

import { clientOnly } from './clientOnly';

const Loaded = () => null;

describe('clientOnly preload', () => {
  it('requests the chunk once however often it is preloaded', () => {
    const importFn = vi.fn(async () => ({ default: Loaded }));
    const View = clientOnly(importFn);

    View.preload();
    View.preload();

    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failed download', async () => {
    const importFn = vi
      .fn<() => Promise<{ default: typeof Loaded }>>()
      .mockRejectedValueOnce(new Error('chunk'))
      .mockResolvedValueOnce({ default: Loaded });
    const View = clientOnly(importFn);

    View.preload();
    await vi.waitFor(() => expect(importFn).toHaveBeenCalledTimes(1));
    // Let the rejection clear the cached request before asking again.
    await new Promise((resolve) => setTimeout(resolve));
    View.preload();

    expect(importFn).toHaveBeenCalledTimes(2);
  });
});
