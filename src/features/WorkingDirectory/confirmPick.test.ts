import { describe, expect, it, vi } from 'vitest';

import { confirmPick } from './confirmPick';

describe('confirmPick', () => {
  it('closes once the pick has been applied', async () => {
    const close = vi.fn();
    const fail = vi.fn();

    await confirmPick({ apply: async () => {}, close, fail });

    expect(close).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
  });

  it('stays open and reports the failure when applying the pick fails', async () => {
    const close = vi.fn();
    const fail = vi.fn();
    const error = new Error('offline');

    await confirmPick({ apply: () => Promise.reject(error), close, fail });

    expect(close).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(error);
  });
});
