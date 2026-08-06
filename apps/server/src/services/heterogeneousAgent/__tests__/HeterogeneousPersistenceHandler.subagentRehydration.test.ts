// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeteroEventLedger, type HeteroLedgerRedis } from '../HeteroEventLedger';
import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

/**
 * Regression for the SERVER-ONLY "大量无意义的 SubAgent" bug.
 *
 * Root cause: `HeterogeneousPersistenceHandler` keeps per-operation state in a
 * module-level `operationStates` map. On Vercel serverless, consecutive ingest
 * batches for one operation can land on DIFFERENT (cold) replicas, so that map
 * is empty on the next batch. `loadOrCreateState` rehydrates the MAIN-agent
 * state from DB (accumulatedContent, toolState, toolMsgIdByCallId,
 * currentAssistantMessageId) — but initializes `subagentState` with an empty
 * `createSubagentRunsState()` and NEVER reconstructs the in-flight subagent
 * runs from DB.
 *
 * Consequence: when a subagent run spans multiple batches, the first subagent
 * event seen by each fresh replica hits the `!existing` branch of `ensureRun`
 * and creates a BRAND-NEW thread for a `parentToolCallId` that already has one.
 * The duplicates get the generic "Subagent" title because spawnMetadata only
 * rides the first subagent event per parent (adapter `announcedSpawns`).
 *
 * The desktop client never hits this — it has a single long-lived
 * `subagentState` closure for the whole run.
 *
 * This test simulates a cold replica between batches via
 * `__resetOperationStatesForTesting()` (the in-memory map is dropped while the
 * mock DB — `threads` / `messages` — persists, exactly like a fresh Lambda).
 */

interface FakeMessage {
  agentId: string | null;
  content: string;
  id: string;
  metadata?: any;
  model?: string;
  parentId?: string | null;
  plugin?: any;
  reasoning?: any;
  role: 'user' | 'assistant' | 'tool' | 'task' | 'system';
  threadId?: string | null;
  tool_call_id?: string;
  tools?: any[];
  topicId: string | null;
}

interface FakeThread {
  id: string;
  metadata?: any;
  sourceMessageId?: string | null;
  status: string;
  title: string;
  topicId: string;
  type: string;
}

