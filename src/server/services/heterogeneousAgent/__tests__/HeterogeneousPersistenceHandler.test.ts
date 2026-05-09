// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

interface FakeMessage {
  agentId: string | null;
  content: string;
  error?: any;
  id: string;
  metadata?: any;
  model?: string;
  parentId?: string | null;
  plugin?: any;
  pluginError?: any;
  pluginState?: any;
  provider?: string;
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
  topicAgentId?: string | null;
  topicId: string;
}) => {
  let nextMsgIdSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, FakeThread>();

  // Seed the initial assistant message that the orchestrator would have
  // created before triggering the CLI ingest.
  messages.set(params.assistantMessageId, {
    agentId: params.topicAgentId ?? null,
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
        provider: input.provider,
        role: input.role!,
        threadId: input.threadId ?? null,
        tool_call_id: input.tool_call_id,
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
    updateToolMessage: vi.fn(
      async (
        id: string,
        patch: { content?: string; metadata?: any; pluginError?: any; pluginState?: any },
      ) => {
        const existing = messages.get(id);
        if (!existing) return { success: false };
        messages.set(id, {
          ...existing,
          content: patch.content ?? existing.content,
          metadata: patch.metadata ?? existing.metadata,
          pluginError: patch.pluginError,
          pluginState: patch.pluginState ?? existing.pluginState,
        });
        return { success: true };
      },
    ),
    listMessagePluginsByTopic: vi.fn(async (_topicId: string) => []),
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
        agentId: params.topicAgentId ?? null,
        id,
        metadata: {
          runningOperation: {
            assistantMessageId: params.assistantMessageId,
            operationId: params.operationId,
          },
        },
      };
    }),
    updateMetadata: vi.fn(async (_topicId: string, _patch: any) => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return { handler, messageModel, messages, threadModel, threads, topicModel };
};

const buildEvent = (
  type: AgentStreamEvent['type'],
  stepIndex: number,
  data: Record<string, unknown>,
  timestamp = 1_700_000_000_000 + stepIndex,
): AgentStreamEvent => ({
  data,
  operationId: 'op-test',
  stepIndex,
  timestamp,
  type,
});

