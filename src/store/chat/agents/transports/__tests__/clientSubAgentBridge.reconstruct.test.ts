import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetBridgeForTests, fireClientSubAgentBridge } from '../clientSubAgentBridge';
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

beforeEach(() => {
  // The registry is module-level; a restored claim (retry semantics) from one
  // case must never leak into the next.
  __resetBridgeForTests();
});

describe('clientSubAgentBridge reconstruction', () => {
  // ─── Round-6: post-reload reconstruction ───

  // Round-6 P1 fix: the module-level registry dies with the renderer, but a
  // parked child outlives a reload. A fire with no claim rebuilds the
  // registration from the persisted thread coordinates (armed) and settles
  // the parent.
  it('reloads: reconstructs the registration from persisted thread coordinates', async () => {
    const { threadService } = await import('@/services/thread');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
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
    ]);
    const { get, store } = makeGet({
      dbMessagesMap: {
        // The reconstructed child context derives its agentId from the thread
        // row ('agent-child'), so the child bucket key follows that.
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'user' },
          { content: 'child final answer', role: 'assistant' },
        ],
        // Reload path: the parent op is gone — the durable park signal is the
        // deferred plugin state on the parent's tool row.
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

    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-1',
      'child final answer',
      undefined,
      { operationId: 'op_parent' },
    );
    expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
  });

  // A settled child with surviving coordinates reconstructs as a
  // post-settlement-crash continuation (round-12), but a parent that settled
  // out-of-band still cannot be phantom-resumed: the parentParked guard
  // (op status / durable placeholder state) is the real gate, not the
  // child's thread status.
  it('reload reconstruction on a settled child cannot resume a parent that settled out-of-band', async () => {
    const { threadService } = await import('@/services/thread');
    (threadService.getThreads as any).mockResolvedValue([
      {
        id: 'thd_child',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-1',
          },
        },
        status: 'completed',
        topicId: 'topic-1',
      },
    ]);
    const { get, store } = makeGet({ operations: {} }); // reload: no ops, no parked placeholder

    await fireClientSubAgentBridge(get, childContext);

    expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();
    expect(store.executeClientAgent).not.toHaveBeenCalled();
  });

  // Round-12 P1: a fire that crashed AFTER child settlement (backfill /
  // plugin state / re-entry throw) left the child marked completed with the
  // bridge coordinates still persisted. A reload used to reject the
  // reconstruction (thread no longer `processing`) and strand the parked
  // parent forever. Reconstruction now continues the parent resume — the
  // re-settle is idempotent and the parentParked guard still blocks phantom
  // resumes of an out-of-band-settled parent.
  it('reloads: continues the parent resume when a fire crashed after child settlement', async () => {
    const { threadService } = await import('@/services/thread');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-1',
          },
        },
        status: 'completed', // settled by the crashed fire
        topicId: 'topic-1',
      },
    ]);
    const { get, store } = makeGet({
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'user' },
          { content: 'child final answer', role: 'assistant' },
        ],
        // Reload: the durable park signal on the parent's tool row is still
        // `running` — the parent never settled out-of-band.
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

    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-1',
      'child final answer',
      undefined,
      { operationId: 'op_parent' },
    );
    expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
  });

  // Registration persists the coordinates as the post-reload lifeline.
  // P2 (bridge round-18): the persistence is an ATOMIC server-side metadata
  // merge guarded on `processing` — no read-modify-write, so a settlement
  // landing between read and write can no longer clobber terminal fields.
  it('registration persists bridge coordinates via the atomic metadata merge', async () => {
    const { threadService } = await import('@/services/thread');

    registerArmedSubAgentBridge(subAgentRegistration);
    // Fire-and-forget persistence — flush the microtask chain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(threadService.mergeThreadMetadata).toHaveBeenCalledWith('thd_child', {
      bridge: expect.objectContaining({
        kind: 'sub-agent',
        toolMessageId: 'tool-msg-1',
      }),
    });
    // The old whole-blob replace must be gone.
    expect(threadService.updateThread).not.toHaveBeenCalled();
  });

  // ─── P1 (round-18): settled-sibling replay ───

  // A reload wipes the registry. When the current child fires and
  // reconstruction rebuilds a SETTLED sibling (its fire crashed after
  // settlement, coordinates survived), the sibling has no future terminal
  // event: its barrier slot would stay passive forever and the parent would
  // never resume. The reconstruction must REPLAY the settled sibling —
  // backfilling its tool message and releasing its slot — while skipping the
  // settlement (the original fire already settled the thread).
  it('reloads: replays a settled parallel sibling so the barrier releases', async () => {
    const { threadService } = await import('@/services/thread');
    const { messageService } = await import('@/services/message');
    (threadService.getThreads as any).mockResolvedValue([
      // The CURRENT child, still mid-run with persisted coordinates.
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
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
      // The settled sibling: its fire crashed after settlement, so the
      // terminal thread row still carries surviving coordinates.
      {
        agentId: 'agent-sibling',
        id: 'thd_sibling',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-2',
          },
          completedAt: 't',
          error: undefined,
          totalCost: 0.42,
          totalToolCalls: 3,
        },
        status: 'completed',
        topicId: 'topic-1',
      },
    ]);
    (messageService.getMessages as any).mockResolvedValue([
      { content: 'sibling final answer', role: 'assistant' },
    ]);
    const { get, store } = makeGet({
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'assistant' },
        ],
        'main_agent-parent_topic-1': [
          {
            id: 'tool-msg-1',
            pluginState: { status: 'running', threadId: 'thd_child' },
            role: 'tool',
          },
          {
            id: 'tool-msg-2',
            pluginState: { status: 'running', threadId: 'thd_sibling' },
            role: 'tool',
          },
        ],
      },
      operations: {}, // reload: no in-memory operations
    });

    await fireClientSubAgentBridge(get, childContext);

    // The settled sibling's tool message is backfilled with ITS final answer
    // (fetched from the server, not the unloaded child bucket).
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-2',
      'sibling final answer',
      undefined,
      { operationId: 'op_parent' },
    );
    // The replay skips the settlement — the sibling thread was already
    // settled by the original fire.
    const { aiAgentService } = await import('@/services/aiAgent');
    const settleCalls = (aiAgentService.updateClientTaskThreadStatus as any).mock.calls.filter(
      (call: any[]) => call[0].threadId === 'thd_sibling',
    );
    expect(settleCalls).toHaveLength(0);
    // The barrier released: the parent resumed with the current child's
    // result (the sibling's slot was replayed, not left passive).
    expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
  });

  // The replay must NOT resume the parent on the sibling's behalf while the
  // current child is still pending: the sibling's fire releases only its own
  // slot (the CAS/barrier semantics hold per registration).
  it('replays a settled sibling without resuming the parent early', async () => {
    const { threadService } = await import('@/services/thread');
    const { messageService } = await import('@/services/message');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
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
      {
        agentId: 'agent-sibling',
        id: 'thd_sibling',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-2',
          },
        },
        status: 'completed',
        topicId: 'topic-1',
      },
    ]);
    (messageService.getMessages as any).mockResolvedValue([
      { content: 'sibling final answer', role: 'assistant' },
    ]);
    // The parent park signal is ABSENT (parent settled out-of-band): the
    // phantom guard must hold for the replay too.
    const { get, store } = makeGet({ operations: {}, dbMessagesMap: {} });

    await fireClientSubAgentBridge(get, childContext);

    // Backfill happened for BOTH rows (the out-of-band backfill contract),
    // but no resume was attempted.
    expect(store.executeClientAgent).not.toHaveBeenCalled();
  });

  // ─── Round-19: pre-fire replay retry, parent-bucket hydration, failure fidelity ───

  // P1 (round-19): `messageService.getMessages` rejecting inside the replay
  // used to only log — the fire's own catch (which installs the retry
  // driver) was never reached, so the settled sibling's barrier slot stayed
  // pending forever and the parent never resumed. The replay failure now
  // schedules the bounded retry burst.
  it('schedules a retry when the settled-sibling replay fails before firing', async () => {
    vi.useFakeTimers();
    try {
      const { threadService } = await import('@/services/thread');
      const { messageService } = await import('@/services/message');
      (threadService.getThreads as any).mockResolvedValue([
        {
          agentId: 'agent-child',
          id: 'thd_child',
          metadata: {
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
        {
          agentId: 'agent-sibling',
          id: 'thd_sibling',
          metadata: {
            bridge: {
              kind: 'sub-agent',
              parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
              parentOperationId: 'op_parent',
              toolMessageId: 'tool-msg-2',
            },
          },
          status: 'completed',
          topicId: 'topic-1',
        },
      ]);
      const getMessages = (messageService.getMessages as any)
        .mockRejectedValueOnce(new Error('network glitch'))
        .mockResolvedValue([{ content: 'sibling final answer', role: 'assistant' }]);
      const { get, store } = makeGet({
        dbMessagesMap: {
          'thread_agent-child_topic-1_thd_child': [
            { content: 'child final answer', role: 'assistant' },
          ],
          'main_agent-parent_topic-1': [
            {
              id: 'tool-msg-1',
              pluginState: { status: 'running', threadId: 'thd_child' },
              role: 'tool',
            },
            {
              id: 'tool-msg-2',
              pluginState: { status: 'running', threadId: 'thd_sibling' },
              role: 'tool',
            },
          ],
        },
        operations: {},
      });

      await fireClientSubAgentBridge(get, childContext);
      expect(getMessages).toHaveBeenCalledTimes(1);
      // The replay never fired: the sibling's row (tool-msg-2) stays untouched
      // — the backfill that DID happen is the current child's own (tool-msg-1).
      expect(
        store.optimisticUpdateMessageContent.mock.calls.some(
          (call: unknown[]) => call[0] === 'tool-msg-2',
        ),
      ).toBe(false);

      // The scheduled retry (5s × attempt 1) re-runs the WHOLE replay —
      // refetch included — and backfills the sibling's tool message.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(getMessages).toHaveBeenCalledTimes(2);
      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-2',
        'sibling final answer',
        undefined,
        { operationId: 'op_parent' },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // P1 (round-20): a reconstruction failure (e.g. threadService.getThreads
  // rejecting after a reload) must not exit the fire path silently — the
  // retry driver is scheduled so the WHOLE fire re-runs and the parent
  // eventually resumes, instead of staying parked forever with no driver.
  it('schedules a retry when the reconstruction itself fails', async () => {
    vi.useFakeTimers();
    try {
      const { threadService } = await import('@/services/thread');
      (threadService.getThreads as any)
        .mockRejectedValueOnce(new Error('network glitch'))
        .mockResolvedValue([
          {
            agentId: 'agent-child',
            id: 'thd_child',
            metadata: {
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
        ]);
      const { get, store } = makeGet({
        dbMessagesMap: {
          'thread_agent-child_topic-1_thd_child': [
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

      // The failed reconstruction never backfilled anything.
      expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();

      // The scheduled retry (5s × attempt 1) re-runs the whole fire —
      // reconstruction included — and backfills the tool message.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-1',
        'child final answer',
        undefined,
        { operationId: 'op_parent' },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // P2 (round-19): a FAILED sibling's replay must not resurrect a stale
  // pre-failure assistant answer as the tool result — the failure formatting
  // (persisted error text) reaches the parent instead.
  it('replays a failed settled sibling with its persisted failure text, not stale content', async () => {
    const { threadService } = await import('@/services/thread');
    const { messageService } = await import('@/services/message');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
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
      {
        agentId: 'agent-sibling',
        id: 'thd_sibling',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-2',
          },
          completedAt: 't',
          error: 'context window exhausted',
          totalCost: 0.1,
        },
        status: 'failed',
        topicId: 'topic-1',
      },
    ]);
    (messageService.getMessages as any).mockResolvedValue([
      { content: 'stale pre-failure answer', role: 'assistant' },
    ]);
    const { get, store } = makeGet({
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'assistant' },
        ],
        'main_agent-parent_topic-1': [
          {
            id: 'tool-msg-1',
            pluginState: { status: 'running', threadId: 'thd_child' },
            role: 'tool',
          },
          {
            id: 'tool-msg-2',
            pluginState: { status: 'running', threadId: 'thd_sibling' },
            role: 'tool',
          },
        ],
      },
      operations: {},
    });

    await fireClientSubAgentBridge(get, childContext);

    // The stale assistant content never reaches the tool row — the failure
    // formatting (`Sub-agent run failed: <persisted error>`) does.
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
      'tool-msg-2',
      'Sub-agent run failed: context window exhausted',
      undefined,
      { operationId: 'op_parent' },
    );
  });

  // P1 (round-19): after a reload while viewing the child thread, the
  // parent bucket is NOT loaded — a missing tool row used to be read as
  // "parent settled", skipping backfill/resume and stranding the parent.
  // The guard now hydrates the parent bucket from the server first and only
  // then interprets the persisted park marker.
  it('hydrates an unloaded parent bucket before treating a missing tool row as settled', async () => {
    const { threadService } = await import('@/services/thread');
    const { messageService } = await import('@/services/message');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {
          bridge: {
            kind: 'sub-agent',
            parentContext: { agentId: 'agent-parent', topicId: 'topic-1' },
            parentOperationId: 'op_parent',
            toolMessageId: 'tool-msg-1',
          },
        },
        status: 'completed', // settled by a fire that crashed before re-entry
        topicId: 'topic-1',
      },
    ]);
    // Only the child bucket is loaded (the reloaded renderer was viewing the
    // child thread); the server holds the parent's deferred placeholder.
    (messageService.getMessages as any).mockImplementation(async (params: any) => {
      if (params.threadId === 'thd_child') {
        return [{ content: 'child final answer', role: 'assistant' }];
      }
      return [
        {
          id: 'tool-msg-1',
          pluginState: {
            resumePending: true,
            status: 'completed', // backfilled, re-entry failed → resumable
            threadId: 'thd_child',
          },
          role: 'tool',
        },
      ];
    });
    const { get, store } = makeGet({
      // Reload: only the CHILD bucket is present — no parent bucket at all.
      dbMessagesMap: {
        'thread_agent-child_topic-1_thd_child': [
          { content: 'child final answer', role: 'assistant' },
        ],
      },
      operations: {},
      replaceMessages: vi.fn().mockImplementation((_messages: any, params: any) => {
        // Mirror the store write so the resume path (which re-reads
        // dbMessagesMap) sees the hydrated history.
        const context = params?.context ?? {};
        const key = ['main', context.agentId, context.topicId, context.threadId]
          .filter(Boolean)
          .join('_');
        store.dbMessagesMap[key] = _messages;
      }),
    });

    await fireClientSubAgentBridge(get, childContext);

    // The hydrated marker said `resumePending: true` → the resume went ahead.
    expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
  });

  // P1 (round-25): a normally completed (non-parked) child fires the bridge
  // BEFORE `runClientSubAgent` can register anything — registration only
  // happens for `{ parked: true }`, so the thread has neither `metadata.bridge`
  // nor a queue entry. Reconstruction must return the silent no-op instead of
  // casting the missing coordinates and dereferencing `bridge.kind`: the
  // deterministic throw used to arm the 5s/10s/15s/20s→60s retry loop that
  // refetched the topic's threads forever.
  it('no bridge on a normally completed thread: silent no-op, no retry loop', async () => {
    const { threadService } = await import('@/services/thread');
    (threadService.getThreads as any).mockResolvedValue([
      {
        agentId: 'agent-child',
        id: 'thd_child',
        metadata: {}, // no bridge — the child was never parked
        status: 'completed',
        topicId: 'topic-1',
      },
    ]);
    const { get, store } = makeGet();

    await fireClientSubAgentBridge(get, childContext);

    // A clean no-op: no retry driver armed, no parent resume attempted.
    const { scheduledBridgeRetries } = await import('../clientSubAgentBridge/registry');
    expect(scheduledBridgeRetries.size).toBe(0);
    expect(store.executeClientAgent).not.toHaveBeenCalled();
    // One reconstruction read — no repeated topic refetch polling.
    expect(threadService.getThreads).toHaveBeenCalledTimes(1);
  });
});
