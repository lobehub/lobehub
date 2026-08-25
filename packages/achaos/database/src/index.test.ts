import type { ChaosRunContext } from '@achaos/core';
import { describe, expect, it, vi } from 'vitest';

import { createDatabaseChaosAdapter } from '.';

describe('createDatabaseChaosAdapter', () => {
  it('fails cleanup when a restorable mutation omitted its snapshot', async () => {
    const restore = vi.fn(async () => {});
    const adapter = createDatabaseChaosAdapter({ mutate: async () => ({}), restore });
    await expect(
      adapter.cleanup!(
        { adapter: 'database', injectionId: 'missing-snapshot' },
        {} as ChaosRunContext,
      ),
    ).rejects.toThrow('Database cleanup requires a mutation snapshot');
    expect(restore).not.toHaveBeenCalled();
  });
});
