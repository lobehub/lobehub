// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      messages.set(id, { ...existing, ...patch });
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
    getLastChildToolMessageId: vi.fn(async (assistantMessageId: string) => {
      const match = [...messages.values()].findLast(
        (m) => m.role === 'tool' && m.parentId === assistantMessageId && !m.threadId,
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

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return { handler, messages, threadModel, threads };
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
    __resetOperationStatesForTesting();

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

    __resetOperationStatesForTesting(); // cold replica

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
});