describe('HeterogeneousPersistenceHandler', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
  });

  afterEach(() => {
    __resetOperationStatesForTesting();
  });

  describe('state bootstrap', () => {
    it('reads runningOperation from topic.metadata to find the seeded assistantMessageId', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-seeded',
        operationId: 'op-1',
        topicAgentId: 'agent-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'hello ' }),
          buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'world' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(h.topicModel.findById).toHaveBeenCalledWith('topic-1');
      // Text chunks accumulate; flushed to DB at end of each batch (multi-replica fix)
      expect(h.messageModel.update).toHaveBeenCalledWith('asst-seeded', { content: 'hello world' });
    });

    it('throws when the topic has no matching runningOperation', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-other',
            operationId: 'op-OTHER',
          },
        },
      });

      await expect(
        h.handler.ingest({
          events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/No matching runningOperation/);
    });

    it('rejects mid-flight topic mismatch on the same operationId', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await expect(
        h.handler.ingest({
          events: [buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'y' })],
          operationId: 'op-1',
          topicId: 'topic-OTHER',
        }),
      ).rejects.toThrow(/already bound to topic/);
    });
  });

  describe('idempotency', () => {
    it('drops events with the same (stepIndex, type, timestamp, dataFingerprint) key', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const tools = [
        {
          apiName: 'Bash',
          arguments: '{"cmd":"ls"}',
          id: 'tc-1',
          identifier: 'bash',
          type: 'default',
        },
      ];
      const evt = buildEvent('stream_chunk', 0, {
        chunkType: 'tools_calling',
        toolsCalling: tools,
      });

      await h.handler.ingest({ events: [evt], operationId: 'op-1', topicId: 'topic-1' });
      const createCallsAfterFirst = h.messageModel.create.mock.calls.length;

      await h.handler.ingest({ events: [evt], operationId: 'op-1', topicId: 'topic-1' });

      // Same event re-ingested → idempotency skips it; no extra tool-message create
      expect(h.messageModel.create.mock.calls.length).toBe(createCallsAfterFirst);
    });

    it('does NOT collide bursty events sharing (stepIndex, type, timestamp) when their data differs', async () => {
      // Producer-side reality: CC adapters stamp every event with `Date.now()`,
      // so multiple `stream_chunk` events within the same step burst through
      // a single millisecond. Without a content fingerprint in the dedupe
      // key, all but the first would be dropped → truncated assistant text.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const sameTimestamp = 1_700_000_000_000;
      const events: AgentStreamEvent[] = [
        {
          ...buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'one ' }),
          timestamp: sameTimestamp,
        },
        {
          ...buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'two ' }),
          timestamp: sameTimestamp,
        },
        {
          ...buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'three' }),
          timestamp: sameTimestamp,
        },
        buildEvent('agent_runtime_end', 0, { reason: 'success' }),
      ];

      await h.handler.ingest({ events, operationId: 'op-1', topicId: 'topic-1' });

      const asst = h.messages.get('asst-1')!;
      expect(asst.content).toBe('one two three');
    });

    it('mark-processed-AFTER-success contract: a thrown handler leaves the event un-marked so retry replays it', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // First call to messageModel.update on asst-1 throws once.
      let updateAttempts = 0;
      const realUpdate = h.messageModel.update.getMockImplementation()!;
      h.messageModel.update.mockImplementation(async (id: string, patch: any) => {
        if (id === 'asst-1' && patch.metadata?.usage) {
          updateAttempts += 1;
          if (updateAttempts === 1) {
            throw new Error('flaky');
          }
        }
        return realUpdate(id, patch);
      });

      const evt = buildEvent('step_complete', 0, {
        phase: 'turn_metadata',
        usage: { inputTokens: 1 },
      });

      // First attempt: handler throws.
      await expect(
        h.handler.ingest({ events: [evt], operationId: 'op-1', topicId: 'topic-1' }),
      ).rejects.toThrow('flaky');

      // Retry SAME event — the handler now succeeds because the flake is gone.
      // Critical: the dedupe map didn't pre-mark the failed event, so this
      // re-runs instead of skipping silently.
      await h.handler.ingest({ events: [evt], operationId: 'op-1', topicId: 'topic-1' });

      const asst = h.messages.get('asst-1')!;
      expect(asst.metadata).toEqual({ usage: { inputTokens: 1 } });
    });
  });

  describe('3-phase tool persist (main agent)', () => {
    it('writes assistant.tools[] then tool message then backfilled result_msg_id in order', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Capture call order across both methods so we can assert phase
      // sequence (renderer mutates the tools[] array in place across phases,
      // so verifying post-mortem state on call args is unreliable; relative
      // ordering of distinct mock invocations is the durable contract).
      const order: string[] = [];
      const origCreate = h.messageModel.create.getMockImplementation()!;
      const origUpdate = h.messageModel.update.getMockImplementation()!;
      h.messageModel.update.mockImplementation(async (id: string, patch: any) => {
        if (id === 'asst-1') order.push('update-asst');
        return origUpdate(id, patch);
      });
      h.messageModel.create.mockImplementation(async (input: any) => {
        order.push(input.role === 'tool' ? 'create-tool' : 'create-other');
        return origCreate(input);
      });

      const tool = {
        apiName: 'Bash',
        arguments: '{"cmd":"ls"}',
        id: 'tc-1',
        identifier: 'bash',
        type: 'default' as const,
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'looking ' }),
          buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('tool_result', 2, {
            content: 'a.ts\nb.ts',
            isError: false,
            toolCallId: 'tc-1',
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Phase 1 (update-asst) → Phase 2 (create-tool) → Phase 3 (update-asst) → batch flush (update-asst)
      expect(order).toEqual(['update-asst', 'create-tool', 'update-asst', 'update-asst']);

      // Tool message exists with content from tool_result + correct tool_call_id
      const toolMsg = [...h.messages.values()].find((m) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.tool_call_id).toBe('tc-1');
      expect(toolMsg?.content).toBe('a.ts\nb.ts');

      // Final assistant.tools[] carries the backfilled result_msg_id
      const finalAsst = h.messages.get('asst-1')!;
      expect(finalAsst.tools?.[0]).toMatchObject({
        id: 'tc-1',
        result_msg_id: toolMsg?.id,
      });
      expect(finalAsst.content).toBe('looking ');
    });

    it('skips tool_use that have already been persisted in the same turn', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const tool = {
        apiName: 'Bash',
        arguments: '{"cmd":"ls"}',
        id: 'tc-1',
        identifier: 'bash',
        type: 'default',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const toolMessages = [...h.messages.values()].filter((m) => m.role === 'tool');
      expect(toolMessages).toHaveLength(1);
    });
  });

  describe('step boundaries (stream_start newStep)', () => {
    it('flushes prior content, opens a new assistant chained off the last tool message', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const tool = {
        apiName: 'Bash',
        arguments: '{}',
        id: 'tc-1',
        identifier: 'bash',
        type: 'default',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'step1 ' }),
          buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('tool_result', 2, {
            content: 'ok',
            toolCallId: 'tc-1',
          }),
          buildEvent('stream_start', 3, { newStep: true }),
          buildEvent('stream_chunk', 4, { chunkType: 'text', content: 'step2' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // First step: asst-1 got content + tools
      // After step boundary: a NEW assistant created chained off the tool msg
      const newAssistants = [...h.messages.values()].filter(
        (m) => m.role === 'assistant' && m.id !== 'asst-1',
      );
      expect(newAssistants).toHaveLength(1);

      const toolMsg = [...h.messages.values()].find((m) => m.role === 'tool');
      expect(newAssistants[0].parentId).toBe(toolMsg?.id);
    });
  });

  describe('subagent threads', () => {
    it('lazy-creates the thread + user + first assistant on first subagent chunk', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const subagentCtx = {
        parentToolCallId: 'tc-spawn-1',
        spawnMetadata: {
          description: 'Explore CC stream chain',
          prompt: 'Investigate adapter logic',
          subagentType: 'Explore',
        },
        subagentMessageId: 'sub-msg-1',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'text',
            content: 'subagent thinking',
            subagent: subagentCtx,
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(h.threads.size).toBe(1);
      const thread = [...h.threads.values()][0];
      expect(thread.title).toBe('Explore CC stream chain');
      expect(thread.metadata?.sourceToolCallId).toBe('tc-spawn-1');
      expect(thread.metadata?.subagentType).toBe('Explore');
      expect(thread.sourceMessageId).toBe('asst-1');

      const threadMessages = [...h.messages.values()].filter((m) => m.threadId === thread.id);
      expect(threadMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(threadMessages[0].content).toBe('Investigate adapter logic');
      expect(threadMessages[1].parentId).toBe(threadMessages[0].id);
    });

    it('cuts a new in-thread assistant when subagentMessageId advances', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const ctxBase = {
        parentToolCallId: 'tc-spawn-1',
        spawnMetadata: { prompt: 'do work', subagentType: 'Worker' },
      };

      const tool = {
        apiName: 'Read',
        arguments: '{}',
        id: 'inner-tc-1',
        identifier: 'read',
        type: 'default',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'tools_calling',
            subagent: { ...ctxBase, subagentMessageId: 'sub-1' },
            toolsCalling: [tool],
          }),
          buildEvent('stream_chunk', 1, {
            chunkType: 'text',
            content: 'turn-2 thinking',
            subagent: { ...ctxBase, subagentMessageId: 'sub-2' },
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const threadId = [...h.threads.keys()][0];
      const threadAssts = [...h.messages.values()].filter(
        (m) => m.threadId === threadId && m.role === 'assistant',
      );
      // Initial assistant + new turn assistant after subagentMessageId change
      expect(threadAssts.length).toBeGreaterThanOrEqual(2);

      // Tool message exists in the thread
      const threadTool = [...h.messages.values()].find(
        (m) => m.threadId === threadId && m.role === 'tool',
      );
      expect(threadTool?.tool_call_id).toBe('inner-tc-1');
      expect(threadTool?.parentId).toBe(threadAssts[0].id);

      // Second-turn assistant chains off the tool message
      const secondTurn = threadAssts[1];
      expect(secondTurn.parentId).toBe(threadTool?.id);
    });

    it('finalizes the run with terminal assistant carrying tool_result content', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const subagentCtx = {
        parentToolCallId: 'tc-spawn-1',
        spawnMetadata: { prompt: 'p', subagentType: 'X' },
        subagentMessageId: 'sub-1',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'text',
            content: 'thinking',
            subagent: subagentCtx,
          }),
          buildEvent('tool_result', 1, {
            content: 'final summary from subagent',
            toolCallId: 'tc-spawn-1',
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const threadId = [...h.threads.keys()][0];
      const threadAssts = [...h.messages.values()].filter(
        (m) => m.threadId === threadId && m.role === 'assistant',
      );
      const terminal = threadAssts.at(-1);
      expect(terminal?.content).toBe('final summary from subagent');

      // Thread status updated
      const thread = h.threads.get(threadId)!;
      expect(thread.status).toBeDefined();
    });
  });

  describe('terminal events and finish()', () => {
    it('flushes accumulated content on agent_runtime_end', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'final answer' }),
          buildEvent('agent_runtime_end', 1, { reason: 'success' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.content).toBe('final answer');
    });

    it('writes error onto the assistant when terminal event is error', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'partial' }),
          buildEvent('error', 1, {
            message: 'CLI auth required',
            type: 'AuthRequired',
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.error).toBeDefined();
      expect(asst.error.message).toBe('CLI auth required');
      expect(asst.content).toBe('partial');
    });

    it('finish() drops the per-operation state so a retry starts fresh', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'a' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      await h.handler.finish({ operationId: 'op-1', result: 'success' });

      // Same operationId on a different topic should now succeed (state was dropped)
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-2',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-2',
            operationId: 'op-1',
          },
        },
      });
      h.messages.set('asst-2', {
        agentId: null,
        content: '',
        id: 'asst-2',
        role: 'assistant',
        topicId: 'topic-2',
      });

      await expect(
        h.handler.ingest({
          events: [buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'b' })],
          operationId: 'op-1',
          topicId: 'topic-2',
        }),
      ).resolves.not.toThrow();
    });
  });
});
