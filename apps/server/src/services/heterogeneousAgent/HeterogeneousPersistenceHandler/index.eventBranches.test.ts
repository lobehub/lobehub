// @vitest-environment node
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

/**
 * Branch-coverage tests against every event type / sub-type the renderer
 * (`heterogeneousAgentExecutor.ts:1314–1632`) dispatches on. Each describe
 * block names the event variant; each `it` covers one observable behavior
 * the renderer encodes for that variant. See `cc-stream-chain-reference.md`
 * for the source-of-truth table the renderer is keyed off of.
 *
 * Sibling specs:
 *   - `index.test.ts`, `index.stepBoundaries.test.ts`, `index.terminal.test.ts`,
 *     `index.replicaState.test.ts`: state bootstrap + idempotency + 3-phase
 *     persist + subagent lifecycle (the structural contract).
 *   - `index.eventBranchesLifecycle.test.ts`, `index.interventionAck.test.ts`:
 *     the remaining event variants of this suite.
 *   - `index.fixture.test.ts`: end-to-end replay
 *     of a real CC trace.
 */

describe('HeterogeneousPersistenceHandler — event branch coverage', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    acknowledgeAgentInterventionProducerResolution.mockReset();
    notifyAgentInterventionRequired.mockReset();
  });
  afterEach(() => __resetOperationStatesForTesting());

  // ─── step_complete ────────────────────────────────────────────────────────

  describe('step_complete', () => {
    it('phase=turn_metadata with usage writes assistant.metadata.usage and caches model/provider', async () => {
      const h = createHarness();
      const usage = { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 };

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
        expect.objectContaining({ metadata: { operationId: h.operationId, usage } }),
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
    it('without newStep (CLI init) backfills the placeholder with the CLI model/provider', async () => {
      const h = createHarness();
      const beforeCreates = h.messageModel.create.mock.calls.length;

      await ingest(h, [
        buildEvent('stream_start', 0, {
          model: 'claude-sonnet-4-5',
          provider: 'claude-code',
        }),
      ]);

      // The init event carries the CLI's authoritative model/provider — it must
      // backfill the placeholder (which was created with only `provider`, no
      // model) so the model tag shows the real CLI model from the first turn,
      // even without any usage-bearing turn_metadata.
      const asst = h.messages.get(h.assistantMessageId);
      expect(asst?.model).toBe('claude-sonnet-4-5');
      expect(asst?.provider).toBe('claude-code');
      // No new assistant row is created — only the placeholder is patched.
      expect(h.messageModel.create.mock.calls.length).toBe(beforeCreates);
    });

    it('without newStep and no model/provider is a no-op', async () => {
      const h = createHarness();
      const beforeUpdates = h.messageModel.update.mock.calls.length;
      const beforeCreates = h.messageModel.create.mock.calls.length;

      await ingest(h, [buildEvent('stream_start', 0, {})]);

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
        metadata: { operationId: h.operationId },
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

    it('persists tool_state DB-first and drops stale in-operation snapshots', async () => {
      const h = createHarness();
      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tools_calling',
          toolsCalling: [
            {
              apiName: 'todo_list',
              arguments: '{}',
              id: 'todo-1',
              identifier: 'codex',
              type: 'default',
            },
          ],
        }),
        buildEvent('stream_chunk', 1, {
          chunkType: 'tool_state',
          pluginState: { todos: { items: [{ status: 'processing', text: 'Implement' }] } },
          snapshotMode: 'replace',
          snapshotSeq: 2,
          toolCallId: 'todo-1',
        }),
        buildEvent('stream_chunk', 2, {
          chunkType: 'tool_state',
          pluginState: { stale: true },
          snapshotMode: 'replace',
          snapshotSeq: 1,
          toolCallId: 'todo-1',
        }),
      ]);

      const stateWrites = h.messageModel.updateToolMessage.mock.calls.filter(
        ([, patch]) => patch.heterogeneousToolState,
      );
      expect(stateWrites).toHaveLength(1);
      expect(stateWrites[0][1]).toMatchObject({
        heterogeneousToolState: { operationId: h.operationId, snapshotSeq: 2 },
        pluginState: {
          todos: { items: [{ status: 'processing', text: 'Implement' }] },
        },
      });
      const toolMessage = [...h.messages.values()].find(
        (message) => message.tool_call_id === 'todo-1',
      );
      expect(toolMessage?.metadata).toMatchObject({
        heterogeneousToolStateOperationId: h.operationId,
        heterogeneousToolStateSeq: 2,
      });
      expect(toolMessage?.pluginState).not.toEqual({ stale: true });
    });

    it('restores the tool-state watermark from DB after a cold operation-state reset', async () => {
      const h = createHarness();
      h.messages.set('tool-existing', {
        agentId: null,
        content: '',
        id: 'tool-existing',
        metadata: {
          heterogeneousToolStateOperationId: h.operationId,
          heterogeneousToolStateSeq: 4,
        },
        pluginState: { current: true },
        role: 'tool',
        tool_call_id: 'todo-existing',
        topicId: h.topicId,
      });
      h.messageModel.listMessagePluginsByTopic.mockResolvedValue([
        {
          id: 'tool-existing',
          metadata: h.messages.get('tool-existing')?.metadata,
          toolCallId: 'todo-existing',
        },
      ] as any);

      await ingest(h, [
        buildEvent('stream_chunk', 0, {
          chunkType: 'tool_state',
          pluginState: { stale: true },
          snapshotMode: 'replace',
          snapshotSeq: 3,
          toolCallId: 'todo-existing',
        }),
      ]);

      expect(h.messageModel.updateToolMessage).not.toHaveBeenCalled();
      expect(h.messages.get('tool-existing')?.pluginState).toEqual({ current: true });
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
});
