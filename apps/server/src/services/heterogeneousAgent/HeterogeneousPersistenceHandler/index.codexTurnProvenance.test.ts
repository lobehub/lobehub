// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting, HeterogeneousPersistenceHandler } from '.';

interface FakeMessage {
  agentId: string | null;
  content: string;
  id: string;
  metadata?: any;
  parentId?: string | null;
  role: 'user' | 'assistant' | 'tool' | 'task' | 'system';
  threadId?: string | null;
  tool_call_id?: string;
  topicId: string | null;
}

const createHarness = (params: {
  assistantMessageId: string;
  operationId: string;
  topicId: string;
}) => {
  let nextMsgIdSeq = 0;
  const messages = new Map<string, FakeMessage>([
    [
      params.assistantMessageId,
      {
        agentId: null,
        content: '',
        id: params.assistantMessageId,
        role: 'assistant',
        threadId: null,
        topicId: params.topicId,
      },
    ],
  ]);

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextMsgIdSeq += 1;
      const msg = {
        agentId: input.agentId ?? null,
        content: input.content ?? '',
        id: id ?? `msg_${nextMsgIdSeq}`,
        metadata: input.metadata,
        parentId: input.parentId ?? null,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
        topicId: input.topicId ?? null,
      } as FakeMessage;
      messages.set(msg.id, msg);
      return msg;
    }),
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    getLatestSpineMessageId: vi.fn(async () => undefined),
    listMessagePluginsByTopic: vi.fn(async () => []),
    query: vi.fn(async () => [...messages.values()]),
    update: vi.fn(async (id: string, patch: Partial<FakeMessage>) => {
      const existing = messages.get(id);
      if (!existing) return { success: false };
      messages.set(id, { ...existing, ...patch });
      return { success: true };
    }),
    updateToolMessage: vi.fn(async () => ({ success: true })),
  };

  const topicModel = {
    findById: vi.fn(async (id: string) =>
      id === params.topicId
        ? {
            agentId: null,
            id,
            metadata: {
              runningOperation: {
                assistantMessageId: params.assistantMessageId,
                operationId: params.operationId,
              },
            },
          }
        : null,
    ),
    updateMetadata: vi.fn(async () => {}),
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

  return { handler, messages, topicModel };
};

/** @example A native Codex turn is recorded on both rows of the exchange. */
describe('native Codex turn provenance', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  // ROOT CAUSE:
  // Device stream_start carried only the native session, so a device-run Codex message
  // had no turn boundary and no later operation could locate it in the native thread.
  /** @example The user prompt and its answer share the native turn before any text arrives. */
  it('stamps the native turn on the source user prompt and the assistant', async () => {
    const h = createHarness({
      assistantMessageId: 'answer',
      operationId: 'native-op',
      topicId: 'topic-1',
    });
    h.messages.set('prompt', {
      agentId: null,
      content: 'question',
      id: 'prompt',
      role: 'user',
      threadId: null,
      topicId: 'topic-1',
    });
    h.messages.get('answer')!.parentId = 'prompt';

    await h.handler.ingest({
      events: [
        {
          data: { codexTurnId: 'native-turn', sessionId: 'native-thread' },
          operationId: 'native-op',
          stepIndex: 0,
          timestamp: 1,
          type: 'stream_start',
        },
      ],
      operationId: 'native-op',
      topicId: 'topic-1',
    });

    /** @example The prompt can be located in the native thread after reload. */
    expect(h.messages.get('prompt')?.metadata).toEqual({
      codexTurnId: 'native-turn',
      heteroSessionId: 'native-thread',
    });
    /** @example The assistant carries the same boundary before it has content. */
    expect(h.messages.get('answer')?.metadata).toEqual({
      codexTurnId: 'native-turn',
      heteroSessionId: 'native-thread',
    });
    /** @example The topic resume binding is unchanged by the provenance write. */
    expect(h.topicModel.updateMetadata).toHaveBeenCalledWith('topic-1', {
      heteroSessionId: 'native-thread',
    });
  });

  /** @example A user row in another topic is never stamped with this run's turn. */
  it('does not stamp a parent row outside the run topic', async () => {
    const h = createHarness({
      assistantMessageId: 'answer',
      operationId: 'native-op',
      topicId: 'topic-1',
    });
    h.messages.set('foreign', {
      agentId: null,
      content: 'question',
      id: 'foreign',
      role: 'user',
      threadId: null,
      topicId: 'topic-2',
    });
    h.messages.get('answer')!.parentId = 'foreign';

    await h.handler.ingest({
      events: [
        {
          data: { codexTurnId: 'native-turn', sessionId: 'native-thread' },
          operationId: 'native-op',
          stepIndex: 0,
          timestamp: 1,
          type: 'stream_start',
        },
      ],
      operationId: 'native-op',
      topicId: 'topic-1',
    });

    expect(h.messages.get('foreign')?.metadata).toBeUndefined();
  });
});
