import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __clearRegistryForTests,
  __resetBridgeForTests,
  fireClientSubAgentBridge,
  flushPendingBridgeCoordinates,
  registerClientSubAgentBridge,
} from '../clientSubAgentBridge';
import {
  childContext,
  makeGet,
  registerArmedSubAgentBridge,
  subAgentRegistration,
} from './testUtils';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    // P1 (round-23): the fire path routes the child result through the
    // server result-control review before any backfill — tests default to
    // "not blocked, unchanged".
    controlClientSubAgentToolResult: vi
      .fn()
      .mockResolvedValue({ blocked: false, content: undefined }),
    updateClientTaskThreadStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/thread', () => ({
  threadService: {
    getThreads: vi.fn().mockResolvedValue([]),
    mergeThreadMetadata: vi.fn().mockResolvedValue(true),
    updateThread: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
  },
}));

const PERSIST_QUEUE_KEY = 'LOBE_CLIENT_SUB_AGENT_BRIDGE_PERSIST_QUEUE';

const readQueue = (): any[] => {
  const raw = localStorage.getItem(PERSIST_QUEUE_KEY);
  return raw ? (JSON.parse(raw) as any[]) : [];
};

const { threadService } = await import('@/services/thread');

beforeEach(() => {
  // The registry is module-level; a restored claim (retry semantics) from one
  // case must never leak into the next.
  __resetBridgeForTests();
  (threadService.getThreads as any).mockReset();
  (threadService.getThreads as any).mockResolvedValue([]);
  (threadService.mergeThreadMetadata as any).mockReset();
  (threadService.mergeThreadMetadata as any).mockResolvedValue(true);
  (threadService.updateThread as any).mockReset();
  (threadService.updateThread as any).mockResolvedValue(undefined);
});

/**
 * P1 (round-21): the coordinate write is no longer a bare fire-and-forget.
 * `metadata.bridge` is the only durable coordinate source for the
 * post-reload reconstruction, so a transient failure (or an in-flight write
 * cancelled by a reload) must not lose the coordinates: they are enqueued
 * write-ahead into a durable localStorage queue and flushed by a retry
 * driver — which reconstruction drains BEFORE reading the thread rows.
 */
