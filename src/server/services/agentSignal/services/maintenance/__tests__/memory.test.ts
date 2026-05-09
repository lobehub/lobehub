import { describe, expect, it, vi } from 'vitest';

import { createMemoryMaintenanceService } from '../memory';

describe('memoryMaintenanceService', () => {
  /**
   * @example
   * Explicit stable preference is passed to the existing memory write adapter.
   */
  it('writes explicit stable memory through the injected adapter', async () => {
    const writeMemory = vi
      .fn()
      .mockResolvedValue({ memoryId: 'mem-1', summary: 'Saved preference.' });
    const service = createMemoryMaintenanceService({ writeMemory });

    await expect(
      service.writeMemory({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:write_memory:memory:concise',
        input: { content: 'User prefers concise PR summaries.', userId: 'user-1' },
      }),
    ).resolves.toEqual({ memoryId: 'mem-1', summary: 'Saved preference.' });

    expect(writeMemory).toHaveBeenCalledWith({
      content: 'User prefers concise PR summaries.',
      evidenceRefs: [{ id: 'msg-1', type: 'message' }],
      idempotencyKey: 'source:write_memory:memory:concise',
      userId: 'user-1',
    });
  });

  /**
   * @example
   * Sensitive inferred facts are rejected before reaching persistence.
   */
  it('rejects sensitive inferred memory candidates', async () => {
    const writeMemory = vi.fn();
    const service = createMemoryMaintenanceService({ writeMemory });

    await expect(
      service.writeMemory({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:write_memory:memory:sensitive',
        input: { content: 'User probably has a medical condition.', userId: 'user-1' },
      }),
    ).rejects.toThrow('Memory candidate is not safe for automatic write');

    expect(writeMemory).not.toHaveBeenCalled();
  });
});