const createHarness = (params: {
  assistantMessageId: string;
  /**
   * Wire the harness's applied ledger to a fake Redis, making it DURABLE:
   * `coldReplica()` then models a replica death where the ledger survives.
   * Omit for the memory-only baseline (ledger dies with the replica), which
   * is also the crash-window / degraded-Redis posture the reducer guards
   * must cover on their own.
   */
  ledgerRedis?: HeteroLedgerRedis;
  operationId: string;
  topicId: string;
}) => {
  let nextMsgIdSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, FakeThread>();

  messages.set(params.assistantMessageId, {
    agentId: null,
    content: '',
    id: params.assistantMessageId,
    role: 'assistant',
    topicId: params.topicId,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextMsgIdSeq += 1;
      const msgId = id ?? `msg_${nextMsgIdSeq}`;
      const msg: FakeMessage = {
        agentId: input.agentId ?? null,
        content: input.content ?? '',
        id: msgId,
        metadata: input.metadata,
        model: input.model,
        parentId: input.parentId ?? null,
        plugin: input.plugin,
        provider: undefined,
        reasoning: input.reasoning,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        topicId: input.topicId ?? null,
      } as FakeMessage;
      messages.set(msgId, msg);
      return msg;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      // Mirror the real MessageModel.update: metadata is DEEP-MERGED, not
      // replaced — so e.g. a usage write doesn't clobber subagentMessageId.
      const next = { ...existing, ...patch };
      if (patch.metadata && existing.metadata) {
        next.metadata = { ...existing.metadata, ...patch.metadata };
      }
      messages.set(id, next);
      return { success: true };
    }),
    updateToolMessage: vi.fn(async (id: string, patch: any) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, { ...existing, content: patch.content ?? existing.content });
      return { success: true };
    }),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    query: vi.fn(async (params: { threadId?: string; topicId?: string }) => {
      if (params?.threadId) {
        return [...messages.values()].filter((m) => m.threadId === params.threadId);
      }
      return [...messages.values()].filter((m) => !m.threadId && m.topicId === params?.topicId);
    }),
    getLastMainThreadSpineMessageId: vi.fn(async (_topicId: string) => {
      const match = [...messages.values()].findLast(
        (m) => m.role !== 'tool' && !m.threadId && !(m as any).metadata?.signal,
      );
      return match?.id;
    }),
    listMessagePluginsByTopic: vi.fn(async (_topicId: string) => {
      // Mirror the real query: every persisted tool row's (toolCallId → id).
      return [...messages.values()]
        .filter((m) => m.role === 'tool' && m.tool_call_id)
        .map((m) => ({ id: m.id, toolCallId: m.tool_call_id! }));
    }),
  };

  const threadModel = {
    create: vi.fn(async (input: Partial<FakeThread>) => {
      const thread: FakeThread = {
        id: input.id!,
        metadata: input.metadata,
        sourceMessageId: input.sourceMessageId,
        status: input.status ?? 'active',
        title: input.title ?? '',
        topicId: input.topicId ?? params.topicId,
        type: input.type ?? 'isolation',
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    findById: vi.fn(async (id: string) => threads.get(id) ?? null),
    queryByTopicId: vi.fn(async (topicId: string) =>
      [...threads.values()].filter((t) => t.topicId === topicId),
    ),
    update: vi.fn(async (id: string, patch: Partial<FakeThread>) => {
      const existing = threads.get(id);
      if (!existing) return;
      threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async (id: string) => {
      if (id !== params.topicId) return null;
      return {
        agentId: null,
        id,
        metadata: {
          runningOperation: {
            assistantMessageId: params.assistantMessageId,
            operationId: params.operationId,
          },
        },
      };
    }),
    updateMetadata: vi.fn(async () => {}),
  };

  const appliedLedger = new HeteroEventLedger('applied', () => params.ledgerRedis ?? null);
  const handler = new HeterogeneousPersistenceHandler({
    appliedLedger,
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  /**
   * Simulate this operation's next batch landing on a fresh replica: the
   * per-operation state map AND the injected ledger's in-memory layer die
   * with the process. Only a `ledgerRedis`-wired ledger keeps its durable
   * half — exactly like production.
   */
  const coldReplica = () => {
    __resetOperationStatesForTesting();
    appliedLedger.__clearMemoryForTesting();
  };

  return { appliedLedger, coldReplica, handler, messageModel, messages, threadModel, threads };
};

const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown>,
): AgentStreamEvent => ({
  data,
  operationId: 'op-1',
  stepIndex,
  timestamp: 1_700_000_000_000 + stepIndex,
  type,
});

const innerTool = (id: string) => ({
  apiName: 'Bash',
  arguments: '{}',
  id,
  identifier: 'bash',
  type: 'default',
});

describe('HeterogeneousPersistenceHandler — subagent run survives a cold replica', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('does NOT spawn a duplicate thread when a later batch of the SAME subagent run lands on a fresh replica', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    const PARENT = 'tc-spawn-1';

    // ── Batch 1 (replica A): first subagent turn. Carries spawnMetadata, so the
    //    thread is created with a real title. ──
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          subagent: {
            parentToolCallId: PARENT,
            spawnMetadata: {
              description: 'Explore session/agent topic data model',
              prompt: 'investigate',
              subagentType: 'Explore',
            },
            subagentMessageId: 'sub-msg-1',
          },
          toolsCalling: [innerTool('inner-1')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    expect(h.threads.size).toBe(1);

    // ── Cold replica: the warm in-memory operation state is gone, but the DB
    //    (threads + messages) persists. ──
    h.coldReplica();

    // ── Batch 2 (replica B): the SAME subagent run continues with a new turn.
    //    Mirroring the adapter, this later event carries NO spawnMetadata. ──
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 1, {
          chunkType: 'tools_calling',
          subagent: {
            parentToolCallId: PARENT,
            subagentMessageId: 'sub-msg-2',
          },
          toolsCalling: [innerTool('inner-2')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    // The continuation must attach to the EXISTING thread, not fork a new one.
    expect(h.threads.size).toBe(1);
    // And we must never produce a generic-titled "Subagent" duplicate.
    expect([...h.threads.values()].some((t) => t.title === 'Subagent')).toBe(false);
  });

  // The screenshot bug: a subagent that already FINISHED (its parent
  // tool_result landed → thread flipped Active) has its FIRST event replayed on
  // a cold replica (BatchIngester retry / re-delivery where the in-memory
  // `processedKeys` dedupe is gone). Because finalized threads aren't rehydrated
  // as live runs, the empty reducer used to hit `!existing` and fork a SECOND
  // thread with the identical title ("一模一样的两个 thread"). The fix records
  // the finalized parent's `sourceToolCallId` in `finalizedParents` from the DB
  // `Active` thread, so the replayed first-event is a stale no-op.
  it('does NOT re-create the thread when a FINISHED subagent replays its first event on a fresh replica', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const PARENT = 'tc-spawn-1';

    const firstChunk = buildEvent('stream_chunk', 0, {
      chunkType: 'tools_calling',
      subagent: {
        parentToolCallId: PARENT,
        spawnMetadata: {
          description: 'Map client runtime completion paths',
          prompt: 'investigate',
          subagentType: 'Explore',
        },
        subagentMessageId: 'sub-msg-1',
      },
      toolsCalling: [innerTool('inner-1')],
    });

    // ── Batch 1 (replica A): subagent runs, then its parent tool_result lands →
    //    the run finalizes and the thread is flipped Active. ──
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [firstChunk, buildEvent('tool_result', 1, { content: 'done', toolCallId: PARENT })],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    expect(h.threads.size).toBe(1);
    const finishedThreadId = [...h.threads.keys()][0];
    expect(h.threads.get(finishedThreadId)!.status).toBe('active');

    // ── Cold replica: warm state gone, DB persists. ──
    h.coldReplica();

    // ── Replay of the SAME first event (processedKeys is empty on the fresh
    //    replica, so it is NOT deduped away — it really re-enters the reducer). ──
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [firstChunk],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    // Still exactly one thread — no duplicate, no second "Map client runtime…".
    expect(h.threads.size).toBe(1);
    expect([...h.threads.keys()]).toEqual([finishedThreadId]);
  });

  // P1: a tools_calling batch reprocessed on a cold replica (BatchIngester
  // retry, or a turn split across a cold boundary so the cumulative array is
  // re-seen) must NOT mint a second tool message for an inner tool the run
  // already persisted. Rehydration restores `lifetimeToolCallIds`, and the
  // reducer de-dupes against it.
  it('does NOT re-create an already-persisted inner tool row after a cold replica', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const PARENT = 'tc-spawn-1';

    // Batch 1: turn sub-msg-1 persists inner-1.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          subagent: {
            parentToolCallId: PARENT,
            spawnMetadata: { prompt: 'go', subagentType: 'Explore' },
            subagentMessageId: 'sub-msg-1',
          },
          toolsCalling: [innerTool('inner-1')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    h.coldReplica(); // cold replica

    // Batch 2 (replica B): the SAME turn's cumulative array is re-seen (inner-1
    // again) plus a new inner-2.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 1, {
          chunkType: 'tools_calling',
          subagent: { parentToolCallId: PARENT, subagentMessageId: 'sub-msg-1' },
          toolsCalling: [innerTool('inner-1'), innerTool('inner-2')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    const toolRows = (callId: string) =>
      [...h.messages.values()].filter((m) => m.role === 'tool' && m.tool_call_id === callId);
    // inner-1 persisted exactly once (no duplicate row), inner-2 once.
    expect(toolRows('inner-1')).toHaveLength(1);
    expect(toolRows('inner-2')).toHaveLength(1);
    expect(h.threads.size).toBe(1);
  });

  // P2: a stale `Processing` isolation thread left by a PRIOR operation on the
  // same topic must not be rehydrated into — or finalized by — the current
  // operation. The rehydration is scoped by `metadata.operationId`.
  it('ignores a stale Processing thread from a different operation on the same topic', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-2',
      topicId: 'topic-1',
    });

    // Seed a thread (+ its in-thread assistant) left Processing by op-1.
    h.threads.set('thd-stale', {
      id: 'thd-stale',
      metadata: { operationId: 'op-1', sourceToolCallId: 'tc-old' },
      sourceMessageId: 'asst-old',
      status: 'processing',
      title: 'Old Subagent',
      topicId: 'topic-1',
      type: 'isolation',
    });
    h.messages.set('stale-asst', {
      agentId: null,
      content: '',
      id: 'stale-asst',
      parentId: 'asst-old',
      role: 'assistant',
      threadId: 'thd-stale',
      topicId: 'topic-1',
    } as any);

    // op-2 runs and terminates. The terminal orphan-drain would finalize every
    // run in the reducer state — so if the stale thread were merged in, it would
    // be flipped to Active here.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'working' }),
        buildEvent('agent_runtime_end', 1, {}),
      ],
      operationId: 'op-2',
      topicId: 'topic-1',
    });

    // The unrelated thread is untouched: still Processing, never updated.
    expect(h.threads.get('thd-stale')!.status).toBe('processing');
    expect(h.threadModel.update).not.toHaveBeenCalledWith('thd-stale', expect.anything());
  });

  // The in-thread analog of the cold-replica bug: one CC subagent turn continued
  // on a fresh replica must NOT fork into a second in-thread assistant. The turn's
  // CC message.id is persisted on the assistant's metadata and recovered into
  // `currentSubagentMessageId`, so a continuation is recognized as the SAME turn.
  it('does NOT fragment one CC subagent turn across a cold replica (no split / empty shell)', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const PARENT = 'tc-spawn-1';

    // Batch 1: turn sub-1's first tool → lazy-create thread + user + in-thread
    // assistant (stamped subagentMessageId=sub-1) + tool t1.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          subagent: {
            parentToolCallId: PARENT,
            spawnMetadata: { prompt: 'go', subagentType: 'Explore' },
            subagentMessageId: 'sub-1',
          },
          toolsCalling: [innerTool('t1')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    const threadId = [...h.threads.keys()][0];
    const assistantsOf = () =>
      [...h.messages.values()].filter((m) => m.role === 'assistant' && m.threadId === threadId);
    expect(assistantsOf()).toHaveLength(1);
    // The turn id was persisted so a cold replica can recover it.
    expect(assistantsOf()[0].metadata?.subagentMessageId).toBe('sub-1');

    h.coldReplica(); // cold replica

    // Batch 2 (fresh replica): SAME turn sub-1 continues (cumulative [t1, t2]).
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [
        buildEvent('stream_chunk', 1, {
          chunkType: 'tools_calling',
          subagent: { parentToolCallId: PARENT, subagentMessageId: 'sub-1' },
          toolsCalling: [innerTool('t1'), innerTool('t2')],
        }),
      ],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    // Still exactly ONE in-thread assistant — no fork, no empty shell.
    const assistants = assistantsOf();
    expect(assistants).toHaveLength(1);
    // Both tool rows hang off that same assistant (t1 not duplicated).
    const toolRows = [...h.messages.values()].filter(
      (m) => m.role === 'tool' && (m.tool_call_id === 't1' || m.tool_call_id === 't2'),
    );
    expect(toolRows).toHaveLength(2);
    expect(new Set(toolRows.map((m) => m.parentId))).toEqual(new Set([assistants[0].id]));
  });
});