describe('clientSubAgentBridge persist queue (round-21)', () => {
  it('successful persistence drains the queue entry', async () => {
    registerClientSubAgentBridge(subAgentRegistration);
    // Let the fire-and-forget persistence resolve.
    await vi.waitFor(() => expect(readQueue()).toHaveLength(0));
    expect(threadService.mergeThreadMetadata).toHaveBeenCalledWith('thd_child', {
      bridge: expect.objectContaining({ kind: 'sub-agent', toolMessageId: 'tool-msg-1' }),
    });
  });

  it('a transient failure keeps the entry queued and flushes it later', async () => {
    (threadService.mergeThreadMetadata as any)
      .mockRejectedValueOnce(new Error('transient network failure'))
      .mockResolvedValueOnce(true);

    registerClientSubAgentBridge(subAgentRegistration);

    // The first (failing) write leaves the entry queued — the coordinates
    // survive even though the request failed.
    await vi.waitFor(() => expect(readQueue()).toHaveLength(1));
    expect(readQueue()[0]).toMatchObject({ childThreadId: 'thd_child' });

    // The flush driver drains it on the next attempt.
    await flushPendingBridgeCoordinates();
    expect(threadService.mergeThreadMetadata).toHaveBeenCalledTimes(2);
    // P1 (round-23): an applied flush drains the entry…
    expect(readQueue()).toHaveLength(0);
    // …and a second flush is a no-op.
    await flushPendingBridgeCoordinates();
    expect(threadService.mergeThreadMetadata).toHaveBeenCalledTimes(2);
  });

  it('reconstruction drains the queue BEFORE reading the thread rows (persist-failed-then-reload)', async () => {
    (threadService.mergeThreadMetadata as any)
      // The original registration write fails (transient).
      .mockRejectedValueOnce(new Error('transient network failure'))
      // The flush during reconstruction succeeds.
      .mockResolvedValueOnce(true);

    registerClientSubAgentBridge(subAgentRegistration);
    await vi.waitFor(() => expect(readQueue()).toHaveLength(1));

    // Simulate the reload: the in-memory registry dies while the durable
    // persist queue survives (localStorage).
    __clearRegistryForTests();

    // Simulate the reload: a fire with an empty registry. The row read
    // happens AFTER the flush, and the flush re-wrote the coordinates.
    const callOrder: string[] = [];
    (threadService.mergeThreadMetadata as any).mockImplementation(async () => {
      callOrder.push('merge');
      return true;
    });
    (threadService.getThreads as any).mockImplementation(async () => {
      callOrder.push('getThreads');
      return [
        {
          agentId: 'agent-child',
          id: 'thd_child',
          metadata: {
            // Coordinates persisted by the flush, not by the failed original
            // write — this row is what reconstruction must find.
            bridge: {
              kind: 'sub-agent',
              parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
              parentOperationId: 'op_parent',
              toolMessageId: 'tool-msg-1',
            },
          },
          status: 'processing',
          topicId: 'topic-1',
        },
      ];
    });

    const { get, store } = makeGet({
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'user' },
          { content: 'child final answer', role: 'assistant' },
        ],
        'main_agent-parent_topic-1': [
          {
            id: 'tool-msg-1',
            pluginState: { status: 'running', threadId: 'thd_child' },
            role: 'tool',
          },
        ],
      },
      operations: {}, // reload: no in-memory operations
    });

    await fireClientSubAgentBridge(get, childContext);

    // The flush landed before the row read: reconstruction saw the
    // re-written coordinates and the parent resumed.
    expect(callOrder.indexOf('merge')).toBeLessThan(callOrder.indexOf('getThreads'));
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-1',
      'child final answer',
      undefined,
      { operationId: 'op_parent' },
    );
    expect(readQueue()).toHaveLength(0);
  });

  it('a settled or gone thread drains the queued entry without retrying forever', async () => {
    (threadService.mergeThreadMetadata as any)
      .mockRejectedValueOnce(new Error('transient network failure'))
      // The `processing` guard rejects the re-write: the thread settled or
      // was deleted while the entry sat in the queue.
      .mockResolvedValueOnce(false)
      .mockResolvedValue(false);

    registerClientSubAgentBridge(subAgentRegistration);
    await vi.waitFor(() => expect(readQueue()).toHaveLength(1));

    await flushPendingBridgeCoordinates();
    // P1 (round-23): a `false` from the `processing` guard is NOT proof the
    // coordinates are stale — the row may have settled BEFORE the merge
    // arrived (settlement-before-persistence), leaving the row without any
    // bridge while this entry is the only lifeline. The entry is RETAINED
    // (drained later by the fire's success path or the attempt cap), so a
    // post-settlement reload can still reconstruct from it.
    expect(readQueue()).toHaveLength(1);
    // The retained entry does not burn unbounded merges: the flush retries
    // on the slow poll, and the attempt cap (~1h) eventually drops it.
    await flushPendingBridgeCoordinates();
    expect(threadService.mergeThreadMetadata).toHaveBeenCalledTimes(3);
  });

  it('reconstructs from the QUEUE when the row settled before the merge arrived (round-23 P1)', async () => {
    // The original persistence write raced the settlement and lost: the
    // merge was REJECTED by the processing guard (applied=false), so the row
    // never received a `bridge` — the queue entry is the only lifeline.
    (threadService.mergeThreadMetadata as any).mockResolvedValue(false);

    registerClientSubAgentBridge(subAgentRegistration);
    await vi.waitFor(() => expect(readQueue()).toHaveLength(1));

    // Reload: the registry dies, the queue survives, and the settled row has
    // NO bridge coordinates on it.
    __clearRegistryForTests();
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {}, // settled row: no bridge — the queue is the only source
        status: 'completed',
        topicId: 'topic-1',
      },
    ]);

    const { get, store } = makeGet({
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'user' },
          { content: 'child final answer', role: 'assistant' },
        ],
        'main_agent-parent_topic-1': [
          {
            id: 'tool-msg-1',
            pluginState: { status: 'running', threadId: 'thd_child' },
            role: 'tool',
          },
        ],
      },
      operations: {},
    });

    await fireClientSubAgentBridge(get, childContext);

    // Reconstruction fell back to the queue entry: the parent still resumed
    // (settled-child continuation — the round-12 P1 behavior).
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-1',
      'child final answer',
      undefined,
      { operationId: 'op_parent' },
    );
  });
});

