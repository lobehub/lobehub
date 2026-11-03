// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

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
      expect(h.messageModel.update).toHaveBeenCalledWith('asst-seeded', {
        content: 'hello world',
        metadata: { operationId: 'op-1' },
      });
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
      ).rejects.toThrow(/Stale hetero operation/);
    });

    it('rejects seeded assistant ids once runningOperation has been cleared', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: {} as any,
      });

      await expect(
        h.handler.ingest({
          assistantMessageId: 'asst-1',
          events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/no active runningOperation/);
    });

    it('keeps persisting when the marker is gone but the operation is still running', async () => {
      // The marker is a rendering pointer any client can settle — a transport
      // signal (a raw session_complete, or one multiplexed socket failing auth
      // for every operation on the tab) clears it while the CLI keeps
      // streaming. Refusing here discards the rest of a live run's output.
      const isOperationLiveOnTopic = vi.fn(async () => true);
      const h = createHarness({
        assistantMessageId: 'asst-1',
        isOperationLiveOnTopic,
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: {} as any,
      });

      await h.handler.ingest({
        assistantMessageId: 'asst-1',
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'kept' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(isOperationLiveOnTopic).toHaveBeenCalledWith('op-1', 'topic-1');
      expect(h.messageModel.update).toHaveBeenCalledWith('asst-1', {
        content: 'kept',
        metadata: { operationId: 'op-1' },
      });
    });

    it('recovers the assistant pointer from heteroCurrentMsgId when the marker is gone', async () => {
      // Desktop / old-CLI callers forward no assistantMessageId, so once the
      // marker is gone the operation-scoped `heteroCurrentMsgId` is the only
      // pointer left to the turn in flight.
      const h = createHarness({
        assistantMessageId: 'asst-1',
        isOperationLiveOnTopic: async () => true,
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: { heteroCurrentMsgId: { msgId: 'asst-1', operationId: 'op-1' } } as any,
      });

      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'kept' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(h.messageModel.update).toHaveBeenCalledWith('asst-1', {
        content: 'kept',
        metadata: { operationId: 'op-1' },
      });
    });

    it('still refuses a marker-less batch once the operation row is terminal', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        isOperationLiveOnTopic: async () => false,
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: {} as any,
      });

      await expect(
        h.handler.ingest({
          assistantMessageId: 'asst-1',
          events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/no active runningOperation/);
    });

    it('refuses a superseded batch even while its own operation row is alive', async () => {
      // Liveness must NOT override ownership: a marker naming another run means
      // the topic has moved on, and writing here would mutate a newer turn.
      const isOperationLiveOnTopic = vi.fn(async () => true);
      const h = createHarness({
        assistantMessageId: 'asst-1',
        isOperationLiveOnTopic,
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      h.topicModel.findById.mockResolvedValueOnce({
        agentId: null,
        id: 'topic-1',
        metadata: {
          runningOperation: { assistantMessageId: 'asst-other', operationId: 'op-OTHER' },
        },
      });

      await expect(
        h.handler.ingest({
          assistantMessageId: 'asst-1',
          events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/current operation is op-OTHER/);
      expect(isOperationLiveOnTopic).not.toHaveBeenCalled();
    });

    it('validates seeded assistant ids belong to the current topic', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      h.messages.set('asst-other-topic', {
        agentId: null,
        content: '',
        id: 'asst-other-topic',
        role: 'assistant',
        topicId: 'topic-2',
      });

      await expect(
        h.handler.ingest({
          assistantMessageId: 'asst-other-topic',
          events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/does not belong to topic topic-1/);
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
    it('replaces text with the latest full snapshot and ignores older snapshot seq values', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'text',
            content: 'hello world',
            snapshotMode: 'replace',
            snapshotSeq: 2,
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent(
            'stream_chunk',
            0,
            {
              chunkType: 'text',
              content: 'hello',
              snapshotMode: 'replace',
              snapshotSeq: 1,
            },
            1_700_000_000_999,
          ),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.content).toBe('hello world');
      expect(asst.metadata?.heteroTextSnapshotSeq).toBe(2);
    });

    it('replaces reasoning snapshots idempotently instead of re-appending on redelivery', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'reasoning',
            reasoning: 'thinking hard',
            snapshotMode: 'replace',
            snapshotSeq: 1,
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Redelivery reaching the reducer (a cold replica has an empty
      // processedKeys map — simulated here with a different timestamp so the
      // in-memory dedupe does not swallow the event first). A raw delta would
      // re-append and durably double the reasoning; the snapshot must not.
      await h.handler.ingest({
        events: [
          buildEvent(
            'stream_chunk',
            0,
            {
              chunkType: 'reasoning',
              reasoning: 'thinking hard',
              snapshotMode: 'replace',
              snapshotSeq: 1,
            },
            1_700_000_000_999,
          ),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const asst = h.messages.get('asst-1')!;
      expect(asst.reasoning?.content).toBe('thinking hard'); // NOT doubled
      expect(asst.metadata?.heteroReasoningSnapshotSeq).toBe(1);
    });

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

    it('gates publishing per operation and releases the gate when the operation finishes', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      const first = buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' });
      const second = buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'y' });

      // Without operation state (nothing ingested yet, or a cold replica):
      // treat everything as unpublished and latch nothing — degraded
      // republish-all rather than silently dropping events.
      expect(h.handler.filterUnpublishedEvents('op-1', [first, second])).toEqual([first, second]);
      h.handler.markEventPublished('op-1', first);
      expect(h.handler.filterUnpublishedEvents('op-1', [first, second])).toEqual([first, second]);

      await h.handler.ingest({ events: [first, second], operationId: 'op-1', topicId: 'topic-1' });

      // Latch per event: only unlatched events remain.
      h.handler.markEventPublished('op-1', first);
      expect(h.handler.filterUnpublishedEvents('op-1', [first, second])).toEqual([second]);
      h.handler.markEventPublished('op-1', second);
      expect(h.handler.filterUnpublishedEvents('op-1', [first, second])).toEqual([]);

      // finish() drops the per-operation state — the gate goes with it.
      await h.handler.finish({ operationId: 'op-1', result: 'success' });
      expect(h.handler.filterUnpublishedEvents('op-1', [first, second])).toEqual([first, second]);
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
        usage: { totalInputTokens: 1, totalOutputTokens: 0, totalTokens: 1 },
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
      expect(asst.metadata).toEqual({
        operationId: 'op-1',
        usage: { totalInputTokens: 1, totalOutputTokens: 0, totalTokens: 1 },
      });
    });
  });

  describe('3-phase tool persist (main agent)', () => {
    it('keeps tool rows and post-tool assistants attributed to the direct target agent', async () => {
      const h = createHarness({
        assistantAgentId: 'agent-direct-target',
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicAgentId: 'agent-conversation-owner',
        topicId: 'topic-1',
      });

      const tool = {
        apiName: 'Read',
        arguments: '{"file_path":"tool-proof.txt"}',
        id: 'tc-1',
        identifier: 'claude-code',
        type: 'default' as const,
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('tool_result', 1, {
            content: 'TOOL_CALL_MARKER',
            isError: false,
            toolCallId: 'tc-1',
          }),
          buildEvent('stream_start', 2, { newStep: true }),
          buildEvent('stream_chunk', 3, {
            chunkType: 'text',
            content: 'TOOL_CALL_MARKER',
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const toolMessage = [...h.messages.values()].find((message) => message.role === 'tool');
      const finalAssistant = [...h.messages.values()].find(
        (message) => message.role === 'assistant' && message.id !== 'asst-1',
      );

      expect(toolMessage?.agentId).toBe('agent-direct-target');
      expect(finalAssistant?.agentId).toBe('agent-direct-target');
      expect(finalAssistant?.parentId).toBe('asst-1');
      expect(finalAssistant?.content).toBe('TOOL_CALL_MARKER');
    });

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
      h.messageModel.create.mockImplementation(async (input: any, id?: string) => {
        order.push(input.role === 'tool' ? 'create-tool' : 'create-other');
        return origCreate(input, id);
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
});
