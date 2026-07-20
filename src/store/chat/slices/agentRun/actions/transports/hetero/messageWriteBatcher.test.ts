import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessageWriteBatcher } from './messageWriteBatcher';

const createDeps = () => ({
  batchMutate: vi.fn().mockResolvedValue({ results: [], success: true }),
  createMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  updateMessage: vi.fn().mockResolvedValue({ success: true }),
  updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
});

const createRow = (id: string, parentId?: string) =>
  ({ content: '', id, parentId, role: 'assistant' }) as any;

describe('createMessageWriteBatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('holds writes until flushed, then sends them as one batch', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    batcher.enqueueCreateMessage(createRow('msg-a'));
    batcher.enqueueCreateMessage(createRow('msg-b'));

    expect(deps.batchMutate).not.toHaveBeenCalled();

    await batcher.flush('test');

    expect(deps.batchMutate).toHaveBeenCalledTimes(1);
    expect(deps.batchMutate.mock.calls[0][0]).toHaveLength(2);
  });

  it('flushing an empty queue is a no-op', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    await batcher.flush('test');

    expect(deps.batchMutate).not.toHaveBeenCalled();
  });

  /**
   * The semantic that made subagent rows die against `messages_parent_id_messages_id_fk`:
   * a failed create is reported ONLY through `onFailure`, and `flush` still resolves.
   * Awaiting a flush therefore proves nothing about whether the row landed — the
   * executor has to track failures itself (`pendingCreates`) and re-check before
   * writing anything that FKs to that row.
   */
  it('resolves the flush even when a create fails, reporting it only via onFailure', async () => {
    const deps = createDeps();
    deps.batchMutate.mockResolvedValue({
      results: [{ error: 'messages_parent_id_messages_id_fk', index: 0, success: false }],
      success: false,
    });
    const batcher = createMessageWriteBatcher(deps);
    const onFailure = vi.fn();

    batcher.enqueueCreateMessage(createRow('msg-parent'), onFailure);

    await expect(batcher.flush('test')).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('reports every queued op when batchMutate throws outright', async () => {
    const deps = createDeps();
    const boom = new Error('network down');
    deps.batchMutate.mockRejectedValue(boom);
    const batcher = createMessageWriteBatcher(deps);
    const onFailureA = vi.fn();
    const onFailureB = vi.fn();

    batcher.enqueueCreateMessage(createRow('msg-a'), onFailureA);
    batcher.enqueueCreateMessage(createRow('msg-b'), onFailureB);

    await expect(batcher.flush('test')).resolves.toBeUndefined();

    expect(onFailureA).toHaveBeenCalledWith(boom);
    expect(onFailureB).toHaveBeenCalledWith(boom);
  });

  it('marks all ops failed when the batch reports failure without per-op indexes', async () => {
    const deps = createDeps();
    deps.batchMutate.mockResolvedValue({ success: false });
    const batcher = createMessageWriteBatcher(deps);
    const onFailure = vi.fn();

    batcher.enqueueCreateMessage(createRow('msg-a'), onFailure);

    await batcher.flush('test');

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('coalesces consecutive updates to the same row, deep-merging metadata', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    batcher.enqueueUpdateMessage('msg-a', { content: 'hel', metadata: { a: 1 } } as any);
    batcher.enqueueUpdateMessage('msg-a', { content: 'hello', metadata: { b: 2 } } as any);

    await batcher.flush('test');

    const ops = deps.batchMutate.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].value).toMatchObject({ content: 'hello', metadata: { a: 1, b: 2 } });
  });

  it('does not coalesce updates that carry an onFailure ledger hook', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    batcher.enqueueUpdateMessage('msg-a', { content: 'one' } as any, undefined, vi.fn());
    batcher.enqueueUpdateMessage('msg-a', { content: 'two' } as any, undefined, vi.fn());

    await batcher.flush('test');

    expect(deps.batchMutate.mock.calls[0][0]).toHaveLength(2);
  });

  it('preserves enqueue order — which is FK dependency order', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    batcher.enqueueCreateMessage(createRow('assistant-1'));
    batcher.enqueueCreateMessage(createRow('tool-1', 'assistant-1'));
    batcher.enqueueCreateMessage(createRow('assistant-2', 'tool-1'));

    await batcher.flush('test');

    expect(deps.batchMutate.mock.calls[0][0].map((op: any) => op.message.id)).toEqual([
      'assistant-1',
      'tool-1',
      'assistant-2',
    ]);
  });

  it('auto-flushes once the queue hits the max-ops ceiling', async () => {
    const deps = createDeps();
    const batcher = createMessageWriteBatcher(deps);

    for (let i = 0; i < 50; i += 1) batcher.enqueueCreateMessage(createRow(`msg-${i}`));
    await batcher.flush('test');

    expect(deps.batchMutate).toHaveBeenCalledTimes(1);
    expect(deps.batchMutate.mock.calls[0][0]).toHaveLength(50);
  });

  it('falls back to per-op writes when batchMutate is unavailable', async () => {
    const deps = { ...createDeps(), batchMutate: undefined };
    const batcher = createMessageWriteBatcher(deps as any);

    batcher.enqueueCreateMessage(createRow('msg-a'));
    batcher.enqueueUpdateMessage('msg-b', { content: 'x' } as any);

    await batcher.flush('test');

    expect(deps.createMessage).toHaveBeenCalledTimes(1);
    expect(deps.updateMessage).toHaveBeenCalledTimes(1);
  });

  it('surfaces a per-op failure through onFailure in the no-batchMutate fallback', async () => {
    const deps = { ...createDeps(), batchMutate: undefined };
    const boom = new Error('insert failed');
    deps.createMessage.mockRejectedValue(boom);
    const batcher = createMessageWriteBatcher(deps as any);
    const onFailure = vi.fn();

    batcher.enqueueCreateMessage(createRow('msg-a'), onFailure);

    await expect(batcher.flush('test')).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(boom);
  });
});