/**
 * P1 (round-23, backfill.ts:39): the fire path must run the parent's
 * `afterToolCall` result-control BEFORE any content is published — the
 * runtime's deferred branch returns before the normal hook pipeline, so the
 * direct backfill bypassed a deny hook.
 */
describe('clientSubAgentBridge result-control gate (round-23)', () => {
  beforeEach(() => {
    __resetBridgeForTests();
    (threadService.getThreads as any).mockReset();
    (threadService.getThreads as any).mockResolvedValue([]);
    (threadService.mergeThreadMetadata as any).mockReset();
    (threadService.mergeThreadMetadata as any).mockResolvedValue(true);
    (threadService.updateThread as any).mockReset();
    (threadService.updateThread as any).mockResolvedValue(undefined);
  });

  it('a deny swaps in the replacement content and marks the result failed', async () => {
    const { aiAgentService } = await import('@/services/aiAgent');
    (aiAgentService.controlClientSubAgentToolResult as any).mockResolvedValueOnce({
      blocked: true,
      content: 'Tool result withheld by afterToolCall hook.',
      state: { totalTokens: 1234, status: 'completed' },
    });

    registerArmedSubAgentBridge(subAgentRegistration);
    const { get, store } = makeGet();

    await fireClientSubAgentBridge(get, childContext);

    // The review ran BEFORE the backfill, against the parent op coordinates.
    expect(aiAgentService.controlClientSubAgentToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_parent', toolMessageId: 'tool-msg-1' }),
    );
    // The RAW child output never reached the tool card — the hook's
    // replacement content was published instead, as a failed result.
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-1',
      'Tool result withheld by afterToolCall hook.',
      undefined,
      { operationId: 'op_parent' },
    );
    // The parent was still resumed (deny ≠ park): the hook decides the
    // content, not the flow.
    expect(store.executeClientAgent).toHaveBeenCalled();
  });

  it('an evaluation error is fail-closed: withheld placeholder published, retry re-runs the review', async () => {
    vi.useFakeTimers();
    try {
      const { aiAgentService } = await import('@/services/aiAgent');
      (aiAgentService.controlClientSubAgentToolResult as any)
        .mockRejectedValueOnce(new Error('review endpoint unreachable'))
        .mockResolvedValue({ blocked: false, content: undefined });

      registerArmedSubAgentBridge(subAgentRegistration);
      const { get, store } = makeGet();

      const fire = fireClientSubAgentBridge(get, childContext);
      // Advance through the scheduled retry's first backoff (5s).
      await vi.advanceTimersByTimeAsync(5000);
      await fire;

      // Fail-closed: the review error aborted the first fire BEFORE any
      // content was published (claim + slot restored, retry armed); the
      // scheduled retry re-ran the review and, with the endpoint recovered,
      // the real content flows through and the parent resumes.
      expect(aiAgentService.controlClientSubAgentToolResult).toHaveBeenCalledTimes(2);
      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledTimes(1);
      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-1',
        'child final answer',
        undefined,
        { operationId: 'op_parent' },
      );
      expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
