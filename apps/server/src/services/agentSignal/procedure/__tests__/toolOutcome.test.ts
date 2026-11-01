import { createSource } from '@lobechat/agent-signal';
import type {
  SourceToolOutcomeCompleted,
  SourceToolOutcomeFailed,
} from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { createSelfReflectionAccumulator } from '../accumulators/selfReflection';
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

  /**
   * @example
   * two failed outcomes in one task request self-reflection once for the crossed tool threshold.
   */
  it('requests self-reflection once when repeated same-tool failures cross threshold', async () => {
    const requestSelfReflection = vi.fn(async () => ({ enqueued: true, sourceId: 'reflect-1' }));
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: { write: async () => {} },
      now: () => 100,
      receiptStore: { append: async () => {} },
      recordStore: { write: async () => {} },
      selfReflection: {
        accumulator: createSelfReflectionAccumulator(),
        getWindowStart: ({ decision }) => decision.windowStart ?? 'missing-window-start',
        service: { requestSelfReflection },
        userId: 'user-1',
      },
      ttlSeconds: 3600,
    });
    const createFailedSource = (sourceId: string, timestamp: number) =>
      createSource({
        payload: {
          agentId: 'agent-1',
          domainKey: 'skill:market-skill',
          intentClass: 'tool_command',
          operationId: 'operation-1',
          outcome: { action: 'import', errorReason: 'network', status: 'failed' },
          taskId: 'task-1',
          tool: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          topicId: 'topic-1',
        },
        scope: { agentId: 'agent-1', taskId: 'task-1', topicId: 'topic-1', userId: 'user-1' },
        scopeKey: 'topic:topic-1',
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
        timestamp,
      }) as SourceToolOutcomeFailed;

    await handler.handle(createFailedSource('source_failed_1', 2000), {
      now: () => 2000,
      scopeKey: 'topic:topic-1',
    } as never);
    await handler.handle(createFailedSource('source_failed_2', 3000), {
      now: () => 3000,
      scopeKey: 'topic:topic-1',
    } as never);

    expect(requestSelfReflection).toHaveBeenCalledTimes(1);
    expect(requestSelfReflection).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationId: 'operation-1',
      reason: 'same_tool_failure_count',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
      windowEnd: '1970-01-01T00:00:03.000Z',
      windowStart: '1970-01-01T00:00:02.000Z',
    });
  });

  /**
   * @example
   * workflow-built tool outcome sources can trigger self-reflection without a hydrated source scope.
   */
  it('uses self-reflection wiring user id when workflow source has no scope', async () => {
    const requestSelfReflection = vi.fn(async () => ({ enqueued: true, sourceId: 'reflect-1' }));
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: { write: async () => {} },
      now: () => 100,
      receiptStore: { append: async () => {} },
      recordStore: { write: async () => {} },
      selfReflection: {
        accumulator: createSelfReflectionAccumulator(),
        getWindowStart: ({ decision }) => decision.windowStart ?? 'missing-window-start',
        service: { requestSelfReflection },
        userId: 'user-from-workflow',
      },
      ttlSeconds: 3600,
    });
    const createFailedSource = (sourceId: string, timestamp: number) =>
      ({
        chain: { chainId: `chain:${sourceId}`, rootSourceId: sourceId },
        payload: {
          agentId: 'agent-1',
          domainKey: 'skill:market-skill',
          intentClass: 'tool_command',
          operationId: 'operation-1',
          outcome: { action: 'import', errorReason: 'network', status: 'failed' },
          tool: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          topicId: 'topic-1',
        },
        scopeKey: 'topic:topic-1',
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
        timestamp,
      }) as SourceToolOutcomeFailed;

    await handler.handle(createFailedSource('source_failed_no_scope_1', 2000), {
      now: () => 2000,
      scopeKey: 'topic:topic-1',
    } as never);
    await handler.handle(createFailedSource('source_failed_no_scope_2', 3000), {
      now: () => 3000,
      scopeKey: 'topic:topic-1',
    } as never);

    expect(requestSelfReflection).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'same_tool_failure_count',
        userId: 'user-from-workflow',
      }),
    );
  });

  /**
   * @example
   * a single completed outcome stays below self-reflection thresholds.
   */
  it('does not request self-reflection for one completed outcome below threshold', async () => {
    const requestSelfReflection = vi.fn(async () => ({ enqueued: true, sourceId: 'reflect-1' }));
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: { write: async () => {} },
      now: () => 100,
      receiptStore: { append: async () => {} },
      recordStore: { write: async () => {} },
      selfReflection: {
        accumulator: createSelfReflectionAccumulator(),
        getWindowStart: () => '2026-05-04T00:00:00.000Z',
        service: { requestSelfReflection },
        userId: 'user-1',
      },
      ttlSeconds: 3600,
    });
    const source = createSource({
      payload: {
        agentId: 'agent-1',
        domainKey: 'memory:user-preference',
        intentClass: 'explicit_persistence',
        outcome: { action: 'create', status: 'succeeded', summary: 'Saved preference.' },
        taskId: 'task-1',
        tool: { apiName: 'addPreferenceMemory', identifier: 'lobe-user-memory' },
        topicId: 'topic-1',
      },
      scope: { agentId: 'agent-1', taskId: 'task-1', topicId: 'topic-1', userId: 'user-1' },
      scopeKey: 'topic:topic-1',
      sourceId: 'source_completed_1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
      timestamp: 2000,
    }) as SourceToolOutcomeCompleted;

    await handler.handle(source, { now: () => 2000, scopeKey: 'topic:topic-1' } as never);

    expect(requestSelfReflection).not.toHaveBeenCalled();
  });

  /**
   * @example
   * rejected self-reflection requests do not block marker writes for handled outcomes.
   */
  it('isolates self-reflection request failures from marker writes and dispatch', async () => {
    const markers: unknown[] = [];
    const reflectionError = new Error('reflection queue unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const requestSelfReflection = vi.fn(async () => {
      throw reflectionError;
    });
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
      selfReflection: {
        accumulator: createSelfReflectionAccumulator(),
        getWindowStart: () => '2026-05-04T00:00:00.000Z',
        service: { requestSelfReflection },
        userId: 'user-1',
      },
      ttlSeconds: 3600,
    });
    const createCompletedSource = (sourceId: string, timestamp: number) =>
      createSource({
        payload: {
          agentId: 'agent-1',
          domainKey: 'memory:user-preference',
          intentClass: 'explicit_persistence',
          outcome: { action: 'create', status: 'succeeded', summary: 'Saved preference.' },
          taskId: 'task-1',
          tool: { apiName: 'addPreferenceMemory', identifier: 'lobe-user-memory' },
          topicId: 'topic-1',
        },
        scope: { agentId: 'agent-1', taskId: 'task-1', topicId: 'topic-1', userId: 'user-1' },
        scopeKey: 'topic:topic-1',
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
        timestamp,
      }) as SourceToolOutcomeCompleted;

    const results = [];
    for (const index of Array.from({ length: 10 }, (_, itemIndex) => itemIndex)) {
      results.push(
        await handler.handle(createCompletedSource(`source_completed_${index}`, 2000 + index), {
          now: () => 2000 + index,
          scopeKey: 'topic:topic-1',
        } as never),
      );
    }

    expect(requestSelfReflection).toHaveBeenCalledTimes(1);
    expect(markers).toHaveLength(10);
    expect(results.at(-1)).toEqual(
      expect.objectContaining({
        signals: [expect.objectContaining({ signalType: 'signal.tool.outcome' })],
        status: 'dispatch',
      }),
    );
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[AgentSignal] Failed to request self-reflection:',
        reflectionError,
      ),
    );
    consoleError.mockRestore();
  });

  /**
   * @example
   * invalid source timestamps fall back to the procedure clock at threshold crossing.
   */
  it('uses the procedure clock when threshold-crossing source timestamp is invalid', async () => {
    const requestSelfReflection = vi.fn(async () => ({ enqueued: true, sourceId: 'reflect-1' }));
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: { write: async () => {} },
      now: () => 4000,
      receiptStore: { append: async () => {} },
      recordStore: { write: async () => {} },
      selfReflection: {
        accumulator: createSelfReflectionAccumulator(),
        getWindowStart: () => '2026-05-04T00:00:00.000Z',
        service: { requestSelfReflection },
        userId: 'user-1',
      },
      ttlSeconds: 3600,
    });
    const createFailedSource = (sourceId: string, timestamp: number) =>
      createSource({
        payload: {
          agentId: 'agent-1',
          domainKey: 'skill:market-skill',
          intentClass: 'tool_command',
          operationId: 'operation-1',
          outcome: { action: 'import', errorReason: 'network', status: 'failed' },
          taskId: 'task-1',
          tool: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          topicId: 'topic-1',
        },
        scope: { agentId: 'agent-1', taskId: 'task-1', topicId: 'topic-1', userId: 'user-1' },
        scopeKey: 'topic:topic-1',
        sourceId,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
        timestamp,
      }) as SourceToolOutcomeFailed;

    await handler.handle(createFailedSource('source_failed_valid', 2000), {
      now: () => 2000,
      scopeKey: 'topic:topic-1',
    } as never);
    const result = await handler.handle(createFailedSource('source_failed_invalid', Number.NaN), {
      now: () => 4000,
      scopeKey: 'topic:topic-1',
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        signals: [expect.objectContaining({ signalType: 'signal.tool.outcome' })],
        status: 'dispatch',
      }),
    );
    expect(requestSelfReflection).toHaveBeenCalledWith(
      expect.objectContaining({ windowEnd: '1970-01-01T00:00:04.000Z' }),
    );
  });

  /**
   * @example
   * tool outcome procedure wiring remains optional for callers without self-reflection deps.
   */
  it('preserves dispatch behavior without self-reflection dependencies', async () => {
    const records: unknown[] = [];
    const handler = createToolOutcomeSourceHandler({
      accumulator: { appendRecord: async () => {} },
      markerStore: { write: async () => {} },
      now: () => 100,
      receiptStore: { append: async () => {} },
      recordStore: {
        write: async (record) => {
          records.push(record);
        },
      },
      ttlSeconds: 3600,
    });
    const source = createSource({
      payload: {
        agentId: 'agent-1',
        domainKey: 'skill:market-skill',
        intentClass: 'tool_command',
        outcome: { action: 'import', errorReason: 'network', status: 'failed' },
        taskId: 'task-1',
        tool: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
      },
      scope: { agentId: 'agent-1', taskId: 'task-1', userId: 'user-1' },
      scopeKey: 'task:task-1',
      sourceId: 'source_no_self_reflection',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
    }) as SourceToolOutcomeFailed;

    const result = await handler.handle(source, {
      now: () => 100,
      scopeKey: 'task:task-1',
    } as never);

    expect(records).toHaveLength(1);
    expect(result).toEqual(
      expect.objectContaining({
        signals: [expect.objectContaining({ signalType: 'signal.tool.outcome' })],
        status: 'dispatch',
      }),
    );
  });
});
