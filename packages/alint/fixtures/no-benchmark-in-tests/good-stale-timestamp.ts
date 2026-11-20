// Fixture carve-out: how old a stored timestamp is — an expiry bound, not a duration.
import { describe, expect, it } from 'vitest';

import { settleStaleRunning } from '../lease';

describe('settleStaleRunning', () => {
  it('claims the expired lease', async () => {
    const orphanRow = { updatedAt: new Date(Date.now() - 30 * 60 * 1000), id: 'op-1' };

    await settleStaleRunning(orphanRow);

    const staleBefore = settleStaleRunning.mock.calls[0][1] as Date;
    expect(Date.now() - staleBefore.getTime()).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
  });
});
