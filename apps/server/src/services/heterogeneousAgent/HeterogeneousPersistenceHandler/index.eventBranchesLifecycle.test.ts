// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness, ingest } from './eventBranchesTestUtils';

const { acknowledgeAgentInterventionProducerResolution, notifyAgentInterventionRequired } =
  vi.hoisted(() => ({
    acknowledgeAgentInterventionProducerResolution: vi.fn(),
    notifyAgentInterventionRequired: vi.fn(),
  }));
vi.mock('@/business/server/agent-run/agentInterventionReview', () => ({
  acknowledgeAgentInterventionProducerResolution,
  notifyAgentInterventionRequired,
}));

describe('HeterogeneousPersistenceHandler — event branch coverage', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    acknowledgeAgentInterventionProducerResolution.mockReset();
    notifyAgentInterventionRequired.mockReset();
  });
  afterEach(() => __resetOperationStatesForTesting());

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
      // Completion callbacks must recover this run's reply, never an older topic reply.
      expect(asst.metadata).toMatchObject({ operationId: h.operationId });
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
      ['step_complete', { phase: 'operation_heartbeat' }],
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
