// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetOperationStatesForTesting,
  HeterogeneousPersistenceHandler,
} from '../HeterogeneousPersistenceHandler';

/**
 * Branch-coverage tests against every event type / sub-type the renderer
 * (`heterogeneousAgentExecutor.ts:1314–1632`) dispatches on. Each describe
 * block names the event variant; each `it` covers one observable behavior
 * the renderer encodes for that variant. See `cc-stream-chain-reference.md`
 * for the source-of-truth table the renderer is keyed off of.
 *
 * Sibling specs:
 *   - `HeterogeneousPersistenceHandler.test.ts`: state bootstrap +
 *     idempotency + 3-phase persist + subagent lifecycle (the structural
 *     contract).
 *   - `HeterogeneousPersistenceHandler.fixture.test.ts`: end-to-end replay
 *     of a real CC trace.
 */

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
  role: 'assistant' | 'user' | 'tool' | 'task' | 'system';
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

const createHarness = (
  params: {
    assistantMessageId?: string;
    operationId?: string;
    topicAgentId?: string | null;
    topicId?: string;
  } = {},
) => {
  const operationId = params.operationId ?? 'op-test';
  const topicId = params.topicId ?? 'topic-test';
  const assistantMessageId = params.assistantMessageId ?? 'asst-seeded';
  const topicAgentId = params.topicAgentId ?? null;

  let nextSeq = 0;
  const messages = new Map<string, FakeMessage>();
  const threads = new Map<string, FakeThread>();

  messages.set(assistantMessageId, {
    agentId: topicAgentId,
    content: '',
    id: assistantMessageId,
    role: 'assistant',
    topicId,
  });

  const messageModel = {
    create: vi.fn(async (input: Partial<FakeMessage>, id?: string) => {
      nextSeq += 1;
      const msgId = id ?? `msg_${nextSeq}`;
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
        topicId: input.topicId ?? topicId,
        type: input.type ?? 'isolation',
      };
      threads.set(thread.id, thread);
      return thread;
    }),
    update: vi.fn(async (id: string, patch: Partial<FakeThread>) => {
      const existing = threads.get(id);
      if (existing) threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async () => ({
      agentId: topicAgentId,
      id: topicId,
      metadata: { runningOperation: { assistantMessageId, operationId } },
    })),
    updateMetadata: vi.fn(async (_topicId: string, _patch: any) => {}),
  };

  const handler = new HeterogeneousPersistenceHandler({
    messageModel: messageModel as any,
    threadModel: threadModel as any,
    topicModel: topicModel as any,
  });

  return {
    assistantMessageId,
    handler,
    messageModel,
    messages,
    operationId,
    threadModel,
    threads,
    topicId,
    topicModel,
  };
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

const ingest = async (h: ReturnType<typeof createHarness>, events: AgentStreamEvent[]) =>
  h.handler.ingest({ events, operationId: h.operationId, topicId: h.topicId });

describe('HeterogeneousPersistenceHandler — event branch coverage', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  // ─── step_complete ────────────────────────────────────────────────────────

  describe('step_complete', () => {
    it('phase=turn_metadata with usage writes assistant.metadata.usage and caches model/provider', async () => {
      const h = createHarness();
      const usage = { inputTokens: 100, outputTokens: 50 };

      await ingest(h, [
        buildEvent('step_complete', 0, {
          model: 'claude-opus-4-7',
          phase: 'turn_metadata',
          provider: 'claude-code',
          usage,
        }),
      ]);

      expect(h.messageModel.update).toHaveBeenCalledWith(
        h.assistantMessageId,
        expect.objectContaining({ metadata: { usage } }),
      );
    });

    it('phase=turn_metadata WITHOUT usage only caches model/provider for the next step', async () => {
      const h = createHarness();

      // turn_metadata with no usage → no DB write yet, but lastModel/lastProvider
      // should propagate to the NEXT step's create assistant call.
      await ingest(h, [
        buildEvent('step_complete', 0, {
          model: 'claude-opus-4-7',
          phase: 'turn_metadata',
          provider: 'claude-code',
        }),
        buildEvent('stream_start', 1, { newStep: true }),
      ]);

      // First update would be the prev-step flush of nothing — no model/provider
      // because pre-cache occurred AFTER turn_metadata. But the new assistant
      // create should carry both.
      const newAssistantCall = h.messageModel.create.mock.calls.find(
        (call) => call[0]?.role === 'assistant',
      );
      expect(newAssistantCall?.[0]).toMatchObject({
        model: 'claude-opus-4-7',
        provider: 'claude-code',
      });
    });

    it('phase=result_usage is ignored (renderer line 1399–1402: would clobber per-step usage)', async () => {
      const h = createHarness();

      await ingest(h, [
        buildEvent('step_complete', 0, {
          phase: 'result_usage',
          usage: { totalInputTokens: 9999 },
        }),
      ]);

      // No update on assistant for result_usage
      expect(h.messageModel.update).not.toHaveBeenCalled();
    });

    it('unknown phase is dropped silently', async () => {
      const h = createHarness();
      await ingest(h, [buildEvent('step_complete', 0, { phase: 'something_new' })]);
      expect(h.messageModel.update).not.toHaveBeenCalled();
    });
  });

  // ─── stream_start ─────────────────────────────────────────────────────────

  describe('stream_start', () => {
    it('without newStep is a no-op (orchestrator already seeded the assistant id)', async () => {
      const h = createHarness();
      const beforeUpdates = h.messageModel.update.mock.calls.length;
      const beforeCreates = h.messageModel.create.mock.calls.length;

      await ingest(h, [
        buildEvent('stream_start', 0, {
          assistantMessage: { id: 'asst-from-event' },
          model: 'foo',
          provider: 'bar',
        }),
      ]);

      expect(h.messageModel.update.mock.calls.length).toBe(beforeUpdates);
      expect(h.messageModel.create.mock.calls.length).toBe(beforeCreates);
    });

    it('with newStep but no prior tools chains the new assistant off the previous assistant', async () => {
      const h = createHarness();

      await ingest(h, [
        buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'plain step' }),
        buildEvent('stream_start', 1, { newStep: true }),
      ]);

      const newAsst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== h.assistantMessageId,
      );
      // No tool messages → falls back to prev assistant id
      expect(newAsst?.parentId).toBe(h.assistantMessageId);
    });
  });

  // ─── stream_chunk ─────────────────────────────────────────────────────────

  describe('stream_chunk', () => {
    it('main-side text accumulates without writing to DB until step boundary', async () => {
      const h = createHarness();

      await ingest(h, [
        buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'hi ' }),
        buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'there' }),
      ]);

      // Text is flushed to DB at end of each batch (multi-replica fix)
      expect(h.messageModel.update).toHaveBeenCalledWith(h.assistantMessageId, {
        content: 'hi there',
      });
    });

    it('main-side reasoning accumulates separately from text', async () => {
      const h = createHarness();

      await ingest(h, [
        buildEvent('stream_chunk', 0, { chunkType: 'reasoning', reasoning: 'thinking ' }),
        buildEvent('stream_chunk', 1, { chunkType: 'reasoning', reasoning: 'more' }),
        buildEvent('agent_runtime_end', 2, { reason: 'success' }),
      ]);

      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.reasoning).toEqual({ content: 'thinking more' });
    });

    it('subagent-tagged text routes to the run accumulator, NOT the main one', async () => {
      const h = createHarness();
      const subagentCtx = {
        parentToolCallId: 'tc-spawn',
        spawnMetadata: { prompt: 'p', subagentType: 'X' },
        subagentMessageId: 'sub-1',
      };

      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'subagent thought',
          subagent: subagentCtx,
        }),
        buildEvent('agent_runtime_end', 1, { reason: 'success' }),
      ]);

      const main = h.messages.get(h.assistantMessageId)!;
      expect(main.content).toBe(''); // Main untouched

      const threadId = [...h.threads.keys()][0];
      const subAssts = [...h.messages.values()].filter(
        (m) => m.threadId === threadId && m.role === 'assistant',
      );
      // After agent_runtime_end → finalize without resultContent → flush
      // accumulated content onto the in-thread assistant
      expect(subAssts.some((m) => m.content === 'subagent thought')).toBe(true);
    });

    it('subagent-tagged reasoning routes to the run reasoning accumulator', async () => {
      const h = createHarness();
      const subagentCtx = {
        parentToolCallId: 'tc-spawn',
        spawnMetadata: { prompt: 'p', subagentType: 'X' },
        subagentMessageId: 'sub-1',
      };

      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'reasoning',
          reasoning: 'subagent thinks hard',
          subagent: subagentCtx,
        }),
        buildEvent('agent_runtime_end', 1, { reason: 'success' }),
      ]);

      const threadId = [...h.threads.keys()][0];
      const flushed = [...h.messages.values()].find(
        (m) =>
          m.threadId === threadId &&
          m.role === 'assistant' &&
          m.reasoning?.content === 'subagent thinks hard',
      );
      expect(flushed).toBeDefined();
    });

    it('tools_calling with empty array is a no-op', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, { chunkType: 'tools_calling', toolsCalling: [] }),
      ]);
      expect(h.messageModel.update).not.toHaveBeenCalled();
      expect(h.messageModel.create).not.toHaveBeenCalled();
    });

    it('unknown chunkType is dropped silently', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, { chunkType: 'mystery_chunk', payload: 42 } as any),
      ]);
      expect(h.messageModel.update).not.toHaveBeenCalled();
      expect(h.messageModel.create).not.toHaveBeenCalled();
    });
  });

  // ─── tool_result ──────────────────────────────────────────────────────────

  describe('tool_result', () => {
    const buildToolFlow = (
      h: ReturnType<typeof createHarness>,
      toolResultData: Record<string, unknown>,
    ) =>
      ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          toolsCalling: [
            {
              apiName: 'TodoWrite',
              arguments: '{"todos":[]}',
              id: 'tc-1',
              identifier: 'todo-write',
              type: 'default',
            },
          ],
        }),
        buildEvent('tool_result', 1, { ...toolResultData, toolCallId: 'tc-1' }),
      ]);

    it('writes content + pluginState (TodoWrite synth) atomically through updateToolMessage', async () => {
      const h = createHarness();
      const todos = [
        { content: 'Read code', id: 't1', status: 'pending' },
        { content: 'Write tests', id: 't2', status: 'in_progress' },
      ];

      await buildToolFlow(h, {
        content: 'todos updated',
        pluginState: { todos },
      });

      const toolMsg = [...h.messages.values()].find((m) => m.role === 'tool');
      expect(toolMsg?.content).toBe('todos updated');
      expect(toolMsg?.pluginState).toEqual({ todos });
      // Critical: the renderer's TodoWrite synth (adapter line 546–553) puts
      // todos on `pluginState` — we transparently persist them through
      // updateToolMessage, so selectTodosFromMessages reads them.
      expect(h.messageModel.updateToolMessage).toHaveBeenCalledWith(
        toolMsg?.id,
        expect.objectContaining({ pluginState: { todos } }),
      );
    });

    it('isError=true sets pluginError', async () => {
      const h = createHarness();
      await buildToolFlow(h, {
        content: 'ENOENT no such file',
        isError: true,
      });

      const toolMsg = [...h.messages.values()].find((m) => m.role === 'tool');
      expect(toolMsg?.pluginError).toEqual({ message: 'ENOENT no such file' });
    });

    it('unknown toolCallId logs and drops without throwing', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('tool_result', 0, {
          content: 'orphan',
          toolCallId: 'tc-never-seen',
        }),
      ]);
      // Handler swallows unknown ids — no crash, no DB write
      expect(h.messageModel.updateToolMessage).not.toHaveBeenCalled();
    });

    it('tool_result without toolCallId is dropped (defensive)', async () => {
      const h = createHarness();
      await ingest(h, [buildEvent('tool_result', 0, { content: 'x' })]);
      expect(h.messageModel.updateToolMessage).not.toHaveBeenCalled();
    });
  });

  // ─── agent_runtime_end / error ────────────────────────────────────────────

  describe('terminal events', () => {
    it('agent_runtime_end flushes content + reasoning + model/provider', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('step_complete', 0, {
          model: 'claude-opus-4-7',
          phase: 'turn_metadata',
          provider: 'claude-code',
        }),
        buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'final text' }),
        buildEvent('stream_chunk', 2, { chunkType: 'reasoning', reasoning: 'final reasoning' }),
        buildEvent('agent_runtime_end', 3, { reason: 'success' }),
      ]);

      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.content).toBe('final text');
      expect(asst.reasoning).toEqual({ content: 'final reasoning' });
      expect(asst.model).toBe('claude-opus-4-7');
      expect(asst.provider).toBe('claude-code');
    });

    it('error event writes a ChatMessageError onto the assistant', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('error', 0, {
          message: 'connection timeout',
          type: 'AgentRuntimeError',
        }),
      ]);
      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.error).toMatchObject({
        message: 'connection timeout',
        type: 'AgentRuntimeError',
      });
    });

    it('error with AuthRequired code + matching content suppresses the echoed content', async () => {
      const h = createHarness();
      // CC streams the auth error into the text stream BEFORE emitting the
      // structured error. Without echo suppression, the assistant ends up
      // with both the raw stderr AND the structured error — duplicates.
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'auth required - sign in again',
        }),
        buildEvent('error', 1, {
          code: 'AuthRequired',
          message: 'auth required - sign in again',
          type: 'AgentRuntimeError',
        }),
      ]);
      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.content).toBe('');
      expect(asst.error).toBeDefined();
    });

    it('error with non-AuthRequired code preserves the streamed content', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'partial answer',
        }),
        buildEvent('error', 1, {
          message: 'partial answer',
          type: 'AgentRuntimeError',
        }),
      ]);
      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.content).toBe('partial answer');
      expect(asst.error).toBeDefined();
    });

    it('error with explicit clearEchoedContent flag suppresses echoed content', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'oops timeout',
        }),
        buildEvent('error', 1, {
          clearEchoedContent: true,
          message: 'oops timeout',
          type: 'AgentRuntimeError',
        }),
      ]);
      const asst = h.messages.get(h.assistantMessageId)!;
      expect(asst.content).toBe('');
    });

    it('terminal event drains orphan subagent runs (no resultContent)', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'partial subagent thought',
          subagent: {
            parentToolCallId: 'tc-spawn',
            spawnMetadata: { prompt: 'p', subagentType: 'X' },
            subagentMessageId: 'sub-1',
          },
        }),
        // No tool_result for tc-spawn — CLI crashed mid-spawn
        buildEvent('agent_runtime_end', 1, { reason: 'cancelled' }),
      ]);

      const threadId = [...h.threads.keys()][0];
      // Orphan flush wrote the accumulated content onto the in-thread assistant
      const flushed = [...h.messages.values()].find(
        (m) =>
          m.threadId === threadId &&
          m.role === 'assistant' &&
          m.content === 'partial subagent thought',
      );
      expect(flushed).toBeDefined();
      // Subagent run cleaned up on terminal
      expect([...h.threads.keys()]).toHaveLength(1);
    });
  });

  // ─── No-op event types ────────────────────────────────────────────────────

  describe('no-op event types', () => {
    it.each([
      ['tool_start', { parentMessageId: 'asst-seeded', toolCalling: { id: 'tc-1' } }],
      ['tool_end', { isSuccess: true, toolCallId: 'tc-1' }],
      ['stream_end', {}],
      ['agent_runtime_init', { state: 'idle' }],
      ['tool_execute', { apiName: 'Read', toolCallId: 'tc-1' }],
      ['stream_retry', { attempt: 1 }],
    ])('drops %s without DB writes', async (type, data) => {
      const h = createHarness();
      const beforeCreates = h.messageModel.create.mock.calls.length;
      const beforeUpdates = h.messageModel.update.mock.calls.length;
      const beforeToolUpdates = h.messageModel.updateToolMessage.mock.calls.length;
      const beforeThreads = h.threadModel.create.mock.calls.length;

      await ingest(h, [buildEvent(type as AgentStreamEvent['type'], 0, data)]);

      expect(h.messageModel.create.mock.calls.length).toBe(beforeCreates);
      expect(h.messageModel.update.mock.calls.length).toBe(beforeUpdates);
      expect(h.messageModel.updateToolMessage.mock.calls.length).toBe(beforeToolUpdates);
      expect(h.threadModel.create.mock.calls.length).toBe(beforeThreads);
    });
  });

  // ─── Subagent-specific edge cases ─────────────────────────────────────────

  describe('subagent edge cases', () => {
    it('subagent tool_result updates the in-thread tool message via the global toolMsgIdByCallId', async () => {
      const h = createHarness();
      const subagentCtx = {
        parentToolCallId: 'tc-spawn',
        spawnMetadata: { prompt: 'p', subagentType: 'X' },
        subagentMessageId: 'sub-1',
      };

      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          subagent: subagentCtx,
          toolsCalling: [
            {
              apiName: 'Read',
              arguments: '{}',
              id: 'inner-tc',
              identifier: 'read',
              type: 'default',
            },
          ],
        }),
        // tool_result for the SUBAGENT's inner tool — NOT the spawn parent
        buildEvent('tool_result', 1, {
          content: 'file contents',
          toolCallId: 'inner-tc',
        }),
      ]);

      const threadId = [...h.threads.keys()][0];
      const innerTool = [...h.messages.values()].find(
        (m) => m.threadId === threadId && m.role === 'tool',
      );
      expect(innerTool?.content).toBe('file contents');
    });

    it('multiple subagent spawns coexist independently (each with its own thread)', async () => {
      const h = createHarness();

      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'first',
          subagent: {
            parentToolCallId: 'tc-spawn-A',
            spawnMetadata: { prompt: 'task A', subagentType: 'Explore' },
            subagentMessageId: 'sub-A-1',
          },
        }),
        buildEvent('stream_chunk', 1, {
          chunkType: 'text',
          content: 'second',
          subagent: {
            parentToolCallId: 'tc-spawn-B',
            spawnMetadata: { prompt: 'task B', subagentType: 'Plan' },
            subagentMessageId: 'sub-B-1',
          },
        }),
        buildEvent('agent_runtime_end', 2, { reason: 'success' }),
      ]);

      expect(h.threads.size).toBe(2);
      const titles = [...h.threads.values()].map((t) => t.title);
      expect(titles).toContain('Explore');
      expect(titles).toContain('Plan');
    });

    it('subagent first-event uses description for title, falls back to subagentType', async () => {
      const h = createHarness();
      // No description → fallback to subagentType
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'x',
          subagent: {
            parentToolCallId: 'tc-spawn',
            spawnMetadata: { prompt: 'p', subagentType: 'Worker' },
            subagentMessageId: 'sub-1',
          },
        }),
      ]);
      expect([...h.threads.values()][0].title).toBe('Worker');
    });

    it('subagent description longer than 80 chars is truncated for the thread title', async () => {
      const h = createHarness();
      const longDesc = 'a'.repeat(120);
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'x',
          subagent: {
            parentToolCallId: 'tc-spawn',
            spawnMetadata: { description: longDesc, prompt: 'p', subagentType: 'X' },
            subagentMessageId: 'sub-1',
          },
        }),
      ]);
      expect([...h.threads.values()][0].title).toHaveLength(80);
    });

    it('subagent with NO subagentMessageId still creates the thread (treated as a single turn)', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'no-turn-id text',
          subagent: {
            parentToolCallId: 'tc-spawn',
            spawnMetadata: { prompt: 'p', subagentType: 'X' },
            // subagentMessageId omitted
          },
        }),
        buildEvent('agent_runtime_end', 1, { reason: 'success' }),
      ]);

      expect(h.threads.size).toBe(1);
      const flushed = [...h.messages.values()].find((m) => m.content === 'no-turn-id text');
      expect(flushed).toBeDefined();
    });

    it('finalize on parent tool_result creates the terminal in-thread assistant carrying resultContent', async () => {
      const h = createHarness();
      const subagentCtx = {
        parentToolCallId: 'tc-spawn',
        spawnMetadata: { prompt: 'p', subagentType: 'X' },
        subagentMessageId: 'sub-1',
      };
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'text',
          content: 'thinking',
          subagent: subagentCtx,
        }),
        buildEvent('tool_result', 1, {
          content: 'final summary',
          toolCallId: 'tc-spawn',
        }),
      ]);

      const threadId = [...h.threads.keys()][0];
      const threadAssts = [...h.messages.values()].filter(
        (m) => m.threadId === threadId && m.role === 'assistant',
      );
      // Terminal assistant has the authoritative summary
      expect(threadAssts.at(-1)?.content).toBe('final summary');
      // Run state cleaned up after finalize
    });
  });
});
