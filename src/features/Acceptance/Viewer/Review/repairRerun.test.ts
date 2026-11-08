import { describe, expect, it, vi } from 'vitest';

import { dispatchRepairRerun } from './repairRerun';

describe('dispatchRepairRerun', () => {
  it('marks repairing after a successful dispatch', async () => {
    const markRepairing = vi.fn().mockResolvedValue(undefined);

    const outcome = await dispatchRepairRerun({
      dispatch: vi.fn().mockResolvedValue(undefined),
      markRepairing,
    });

    expect(outcome).toEqual({ dispatched: true, markFailed: false });
    expect(markRepairing).toHaveBeenCalledTimes(1);
  });

  it('propagates a dispatch failure so the caller may retry', async () => {
    const markRepairing = vi.fn();

    await expect(
      dispatchRepairRerun({
        dispatch: vi.fn().mockRejectedValue(new Error('network')),
        markRepairing,
      }),
    ).rejects.toThrow('network');
    // Nothing started server-side — the repairing stamp must not run.
    expect(markRepairing).not.toHaveBeenCalled();
  });

  it('reports a dispatched run even when the repairing stamp fails', async () => {
    // Codex P1: a failure AFTER the dispatch must not read as retryable — the
    // repair run is already live, and retrying would double-run it.
    const outcome = await dispatchRepairRerun({
      dispatch: vi.fn().mockResolvedValue(undefined),
      markRepairing: vi.fn().mockRejectedValue(new Error('stamp failed')),
    });

    expect(outcome).toEqual({ dispatched: true, markFailed: true });
  });
});
