import { describe, expect, it, vi } from 'vitest';

import { INSERT_BATCH_SIZE, insertInBatches, splitCrossBatchSelfReferences } from './batchInsert';

describe('insertInBatches', () => {
  it('splits rows into INSERT_BATCH_SIZE chunks and preserves order', async () => {
    const rows = Array.from({ length: INSERT_BATCH_SIZE * 2 + 201 }, (_, i) => i);
    const batches: number[][] = [];

    await insertInBatches(rows, async (batch) => {
      batches.push([...batch]);
    });

    expect(batches.map((batch) => batch.length)).toEqual([
      INSERT_BATCH_SIZE,
      INSERT_BATCH_SIZE,
      201,
    ]);
    expect(batches.flat()).toEqual(rows);
  });

  it('runs batches sequentially', async () => {
    const rows = Array.from({ length: INSERT_BATCH_SIZE + 1 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    await insertInBatches(rows, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(1);
  });

  it('does nothing for an empty row set', async () => {
    const insertBatch = vi.fn();

    await insertInBatches([], insertBatch);

    expect(insertBatch).not.toHaveBeenCalled();
  });
});

describe('splitCrossBatchSelfReferences', () => {
  const makeRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`,
      parentId: null as string | null,
    }));

  it('keeps references that resolve within the same or an earlier batch', () => {
    const rows = makeRows(INSERT_BATCH_SIZE + 10);
    // same batch (both in batch 0)
    rows[1].parentId = 'row-0';
    // earlier batch (batch 1 row → batch 0 row)
    rows[INSERT_BATCH_SIZE + 1].parentId = 'row-3';

    const { fixups, rows: sanitized } = splitCrossBatchSelfReferences(rows, ['parentId']);

    expect(fixups).toEqual([]);
    expect(sanitized[1].parentId).toBe('row-0');
    expect(sanitized[INSERT_BATCH_SIZE + 1].parentId).toBe('row-3');
  });

  it('defers references that point into a later batch', () => {
    const rows = makeRows(INSERT_BATCH_SIZE + 10);
    // batch 0 row referencing a batch 1 row — would violate the FK mid-insert
    rows[0].parentId = `row-${INSERT_BATCH_SIZE + 5}`;

    const { fixups, rows: sanitized } = splitCrossBatchSelfReferences(rows, ['parentId']);

    expect(sanitized[0].parentId).toBeNull();
    expect(fixups).toEqual([{ id: 'row-0', patch: { parentId: `row-${INSERT_BATCH_SIZE + 5}` } }]);
    // input rows are not mutated
    expect(rows[0].parentId).toBe(`row-${INSERT_BATCH_SIZE + 5}`);
  });

  it('restates the row updatedAt in the fixup patch so $onUpdate cannot restamp it', () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const rows = Array.from({ length: INSERT_BATCH_SIZE + 10 }, (_, i) => ({
      id: `row-${i}`,
      parentId: null as string | null,
      updatedAt,
    }));
    rows[0].parentId = `row-${INSERT_BATCH_SIZE + 5}`;

    const { fixups } = splitCrossBatchSelfReferences(rows, ['parentId']);

    expect(fixups).toEqual([
      { id: 'row-0', patch: { parentId: `row-${INSERT_BATCH_SIZE + 5}`, updatedAt } },
    ]);
  });

  it('ignores references to ids outside the inserted set', () => {
    const rows = makeRows(3);
    rows[2].parentId = 'external-id';

    const { fixups, rows: sanitized } = splitCrossBatchSelfReferences(rows, ['parentId']);

    expect(fixups).toEqual([]);
    expect(sanitized[2].parentId).toBe('external-id');
  });

  it('collects multiple deferred fields on the same row into one fixup', () => {
    const rows = Array.from({ length: INSERT_BATCH_SIZE + 10 }, (_, i) => ({
      id: `row-${i}`,
      parentId: null as string | null,
      quotaId: null as string | null,
    }));
    rows[0].parentId = `row-${INSERT_BATCH_SIZE + 1}`;
    rows[0].quotaId = `row-${INSERT_BATCH_SIZE + 2}`;

    const { fixups, rows: sanitized } = splitCrossBatchSelfReferences(rows, [
      'parentId',
      'quotaId',
    ]);

    expect(sanitized[0]).toEqual(expect.objectContaining({ parentId: null, quotaId: null }));
    expect(fixups).toEqual([
      {
        id: 'row-0',
        patch: {
          parentId: `row-${INSERT_BATCH_SIZE + 1}`,
          quotaId: `row-${INSERT_BATCH_SIZE + 2}`,
        },
      },
    ]);
  });
});
