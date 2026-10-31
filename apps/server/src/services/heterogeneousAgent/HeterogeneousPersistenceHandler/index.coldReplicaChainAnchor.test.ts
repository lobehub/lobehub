// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting, HeterogeneousPersistenceHandler } from '.';
import { operationStates } from './operationState';

/**
 * Regression for the remote-device chain-fork (observed on tpc_3DKmFfAmx9YA):
 * several CONSECUTIVE, DISTINCT main-agent steps all parented onto the same
 * stale node instead of chaining linearly.
 *
 * On a non-sticky / cold replica (a WS reconnect storm spreads one run's batches
 * across replicas), `currentAssistantId` regresses to the operation's seeded
 * placeholder when the `heteroCurrentMsgId` pointer is not yet visible. If the
 * chain parent were derived from that in-memory pointer, every later `newStep`
 * would open off the seed → orphan sibling forks.
 *
 * The phase 2 rewrite anchors the chain to the run's latest NON-tool / NON-signal
 * scoped message (`getLatestSpineMessageId`), read straight from the
 * DB and ordered by createdAt — independent of `currentAssistantId`. So step 2
 * chains off step 1's assistant even though the in-memory pointer regressed.
 *
 * This harness models the precondition deterministically: `updateMetadata`
 * never persists `heteroCurrentMsgId`, so every cold load regresses
 * `currentAssistantId` to the seed — exactly the cross-replica window.
 */

interface FakeMessage {
  content: string;
  id: string;
  metadata?: Record<string, any>;
  parentId?: string | null;
  role: 'user' | 'assistant' | 'tool';
  seq: number;
  threadId?: string | null;
  tool_call_id?: string;
  tools?: any[];
  topicId: string | null;
}

const SEED = 'asst-seed';
const T1 = 'tool-1'; // the run's first-turn tool, a child of the seed assistant
const OP = 'op-1';
const TOPIC = 'topic-1';