/**
 * The durable-corruption residual of #17309: subagent text has APPEND
 * semantics on the wire (each CC emission is a one-shot full block, a turn may
 * span several emissions), so unlike main-agent text (producer-seq'd `replace`
 * snapshots) it is NOT intrinsically idempotent under cold-replica replay.
 * Three cooperating pieces close it:
 *
 *   1. the durable `applied` ledger skips redelivered already-applied events
 *      before they reach the reducer (the common lost-response retry);
 *   2. the run's `seenSubagentMessageIds` ledger (DB-rehydrated) drops a
 *      replayed EARLIER turn that slips past the ledger (crash window /
 *      degraded Redis), which used to mint duplicate assistant rows with
 *      duplicated content;
 *   3. per-batch accumulator flush + (durable-ledger-gated) accumulator
 *      restore, so a same-turn continuation across a cold handoff appends to
 *      the persisted prefix instead of truncating it.
 */
describe('HeterogeneousPersistenceHandler — durable subagent text idempotency', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  const createLedgerRedis = (): HeteroLedgerRedis => {
    const sets = new Map<string, Set<string>>();
    return {
      del: async (key: string) => (sets.delete(key) ? 1 : 0),
      expire: async () => 1,
      sadd: async (key: string, ...members: string[]) => {
        let set = sets.get(key);
        if (!set) {
          set = new Set();
          sets.set(key, set);
        }
        let added = 0;
        for (const member of members) {
          if (!set.has(member)) {
            set.add(member);
            added += 1;
          }
        }
        return added;
      },
      smismember: async (key: string, ...members: string[]) =>
        members.map((member) => (sets.get(key)?.has(member) ? 1 : 0)),
    };
  };

  const PARENT = 'tc-spawn-1';
  const subText = (
    stepIndex: number,
    content: string,
    subagentMessageId: string,
    options: { spawn?: boolean } = {},
  ) =>
    buildEvent('stream_chunk', stepIndex, {
      chunkType: 'text',
      content,
      subagent: {
        parentToolCallId: PARENT,
        ...(options.spawn ? { spawnMetadata: { prompt: 'go', subagentType: 'Explore' } } : {}),
        subagentMessageId,
      },
    });

  it('a redelivered MULTI-TURN batch replayed on a cold replica mints no duplicate turn rows and no duplicated content (seen-turn ledger)', async () => {
    // Memory-only ledger: the replay REACHES the reducer — this is the crash
    // window (batch applied but died before the durable mark) or a degraded
    // Redis, exactly what the reducer-level guard must survive alone.
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const batch = [subText(0, 'block1', 'sub-1', { spawn: true }), subText(1, 'block2', 'sub-2')];

    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: batch,
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    const threadId = [...h.threads.keys()][0];
    const assistantsOf = () =>
      [...h.messages.values()].filter((m) => m.role === 'assistant' && m.threadId === threadId);
    const bySub = (id: string) =>
      assistantsOf().filter((m) => m.metadata?.subagentMessageId === id);
    expect(assistantsOf()).toHaveLength(2);
    expect(bySub('sub-1')[0].content).toBe('block1'); // boundary flush
    expect(bySub('sub-2')[0].content).toBe('block2'); // per-batch flush

    h.coldReplica();

    // Same batch redelivered: the sub-1 events' turn id differs from the
    // rehydrated CURRENT turn (sub-2), which used to read as a fresh boundary
    // → duplicate assistant row per replayed turn, content re-flushed into it.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: batch,
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    expect(assistantsOf()).toHaveLength(2); // no third / fourth row
    expect(bySub('sub-1')).toHaveLength(1);
    expect(bySub('sub-2')).toHaveLength(1);
    expect(bySub('sub-1')[0].content).toBe('block1'); // not doubled
    expect(bySub('sub-2')[0].content).toBe('block2');
  });

  it('a redelivered fully-applied batch on a cold replica re-applies nothing (durable applied ledger pairs with the accumulator restore)', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      ledgerRedis: createLedgerRedis(),
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const batch = [subText(0, 'hello', 'sub-1', { spawn: true })];

    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: batch,
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const threadId = [...h.threads.keys()][0];
    const assistantsOf = () =>
      [...h.messages.values()].filter((m) => m.role === 'assistant' && m.threadId === threadId);
    expect(assistantsOf()[0].content).toBe('hello');
    const createCallsAfterFirst = h.messageModel.create.mock.calls.length;

    h.coldReplica();

    // With the ledger durable, the cold replica ALSO restores the turn's
    // accumulator from the row ('hello'). If the redelivered event were
    // re-reduced it would append onto that restore → 'hellohello'. The ledger
    // skip is what makes restore + replay coexist.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: batch,
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    expect(h.messageModel.create.mock.calls.length).toBe(createCallsAfterFirst);
    expect(assistantsOf()).toHaveLength(1);
    expect(assistantsOf()[0].content).toBe('hello');
  });

  it('a same-turn text continuation across a cold handoff appends to the restored accumulator instead of truncating (per-batch flush + restore)', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      ledgerRedis: createLedgerRedis(),
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    // Batch 1 (replica A): the turn's FIRST text block. The per-batch flush
    // must persist it even though no boundary / tool / finalize ran.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [subText(0, 'Hello ', 'sub-1', { spawn: true })],
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    const threadId = [...h.threads.keys()][0];
    const assistantsOf = () =>
      [...h.messages.values()].filter((m) => m.role === 'assistant' && m.threadId === threadId);
    expect(assistantsOf()[0].content).toBe('Hello ');

    h.coldReplica();

    // Batch 2 (replica B, cold): the SAME turn's next block — a genuinely new
    // event, not a redelivery. The replica must restore 'Hello ' from the row
    // and append, not restart the accumulator and flush only the tail.
    await h.handler.ingest({
      assistantMessageId: 'asst-1',
      events: [subText(1, 'world', 'sub-1')],
      operationId: 'op-1',
      topicId: 'topic-1',
    });

    expect(assistantsOf()).toHaveLength(1);
    expect(assistantsOf()[0].content).toBe('Hello world');
  });
});
