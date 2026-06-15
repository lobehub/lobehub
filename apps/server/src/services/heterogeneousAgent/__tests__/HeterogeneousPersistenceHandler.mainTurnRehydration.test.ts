// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

/**
 * Regression for the MAIN-chain analog of #15808 (which only fixed the SUBAGENT
 * coordinator).
 *
 * The main-agent reducer (`packages/heterogeneous-agents/src/mainAgentCoordinator`)
 * cuts a turn purely on the adapter's `stream_start { newStep: true }` signal —
 * it tracks NO CC `message.id` and `openTurn` mints a fresh random assistant id
 * via `ctx.newId('message')`. So unlike the subagent path (which now persists the
 * turn's CC message.id on `metadata.subagentMessageId` and dedupes a replayed
 * turn), the main chain has NO DB-homed idempotency key for a turn.
 *
 * The serverless failure mode:
 *  - `processedKeys` (the per-event dedupe set) lives ONLY in the in-memory
 *    `operationStates` map. On a cold replica it is empty.
 *  - The ingest contract (see `ingest()` doc) is: a handler that throws leaves
 *    its event unmarked, the throw bubbles to the producer, and the producer
 *    re-sends the WHOLE batch. Already-applied events are skipped "via the
 *    dedupe map" — but that map is in-memory, so on a cold replica retry every
 *    event (including the `newStep`) is reprocessed.
 *  - Reprocessing `newStep` re-runs `openTurn`, which mints a SECOND assistant.
 *    The first one (created before the throw, already carrying the turn's usage
 *    but no flushed content) is orphaned as an empty shell — content empty,
 *    tools 0, usage present. Exactly the "空壳条" in the reported triad.
 *
 * This test simulates a mid-batch DB failure on replica A, then a cold replica
 * (`__resetOperationStatesForTesting()`) processing the producer's resend.
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

const SEED = 'asst-seed';
const OP = 'op-1';
const TOPIC = 'topic-1';

const createHarness = () => {
  let nextMsgIdSeq = 0;
  const messages = new Map<string, FakeMessage>();

  // Faithful topic-metadata store: the real TopicModel.updateMetadata DEEP-MERGES
  // into the JSONB column. The main-chain cold-replica recovery reads
  // `heteroCurrentMsgId` from here, so a no-op mock (as in the subagent test)
  // would not exercise the path under test.
  let topicMetadata: Record<string, any> = {
    runningOperation: { assistantMessageId: SEED, operationId: OP },
  };

  // Trip a single mid-batch DB failure: the Nth `messageModel.update` throws once.
  let updateCalls = 0;
  let failUpdateAtCall = -1;

  // Seed the run's first-turn assistant (already has content, like a real run
  // where `newStep` opens the SECOND turn).
  messages.set(SEED, {
    agentId: null,
    content: 'first turn answer',
    id: SEED,
    role: 'assistant',
    topicId: TOPIC,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextMsgIdSeq += 1;
      const msgId = id ?? `msg_${nextMsgIdSeq}`;
      const msg = {
        agentId: input.agentId ?? null,
        content: input.content ?? '',
        id: msgId,
        metadata: input.metadata,
        model: input.model,
        parentId: input.parentId ?? null,
        plugin: input.plugin,
        reasoning: input.reasoning,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        tools: input.tools,
        topicId: input.topicId ?? null,
      } as FakeMessage;
      messages.set(msgId, msg);
      return msg;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      updateCalls += 1;
      if (updateCalls === failUpdateAtCall) {
        throw new Error('simulated mid-batch DB failure');
      }
      const existing = messages.get(id);
      if (!existing) return { success: false };
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
      if (params?.threadId)
        return [...messages.values()].filter((m) => m.threadId === params.threadId);
      return [...messages.values()].filter((m) => !m.threadId && m.topicId === params?.topicId);
    }),
    getLastChildToolMessageId: vi.fn(async (assistantMessageId: string) => {
      const match = [...messages.values()].findLast(
        (m) => m.role === 'tool' && m.parentId === assistantMessageId && !m.threadId,
      );
      return match?.id;
    }),
    listMessagePluginsByTopic: vi.fn(async () =>
      [...messages.values()]
        .filter((m) => m.role === 'tool' && m.tool_call_id)
        .map((m) => ({ id: m.id, toolCallId: m.tool_call_id! })),
    ),
  };

  const topicModel = {
    findById: vi.fn(async (id: string) => {
      if (id !== TOPIC) return null;
      return { agentId: null, id, metadata: topicMetadata };
    }),
    updateMetadata: vi.fn(async (_id: string, patch: Record<string, any>) => {
      // Deep-merge top-level keys, matching the real model.
      topicMetadata = { ...topicMetadata, ...patch };
    }),
  };

  const threadModel = {
    create: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    queryByTopicId: vi.fn(async () => []),
    update: vi.fn(async () => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return {
    handler,
    messages,
    setFailUpdateAtCall: (n: number) => {
      failUpdateAtCall = n;
    },
  };
};

const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown>,
): AgentStreamEvent => ({
  data,
  operationId: OP,
  stepIndex,
  timestamp: 1_700_000_000_000 + stepIndex,
  type,
});

describe('HeterogeneousPersistenceHandler — main turn survives a cold-replica retry', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('does NOT fork one main turn into a duplicate + empty shell when a batch is retried on a cold replica', async () => {
    const h = createHarness();

    // The producer's batch for a turn boundary: open a new turn, record its
    // usage, then a tool batch. We trip the DB to fail on the tool-batch
    // Phase-1 update, AFTER the turn's usage has already been written to the
    // new assistant — so the orphan left behind is a true usage-bearing empty
    // shell. `update` call order on replica A: #1 = openTurn flush of the seed's
    // first-turn content, #2 = recordUsage on the new assistant, #3 = tools[]
    // Phase 1 (← throws).
    const batch = [
      buildEvent('stream_start', 1, {
        messageId: 'cc-msg-2',
        newStep: true,
        provider: 'claude-code',
      }),
      buildEvent('step_complete', 1, {
        phase: 'turn_metadata',
        usage: { totalInputTokens: 64_700, totalTokens: 64_700 },
      }),
      buildEvent('stream_chunk', 1, {
        chunkType: 'tools_calling',
        toolsCalling: [
          { apiName: 'Bash', arguments: '{}', id: 'tc-1', identifier: 'bash', type: 'default' },
        ],
      }),
    ];

    // ── Replica A: processes newStep (creates the turn assistant) + usage, then
    //    THROWS on the tool-batch write. The batch is left un-acked. ──
    h.setFailUpdateAtCall(3);
    await expect(
      h.handler.ingest({
        assistantMessageId: SEED,
        events: batch,
        operationId: OP,
        topicId: TOPIC,
      }),
    ).rejects.toThrow('simulated mid-batch DB failure');

    // ── Cold replica: warm operation state (incl. processedKeys) is gone; the DB
    //    persists. The producer re-sends the SAME batch. ──
    __resetOperationStatesForTesting();

    // ── Replica B: full batch succeeds this time. ──
    await h.handler.ingest({
      assistantMessageId: SEED,
      events: batch,
      operationId: OP,
      topicId: TOPIC,
    });

    // One `newStep` must yield exactly ONE new turn assistant (besides the seed).
    const turnAssistants = [...h.messages.values()].filter(
      (m) => m.role === 'assistant' && m.id !== SEED,
    );

    // Empty-shell detector: an assistant with usage but no content and no child tools.
    const childToolsOf = (asstId: string) =>
      [...h.messages.values()].filter((m) => m.role === 'tool' && m.parentId === asstId);
    const emptyShells = turnAssistants.filter(
      (m) => !m.content && childToolsOf(m.id).length === 0 && !!m.metadata?.usage,
    );

    expect(emptyShells).toHaveLength(0);
    expect(turnAssistants).toHaveLength(1);
  });
});
