// Fixture carve-out: waiting for an async condition without asserting on elapsed time.
import { describe, expect, it, vi } from 'vitest';

import { startPolling } from '../polling';

describe('startPolling', () => {
  it('polls until the callback reports done', async () => {
    const onTick = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

    await startPolling(onTick, { intervalMs: 5 });

    await vi.waitFor(() => expect(onTick).toHaveBeenCalledTimes(2));
  });
});
