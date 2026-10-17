import { describe, expect, it, vi } from 'vitest';

import { settleThenRefresh } from './settleThenRefresh';

describe('settleThenRefresh', () => {
  it('returns the mutation result even when the refresh fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('revalidation failed'));

    await expect(settleThenRefresh(async () => ({ stopped: true }), refresh)).resolves.toEqual({
      stopped: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the mutation error rather than the refresh error', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('revalidation failed'));

    await expect(
      settleThenRefresh(() => Promise.reject(new Error('SNAPSHOT_IN_PROGRESS')), refresh),
    ).rejects.toThrow('SNAPSHOT_IN_PROGRESS');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a failed mutation too', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);

    await expect(
      settleThenRefresh(() => Promise.reject(new Error('INSTANCE_IN_USE')), refresh),
    ).rejects.toThrow('INSTANCE_IN_USE');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
