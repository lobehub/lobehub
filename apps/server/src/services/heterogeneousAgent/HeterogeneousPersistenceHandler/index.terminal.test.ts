// @vitest-environment node
import { createAdapter } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

describe('HeterogeneousPersistenceHandler', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
  });

  afterEach(() => {
    __resetOperationStatesForTesting();
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

    /**
     * @example A finish request on a stale replica preserves the final snapshot written elsewhere.
     */
    it('does not let a stale finish overwrite a newer assistant snapshot', async () => {
      // ROOT CAUSE:
      //
      // A warm serverless replica can retain an older per-operation accumulator
      // while another replica persists a newer text snapshot to the shared DB.
      // Before the fix, heteroFinish flushed the stale accumulator and replaced
      // the final answer with the preceding progress message.
      //
      // We fixed this by making heteroIngest the only content/reasoning writer;
      // a successful finish now releases operation state without rewriting text.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'text',
            content: 'progress',
            snapshotMode: 'replace',
            snapshotSeq: 4,
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Simulate a newer snapshot committed by another Lambda replica.
      h.messages.set('asst-1', {
        ...h.messages.get('asst-1')!,
        content: 'progress\n\nfinal answer',
        metadata: { heteroTextSnapshotSeq: 5 },
      });

      await h.handler.finish({
        operationId: 'op-1',
        result: 'success',
        topicId: 'topic-1',
      });

      expect(h.messages.get('asst-1')).toMatchObject({
        content: 'progress\n\nfinal answer',
        metadata: { heteroTextSnapshotSeq: 5 },
      });
    });

    it.each([false, true])(
      'does not persist a Codex reconnect on either side of a tool-created step (failed=%s)',
      async (failed) => {
        const h = createHarness({
          assistantMessageId: 'asst-1',
          operationId: 'op-1',
          topicId: 'topic-1',
        });
        const adapter = createAdapter('codex');
        const rawEvents = [
          { type: 'turn.started' },
          { message: 'Reconnecting... 2/5 (request timed out)', type: 'error' },
          {
            item: { id: 'progress', text: 'Inspecting the workflow.', type: 'agent_message' },
            type: 'item.completed',
          },
          {
            item: { command: 'printf inspected', id: 'inspect', type: 'command_execution' },
            type: 'item.started',
          },
          {
            item: {
              aggregated_output: 'inspected',
              command: 'printf inspected',
              exit_code: 0,
              id: 'inspect',
              status: 'completed',
              type: 'command_execution',
            },
            type: 'item.completed',
          },
          {
            item: {
              id: 'answer',
              text: 'Version checks do not publish releases.',
              type: 'agent_message',
            },
            type: 'item.completed',
          },
          failed
            ? { error: { message: 'stream closed before response.completed' }, type: 'turn.failed' }
            : { type: 'turn.completed' },
        ];
        // Keep ingest batches separated across the error/tool/newStep boundaries.
        // Mock only the database, not the adapter or persistence coordinator.
        let timestamp = 1_700_000_000_000;
        for (const raw of rawEvents) {
          const events = adapter.adapt(raw);
          if (events.length === 0) continue;
          await h.handler.ingest({
            events: events.map((event) =>
              buildEvent(event.type, event.stepIndex, event.data, timestamp++),
            ),
            operationId: 'op-1',
            topicId: 'topic-1',
          });
        }
        await h.handler.finish({
          error: failed
            ? { message: 'stream closed before response.completed', type: 'AgentRuntimeError' }
            : undefined,
          operationId: 'op-1',
          result: failed ? 'error' : 'success',
          topicId: 'topic-1',
        });

        const assistants = [...h.messages.values()].filter(
          (message) => message.role === 'assistant',
        );
        expect(assistants).toHaveLength(2);
        expect(assistants.map((message) => message.content)).toEqual([
          'Inspecting the workflow.',
          'Version checks do not publish releases.',
        ]);
        expect(assistants[0].error).toBeUndefined();
        expect(assistants.filter((message) => message.error)).toHaveLength(failed ? 1 : 0);
        if (failed) {
          expect(assistants[1].error.message).toBe('stream closed before response.completed');
        }
        expect([...h.messages.values()].find((message) => message.role === 'tool')).toMatchObject({
          content: 'inspected',
          parentId: 'asst-1',
        });
      },
    );

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

    it('finish() preserves a structured status-guide error body on the assistant', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Register op state without any in-stream error — the process-level
      // failure (spawn ENOENT) only arrives via the finish payload.
      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: '' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.finish({
        error: {
          body: {
            agentType: 'claude-code',
            code: 'cli_not_found',
            stderr: 'Error: spawn claude ENOENT',
          },
          message: 'Claude Code CLI was not found on the machine running this agent.',
          type: 'stream_error',
        },
        operationId: 'op-1',
        result: 'error',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.error).toBeDefined();
      // `body` must survive formatErrorForState untouched — the client's
      // status-guide UI gates on `body.agentType` + `body.code`.
      expect(asst.error.body).toMatchObject({
        agentType: 'claude-code',
        code: 'cli_not_found',
        stderr: 'Error: spawn claude ENOENT',
      });
      expect(asst.error.message).toContain('was not found');
    });

    it('finish() must not downgrade an in-stream status-guide error with a flat message', async () => {
      // Remote CC relays an API failure (529 overloaded / rate limit) as an
      // in-stream `error` event whose data the adapter already classified into
      // the structured status-guide shape (`agentType` + `code`). Older CLIs
      // then send a finish error flattened to a bare `{ message }` — writing
      // that over the persisted structured error would demote the client from
      // the dedicated guide card to the generic error alert.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const overloadedMessage = 'API Error: 529 Overloaded. This is a server-side issue.';
      await h.handler.ingest({
        events: [
          buildEvent('error', 0, {
            agentType: 'claude-code',
            code: 'overloaded',
            error: overloadedMessage,
            message: overloadedMessage,
            stderr: overloadedMessage,
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.finish({
        error: { message: overloadedMessage, type: 'AgentRuntimeError' },
        operationId: 'op-1',
        result: 'error',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.error.body).toMatchObject({
        agentType: 'claude-code',
        code: 'overloaded',
      });
    });

    it('finish() with NO prior ingest bootstraps state and writes the error (spawn-fail path)', async () => {
      // The real process-level failure shape: spawn ENOENT produces ZERO
      // stream events, so no ingest ever created an OperationState. finish()
      // must bootstrap from topic.metadata.runningOperation and write the
      // error itself — deferring it to CompletionLifecycle (which runs AFTER
      // the agent_runtime_end publish) races the client's message refetch.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.finish({
        error: {
          body: {
            agentType: 'claude-code',
            code: 'cli_not_found',
            stderr: 'Error: spawn claude ENOENT',
          },
          message: 'Claude Code CLI was not found on the machine running this agent.',
          type: 'AgentRuntimeError',
        },
        operationId: 'op-1',
        result: 'error',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.error).toBeDefined();
      expect(asst.error.body).toMatchObject({
        agentType: 'claude-code',
        code: 'cli_not_found',
      });
      expect(asst.error.message).toContain('was not found');
    });

    it('finish() projects the terminal error by assistant id after runningOperation was cleared', async () => {
      // Gateway session completion can clear runningOperation before the CLI's
      // heteroFinish request arrives. The producer-carried assistant id must
      // keep that race from leaving an empty assistant with error=null.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      // The CLI echoed the failure into the answer before reporting it — that
      // echo is what `clearEchoedContent` drops.
      h.messages.get('asst-1')!.content = "You've hit your session limit";
      h.topicModel.findById.mockResolvedValue({
        agentId: null,
        id: 'topic-1',
        metadata: {},
      });

      await h.handler.finish({
        assistantMessageId: 'asst-1',
        error: {
          body: {
            agentType: 'claude-code',
            clearEchoedContent: true,
            code: 'rate_limit',
            details: { kind: 'usage_limit' },
          },
          message: "You've hit your session limit",
          type: 'AgentRuntimeError',
        },
        operationId: 'op-1',
        result: 'error',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.error).toMatchObject({
        body: {
          agentType: 'claude-code',
          code: 'rate_limit',
        },
        message: "You've hit your session limit",
        type: 'AgentRuntimeError',
      });
      expect(asst.content).toBe('');
    });

    it('finish() keeps real work when a quota error only marks an echo', async () => {
      // Kimi Code can burn a full run and only then hit its weekly window. The
      // finish error carries clearEchoedContent (every rate_limit does), but
      // the streamed answer is not an echo of it and must survive.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.messages.get('asst-1')!.content = 'Refactored the adapter and ran the tests.';
      h.topicModel.findById.mockResolvedValue({
        agentId: null,
        id: 'topic-1',
        metadata: {},
      });

      await h.handler.finish({
        assistantMessageId: 'asst-1',
        error: {
          body: {
            agentType: 'kimi-code',
            clearEchoedContent: true,
            code: 'rate_limit',
            details: { kind: 'usage_limit' },
          },
          message: "You've reached your weekly (7-day) usage limit.",
          type: 'AgentRuntimeError',
        },
        operationId: 'op-1',
        result: 'error',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.content).toBe('Refactored the adapter and ran the tests.');
      expect(asst.error).toMatchObject({ body: { agentType: 'kimi-code', code: 'rate_limit' } });
    });

    it('finish() with no state stays a no-op for a stale operation (mismatched runningOperation)', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      // The topic's runningOperation belongs to a DIFFERENT operation — a late
      // finish from a superseded run must not touch the current turn.
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
        h.handler.finish({
          error: { message: 'boom', type: 'AgentRuntimeError' },
          operationId: 'op-1',
          result: 'error',
          topicId: 'topic-1',
        }),
      ).resolves.toBeUndefined();

      expect(h.messages.get('asst-1')!.error).toBeUndefined();
      expect(h.messageModel.update).not.toHaveBeenCalled();
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
      h.topicModel.findById.mockResolvedValue({
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
