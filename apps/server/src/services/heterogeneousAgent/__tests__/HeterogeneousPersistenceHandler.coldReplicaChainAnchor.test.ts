// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

/**
 * Regression for the remote-device chain-fork (observed on tpc_3DKmFfAmx9YA):
 * several CONSECUTIVE, DISTINCT main-agent steps all parented onto the run's
 * FIRST tool message instead of chaining linearly.
 *
 * Root cause: `refreshMainStateFromDb` used to anchor `lastToolMsgIdEver` off
 * `getLastChildToolMessageId(currentAssistantId)`. On a non-sticky / cold
 * replica (a WS reconnect storm spreads one run's batches across replicas),
 * `currentAssistantId` regresses to the operation's seeded placeholder when the
 * `heteroCurrentMsgId` pointer is not yet visible. The anchor then collapses to
 * the SEED's first child tool, and every later `newStep` opens off that same
 * node → orphan sibling forks.
 *
 * The fix anchors the chain to the RUN's real latest main-thread tool, read
 * from the DB and ordered by createdAt, independent of `currentAssistantId`.
 *
 * This harness models the precondition deterministically: `updateMetadata`
 * never persists `heteroCurrentMsgId`, so every cold load regresses
 * `currentAssistantId` to the seed — exactly the cross-replica window.
 */

interface FakeMessage {
  content: string;
  id: string;
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
      messages.set(id, { ...existing, ...patch });
      return { success: true };
    }),
    updateToolMessage: vi.fn(async () => ({ success: true })),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    query: vi.fn(async (params: { threadId?: string; topicId?: string }) => {
      if (params?.threadId)
        return [...messages.values()].filter((m) => m.threadId === params.threadId);
      return [...messages.values()].filter((m) => !m.threadId && m.topicId === params?.topicId);
    }),
    getLastChildToolMessageId: vi.fn(async (assistantMessageId: string) => {
      const match = [...messages.values()]
        .filter((m) => m.role === 'tool' && m.parentId === assistantMessageId && !m.threadId)
        .sort((a, b) => b.seq - a.seq)[0];
      return match?.id;
    }),
    getLastMainThreadToolMessageIdSince: vi.fn(async (topicId: string, sinceMessageId: string) => {
      const seed = messages.get(sinceMessageId);
      if (!seed) return undefined;
      const match = [...messages.values()]
        .filter(
          (m) => m.topicId === topicId && m.role === 'tool' && !m.threadId && m.seq >= seed.seq,
        )
        .sort((a, b) => b.seq - a.seq)[0];
      return match?.id;
    }),
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

  it('chains consecutive cold-replica steps off the run last tool, not the seed first tool', async () => {
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
    const toolA = [...h.messages.values()].find((m) => m.tool_call_id === 'tc-A')!;

    // First step still chains off the run's only existing tool (T1, seed's child).
    expect(a1.parentId).toBe(T1);
    // Second step must chain off step 1's tool — NOT collapse back onto T1.
    expect(a2.parentId).toBe(toolA.id);
    expect(a2.parentId).not.toBe(T1);

    // No fork: T1 has exactly one assistant child across the whole run.
    const t1AssistantChildren = [...h.messages.values()].filter(
      (m) => m.role === 'assistant' && m.parentId === T1,
    );
    expect(t1AssistantChildren).toHaveLength(1);
  });
});