const createHarness = () => {
  let seq = 0;
  const messages = new Map<string, FakeMessage>();

  // No `heteroCurrentMsgId` — and updateMetadata below refuses to persist it —
  // so loadOrCreateState always falls back to runningOperation.assistantMessageId.
  let topicMetadata: Record<string, any> = {
    runningOperation: { assistantMessageId: SEED, operationId: OP },
  };

  messages.set(SEED, {
    content: 'first turn answer',
    id: SEED,
    role: 'assistant',
    seq: seq++,
    topicId: TOPIC,
  });
  messages.set(T1, {
    content: '',
    id: T1,
    parentId: SEED,
    role: 'tool',
    seq: seq++,
    threadId: null,
    tool_call_id: 'tc-0',
    topicId: TOPIC,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      const msgId = id ?? `msg_${seq}`;
      const msg: FakeMessage = {
        content: input.content ?? '',
        id: msgId,
        metadata: input.metadata,
        parentId: input.parentId ?? null,
        role: input.role!,
        seq: seq++,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        tools: input.tools,
        topicId: input.topicId ?? null,
      };
      messages.set(msgId, msg);
      return msg;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, {
        ...existing,
        ...patch,
        // MessageModel.update merges metadata patches into the stored row.
        metadata: patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
      });
      return { success: true };
    }),
    updateToolMessage: vi.fn(async () => ({ success: true })),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    query: vi.fn(async (params: { threadId?: string; topicId?: string }) => {
      if (params?.threadId)
        return [...messages.values()].filter((m) => m.threadId === params.threadId);
      return [...messages.values()].filter((m) => !m.threadId && m.topicId === params?.topicId);
    }),
    getLatestSpineMessageId: vi.fn(
      async ({ threadId, topicId }: { threadId?: string | null; topicId: string }) => {
        // Most recent main-thread, non-tool, non-signal message — the spine anchor.
        const match = [...messages.values()]
          .filter(
            (m) =>
              m.topicId === topicId &&
              m.role !== 'tool' &&
              m.threadId === (threadId ?? null) &&
              !m.metadata?.signal,
          )
          .sort((a, b) => b.seq - a.seq)[0];
        return match?.id;
      },
    ),
    listMessagePluginsByTopic: vi.fn(async () =>
      [...messages.values()]
        .filter((m) => m.role === 'tool' && m.tool_call_id)
        .map((m) => ({ id: m.id, toolCallId: m.tool_call_id! })),
    ),
  };

  const topicModel = {
    findById: vi.fn(async (id: string) =>
      id === TOPIC ? { agentId: null, id, metadata: topicMetadata } : null,
    ),
    updateMetadata: vi.fn(async (_id: string, patch: Record<string, any>) => {
      // Drop heteroCurrentMsgId to model a cold replica that never sees the
      // current-assistant pointer written by a concurrent replica.
      const { heteroCurrentMsgId: _drop, ...rest } = patch;
      topicMetadata = { ...topicMetadata, ...rest };
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

  return { handler, messages };
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

const stepBatch = (stepIndex: number, ccMsgId: string, toolCallId: string): AgentStreamEvent[] => [
  buildEvent('stream_start', stepIndex, {
    messageId: ccMsgId,
    newStep: true,
    provider: 'claude-code',
  }),
  buildEvent('stream_chunk', stepIndex, {
    chunkType: 'tools_calling',
    toolsCalling: [
      { apiName: 'Bash', arguments: '{}', id: toolCallId, identifier: 'bash', type: 'default' },
    ],
  }),
];

describe('HeterogeneousPersistenceHandler — chain anchor survives a regressed currentAssistantId', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('chains consecutive cold-replica steps linearly off the spine, not forking onto the seed', async () => {
    const h = createHarness();

    // Step 1 on a cold replica (currentAssistantId regresses to SEED).
    await h.handler.ingest({
      assistantMessageId: SEED,
      events: stepBatch(1, 'cc-A', 'tc-A'),
      operationId: OP,
      topicId: TOPIC,
    });
    __resetOperationStatesForTesting();
    // Step 2 on ANOTHER cold replica (currentAssistantId regresses to SEED again).
    await h.handler.ingest({
      assistantMessageId: SEED,
      events: stepBatch(2, 'cc-B', 'tc-B'),
      operationId: OP,
      topicId: TOPIC,
    });

    const assistants = [...h.messages.values()].filter(
      (m) => m.role === 'assistant' && m.id !== SEED,
    );
    expect(assistants).toHaveLength(2);

    const [a1, a2] = assistants.sort((x, y) => x.seq - y.seq);

    // Step 1 chains off the spine = the seed assistant (T1 is a tool, excluded).
    expect(a1.parentId).toBe(SEED);
    // Step 2 chains off step 1's assistant — the spine query found a1 from the DB
    // despite the in-memory currentAssistantId having regressed to SEED.
    expect(a2.parentId).toBe(a1.id);

    // No fork: the seed has exactly one assistant child (a1), and a1 has exactly
    // one assistant child (a2) — a linear spine, not a fan-out.
    const seedAssistantChildren = [...h.messages.values()].filter(
      (m) => m.role === 'assistant' && m.parentId === SEED,
    );
    expect(seedAssistantChildren).toHaveLength(1);
    const a1AssistantChildren = [...h.messages.values()].filter(
      (m) => m.role === 'assistant' && m.parentId === a1.id,
    );
    expect(a1AssistantChildren).toHaveLength(1);
  });
});

/**
 * Regression observed in a production topic: the main agent launched background subagents,
 * ended its turn with a toolless "still running" reply, and CC woke the LLM
 * minutes later when each subagent finished. Those wake-up turns are signal
 * turns and must hang off a tool so the read side folds them into the run's
 * AssistantGroup. The batch carrying them reached a replica that had never
 * reduced this run's tool batches, so the in-memory `lastToolMsgIdEver` was
 * empty and both turns fell back onto the toolless spine reply — rendering as
 * two extra top-level replies.
 */
describe('HeterogeneousPersistenceHandler — signal turn anchor on a cold replica', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  const textStep = (stepIndex: number, ccMsgId: string, content: string): AgentStreamEvent[] => [
    buildEvent('stream_start', stepIndex, {
      messageId: ccMsgId,
      newStep: true,
      provider: 'claude-code',
    }),
    buildEvent('stream_chunk', stepIndex, { chunkType: 'text', content }),
  ];

  const signalStep = (stepIndex: number, ccMsgId: string): AgentStreamEvent[] => [
    buildEvent('stream_start', stepIndex, {
      externalSignal: {
        sourceToolCallId: 'tc-A',
        sourceToolName: 'Agent',
        type: 'task-completion',
      },
      messageId: ccMsgId,
      newStep: true,
      provider: 'claude-code',
    }),
    buildEvent('stream_chunk', stepIndex, { chunkType: 'text', content: 'subagent finished' }),
  ];

  const signalTurn = (messages: Map<string, FakeMessage>) =>
    [...messages.values()].find((m) => m.role === 'assistant' && m.metadata?.signal);

  it("anchors the wake-up turn onto the run's last tool, not the toolless spine reply", async () => {
    const h = createHarness();

    // Warm replica: launch the background task, then end the turn without tools.
    await h.handler.ingest({
      assistantMessageId: SEED,
      events: [...stepBatch(1, 'cc-A', 'tc-A'), ...textStep(2, 'cc-B', 'still running')],
      operationId: OP,
      topicId: TOPIC,
    });
    __resetOperationStatesForTesting();

    // Cold replica: the task finished and CC woke the LLM.
    await h.handler.ingest({
      assistantMessageId: SEED,
      events: signalStep(3, 'cc-C'),
      operationId: OP,
      topicId: TOPIC,
    });

    const launchTool = [...h.messages.values()].find(
      (m) => m.role === 'tool' && m.tool_call_id === 'tc-A',
    );
    expect(launchTool).toBeDefined();
    expect(signalTurn(h.messages)?.parentId).toBe(launchTool!.id);
  });

  it("does not anchor onto a previous run's tool when this run has none", async () => {
    const h = createHarness();
    // Seat SEED behind an earlier run: prevAsst (with a tool) → user → SEED.
    h.messages.set('prev-asst', {
      content: '',
      id: 'prev-asst',
      parentId: null,
      role: 'assistant',
      seq: -3,
      threadId: null,
      tools: [{ id: 'tc-prev', result_msg_id: 'prev-tool' }],
      topicId: TOPIC,
    });
    h.messages.set('prev-tool', {
      content: '',
      id: 'prev-tool',
      parentId: 'prev-asst',
      role: 'tool',
      seq: -2,
      threadId: null,
      tool_call_id: 'tc-prev',
      topicId: TOPIC,
    });
    h.messages.set('user-1', {
      content: 'next question',
      id: 'user-1',
      parentId: 'prev-asst',
      role: 'user',
      seq: -1,
      threadId: null,
      topicId: TOPIC,
    });
    h.messages.set(SEED, { ...h.messages.get(SEED)!, parentId: 'user-1', threadId: null });
    h.messages.delete(T1);

    await h.handler.ingest({
      assistantMessageId: SEED,
      events: signalStep(1, 'cc-A'),
      operationId: OP,
      topicId: TOPIC,
    });

    // No tool in this run: fall back to the spine, never cross the user turn.
    expect(signalTurn(h.messages)?.parentId).toBe(SEED);
  });
});

/**
 * Observed in a production topic: two background tasks woke the LLM one after
 * the other, and each wake-up called a tool. The first wake-up landed on another
 * replica, so the replica that ran the main turn still held the main turn's tool
 * as `lastToolMsgIdEver` when the second wake-up reached it. Both wake-ups ended
 * up under that one tool, and the UI showed only the first.
 */
describe('HeterogeneousPersistenceHandler — signal turn anchor on a stale warm replica', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  const textStep = (stepIndex: number, ccMsgId: string, content: string): AgentStreamEvent[] => [
    buildEvent('stream_start', stepIndex, {
      messageId: ccMsgId,
      newStep: true,
      provider: 'claude-code',
    }),
    buildEvent('stream_chunk', stepIndex, { chunkType: 'text', content }),
  ];

  const wakeUpStep = (
    stepIndex: number,
    ccMsgId: string,
    toolCallId: string,
  ): AgentStreamEvent[] => [
    buildEvent('stream_start', stepIndex, {
      externalSignal: {
        sourceToolCallId: 'tc-A',
        sourceToolName: 'Agent',
        type: 'task-completion',
      },
      messageId: ccMsgId,
      newStep: true,
      provider: 'claude-code',
    }),
    buildEvent('stream_chunk', stepIndex, {
      chunkType: 'tools_calling',
      toolsCalling: [
        { apiName: 'Bash', arguments: '{}', id: toolCallId, identifier: 'bash', type: 'default' },
      ],
    }),
  ];

  it("anchors the second wake-up onto the first wake-up's tool", async () => {
    const h = createHarness();
    const ingest = (events: AgentStreamEvent[]) =>
      h.handler.ingest({ assistantMessageId: SEED, events, operationId: OP, topicId: TOPIC });

    // Replica A: the main turn launches the task and ends without tools.
    await ingest([...stepBatch(1, 'cc-A', 'tc-A'), ...textStep(2, 'cc-B', 'still running')]);
    const replicaA = operationStates.get(OP)!;

    // Replica B: the first wake-up reads the task output, then replies.
    __resetOperationStatesForTesting();
    await ingest([...wakeUpStep(3, 'cc-C', 'tc-W1'), ...textStep(4, 'cc-D', 'one task left')]);

    // Replica A again, warm but behind: the second wake-up.
    __resetOperationStatesForTesting();
    operationStates.set(OP, replicaA);
    await ingest(wakeUpStep(5, 'cc-E', 'tc-W2'));

    const toolOf = (toolCallId: string) =>
      [...h.messages.values()].find((m) => m.tool_call_id === toolCallId)!;
    const secondWakeUp = toolOf('tc-W2').parentId;
    expect(h.messages.get(secondWakeUp!)?.parentId).toBe(toolOf('tc-W1').id);
  });
});
