import { createSource } from '@lobechat/agent-signal';
import type {
  SourceToolOutcomeCompleted,
  SourceToolOutcomeFailed,
} from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { createToolOutcomeSourceHandler } from '../toolOutcome';

describe('tool outcome procedure handler', () => {
  /**
   * @example
   * completed explicit memory outcome writes one handled marker.
   */
  it('writes record marker receipt and context accumulator for completed memory outcomes', async () => {
    const records: unknown[] = [];
    const markers: unknown[] = [];
    const receipts: unknown[] = [];
    const accumulatorRecords: unknown[] = [];
    const handler = createToolOutcomeSourceHandler({
      accumulator: {
        appendRecord: async (record) => {
          accumulatorRecords.push(record);
        },
      },
      markerStore: {
        write: async (marker) => {
          markers.push(marker);
        },
      },
      now: () => 100,
      receiptStore: {
        append: async (receipt) => {
          receipts.push(receipt);
        },
      },
      recordStore: {
        write: async (record) => {
          records.push(record);
        },
      },
      ttlSeconds: 3600,
    });
    const source = createSource({
      payload: {
        domainKey: 'memory:user-preference',
        intentClass: 'explicit_persistence',
        messageId: 'm1',
        outcome: { action: 'create', status: 'succeeded', summary: 'Saved preference.' },
        tool: { apiName: 'addPreferenceMemory', identifier: 'lobe-user-memory' },
      },
      scope: { topicId: 't1', userId: 'u1' },
      scopeKey: 'topic:t1',
      sourceId: 'source_1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
    }) as SourceToolOutcomeCompleted;

    const result = await handler.handle(source, { now: () => 100, scopeKey: 'topic:t1' } as never);

    expect(result).toEqual(
      expect.objectContaining({
        signals: [expect.objectContaining({ signalType: 'signal.tool.outcome' })],
        status: 'dispatch',
      }),
    );
    expect(records).toHaveLength(1);
    expect(markers).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(accumulatorRecords).toHaveLength(1);
  });

  /**
   * @example
   * completed explicit memory outcome writes direct procedure state before dispatch.
   */
  it('awaits direct outcome procedure writes in golden turn order before returning dispatch', async () => {
    const writes: string[] = [];
    const recordWrite = Promise.withResolvers<void>();
    const receiptWrite = Promise.withResolvers<void>();
    const markerWrite = Promise.withResolvers<void>();
    let isSettled = false;
    const markerStoreWrite = vi.fn(async () => {
      await markerWrite.promise;
      writes.push('marker');
    });
    const receiptStoreAppend = vi.fn(async () => {
      await receiptWrite.promise;
      writes.push('receipt');
    });
    const recordStoreWrite = vi.fn(async () => {
      await recordWrite.promise;
      writes.push('record');
    });
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: {
        write: markerStoreWrite,
      },
      now: () => 100,
      receiptStore: {
        append: receiptStoreAppend,
      },
      recordStore: {
        write: recordStoreWrite,
      },
      ttlSeconds: 3600,
    });
    const source = createSource({
      payload: {
        domainKey: 'memory:user-preference',
        intentClass: 'explicit_persistence',
        messageId: 'm1',
        outcome: { action: 'create', status: 'succeeded', summary: 'Saved preference.' },
        tool: { apiName: 'addPreferenceMemory', identifier: 'lobe-user-memory' },
      },
      scope: { topicId: 't1', userId: 'u1' },
      scopeKey: 'topic:t1',
      sourceId: 'source_ordering',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
    }) as SourceToolOutcomeCompleted;

    // ROOT CAUSE:
    //
    // If the source handler returns dispatch before direct procedure writes settle, turn-end
    // processing can observe the async tool outcome signal while direct outcome state is incomplete.
    //
    // We prevent that by awaiting each direct procedure write before returning dispatch:
    // record -> receipt -> marker -> dispatch.
    //
    // NOTE:
    // Completed handled outcomes also keep receipt before marker so golden-turn consumers see the
    // compact receipt state before the handled marker is visible.
    const pending = Promise.resolve(
      handler.handle(source, { now: () => 100, scopeKey: 'topic:t1' } as never),
    ).then((result) => {
      isSettled = true;
      return result;
    });

    await vi.waitFor(() => expect(recordStoreWrite).toHaveBeenCalledTimes(1));
    expect(receiptStoreAppend).not.toHaveBeenCalled();
    expect(markerStoreWrite).not.toHaveBeenCalled();
    expect(isSettled).toBe(false);

    recordWrite.resolve();
    await vi.waitFor(() => expect(receiptStoreAppend).toHaveBeenCalledTimes(1));
    expect(markerStoreWrite).not.toHaveBeenCalled();
    expect(isSettled).toBe(false);

    receiptWrite.resolve();
    await vi.waitFor(() => expect(markerStoreWrite).toHaveBeenCalledTimes(1));
    expect(isSettled).toBe(false);

    markerWrite.resolve();
    const result = await pending;

    expect(recordStoreWrite).toHaveBeenCalledTimes(1);
    expect(receiptStoreAppend).toHaveBeenCalledTimes(1);
    expect(markerStoreWrite).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(['record', 'receipt', 'marker']);
    expect(result).toEqual(
      expect.objectContaining({
        signals: [expect.objectContaining({ signalType: 'signal.tool.outcome' })],
        status: 'dispatch',
      }),
    );
  });

  /**
   * @example
   * failed direct tool outcomes never suppress future actions by default.
   */
  it('records failed outcomes without handled markers', async () => {
    const markers: unknown[] = [];
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: {
        write: async (marker) => {
          markers.push(marker);
        },
      },
      now: () => 100,
      receiptStore: { append: async () => {} },
      recordStore: { write: async () => {} },
      ttlSeconds: 3600,
    });
    const source = createSource({
      payload: {
        domainKey: 'skill:market-skill',
        intentClass: 'tool_command',
        messageId: 'm1',
        outcome: { action: 'import', errorReason: 'network', status: 'failed' },
        tool: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
      },
      scope: { topicId: 't1', userId: 'u1' },
      scopeKey: 'topic:t1',
      sourceId: 'source_2',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
    }) as SourceToolOutcomeFailed;

    await handler.handle(source, { now: () => 100, scopeKey: 'topic:t1' } as never);

    expect(markers).toHaveLength(0);
  });
});
