import { describe, expect, it, vi } from 'vitest';

import { resolveLiveRoundForItem } from '../liveRound';

const plan = [{ id: 'item-1' }];

const makeModels = (
  results: Record<string, { checkItemId: string; repairOperationId?: string | null }[]>,
  runsByOperation: Record<string, { id: string; plan: unknown }>,
) => ({
  resultModel: { listByRun: vi.fn(async (runId: string) => results[runId] ?? []) },
  runModel: { findByOperation: vi.fn(async (operationId: string) => runsByOperation[operationId]) },
});

describe('resolveLiveRoundForItem', () => {
  it('keeps the named round when the item was never repaired', async () => {
    const models = makeModels({ r1: [{ checkItemId: 'item-1' }] }, {});
    const run = await resolveLiveRoundForItem(models as any, { id: 'r1', plan } as any, 'item-1');
    expect(run.id).toBe('r1');
  });

  it('follows the repair chain to the latest round of the item', async () => {
    const models = makeModels(
      {
        r1: [{ checkItemId: 'item-1', repairOperationId: 'op-2' }],
        r2: [{ checkItemId: 'item-1', repairOperationId: 'op-3' }],
        r3: [{ checkItemId: 'item-1', repairOperationId: null }],
      },
      { 'op-2': { id: 'r2', plan }, 'op-3': { id: 'r3', plan } },
    );
    const run = await resolveLiveRoundForItem(models as any, { id: 'r1', plan } as any, 'item-1');
    expect(run.id).toBe('r3');
  });

  it('only follows the repair recorded on the submitted item', async () => {
    const models = makeModels(
      { r1: [{ checkItemId: 'other', repairOperationId: 'op-2' }, { checkItemId: 'item-1' }] },
      { 'op-2': { id: 'r2', plan } },
    );
    const run = await resolveLiveRoundForItem(models as any, { id: 'r1', plan } as any, 'item-1');
    expect(run.id).toBe('r1');
  });

  it('stays put when the repair round is missing or no longer plans the item', async () => {
    const missing = makeModels({ r1: [{ checkItemId: 'item-1', repairOperationId: 'op-2' }] }, {});
    expect(
      (await resolveLiveRoundForItem(missing as any, { id: 'r1', plan } as any, 'item-1')).id,
    ).toBe('r1');

    const replanned = makeModels(
      { r1: [{ checkItemId: 'item-1', repairOperationId: 'op-2' }] },
      { 'op-2': { id: 'r2', plan: [{ id: 'item-9' }] } },
    );
    expect(
      (await resolveLiveRoundForItem(replanned as any, { id: 'r1', plan } as any, 'item-1')).id,
    ).toBe('r1');
  });

  it('stops on a cycle instead of looping', async () => {
    const models = makeModels(
      {
        r1: [{ checkItemId: 'item-1', repairOperationId: 'op-2' }],
        r2: [{ checkItemId: 'item-1', repairOperationId: 'op-1' }],
      },
      { 'op-1': { id: 'r1', plan }, 'op-2': { id: 'r2', plan } },
    );
    const run = await resolveLiveRoundForItem(models as any, { id: 'r1', plan } as any, 'item-1');
    expect(run.id).toBe('r2');
  });
});
