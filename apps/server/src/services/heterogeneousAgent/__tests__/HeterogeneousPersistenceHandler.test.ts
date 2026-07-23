// @vitest-environment node
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { ThreadStatus } from '@lobechat/types';
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

interface FakeTopicMetadata {
  heteroCurrentMsgId?: { msgId: string; operationId: string };
  runningOperation: {
    assistantMessageId: string;
    operationId: string;
  };
}

interface FakeTopic {
  agentId: string | null;
  id: string;
  metadata: FakeTopicMetadata;
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
    findById: vi.fn(async (id: string) => messages.get(id) ?? null),
    getLastMainThreadSpineMessageId: vi.fn(async (_topicId: string) => {
      // Mirror the SQL: most recent main-agent (threadId null) message that is
      // NOT a tool and NOT a signal-tagged callback. Insertion order == creation.
      const match = [...messages.values()].findLast(
        (m) => m.role !== 'tool' && !m.threadId && !(m as any).metadata?.signal,
      );
      return match?.id;
    }),
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
    findById: vi.fn(async (id: string) => threads.get(id) ?? null),
    update: vi.fn(async (id: string, patch: Partial<FakeThread>) => {
      const existing = threads.get(id);
      if (!existing) return;
      threads.set(id, { ...existing, ...patch });
    }),
  };

  const topicModel = {
    findById: vi.fn(async (id: string): Promise<FakeTopic | null> => {
      if (id !== params.topicId) return null;
      return {
        agentId: params.topicAgentId ?? null,
        id,
        metadata: {
          runningOperation: {
            assistantMessageId: params.assistantMessageId,
            operationId: params.operationId,
          },
        } satisfies FakeTopicMetadata,
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
        usage: { totalInputTokens: 1, totalOutputTokens: 0, totalTokens: 1 },
      });
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

  describe('step boundaries (stream_start newStep)', () => {
    it('flushes prior content, opens a new assistant chained off the prior assistant (spine)', async () => {
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

      // First step: asst-1 got content + tools.
      // After step boundary (phase 2 spine rule): a NEW assistant is created
      // chained off the prior assistant (asst-1), with the tool as an inline
      // child — the read side reconstructs the zigzag.
      const newAssistants = [...h.messages.values()].filter(
        (m) => m.role === 'assistant' && m.id !== 'asst-1',
      );
      expect(newAssistants).toHaveLength(1);
      expect(newAssistants[0].parentId).toBe('asst-1');
    });

    it('chains off the prior assistant (spine) across a multi-replica boundary, recovered from DB', async () => {
      // Phase 2: the chain parent is the run's latest non-tool / non-signal
      // main message, recovered from the DB (`getLastMainThreadSpineMessageId`)
      // independent of the in-memory current-assistant pointer. So even when the
      // prior step's tools_calling drained on a DIFFERENT replica (this replica's
      // toolState stays empty), step 2 still chains off step 1's assistant — a
      // linear spine, not a fork.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Track topic.metadata so updateMetadata({heteroCurrentMsgId}) becomes
      // observable to subsequent findById calls — the default harness mock is
      // a no-op which would mask the bug behind a sync-rollback artifact.
      const metaState: FakeTopicMetadata = {
        runningOperation: { assistantMessageId: 'asst-init', operationId: 'op-1' },
      };
      h.topicModel.findById.mockImplementation(async (id: string) => {
        if (id !== 'topic-1') return null;
        return { agentId: null, id, metadata: { ...metaState } };
      });
      h.topicModel.updateMetadata.mockImplementation(async (_id: string, patch: any) => {
        Object.assign(metaState, patch);
      });

      // ── Batch 1: this replica drains step 1's stream_start ──
      // No tools yet on this asst → handleStepStart chains step 1 off
      // 'asst-init' (correct, since asst-init had no tools).
      await h.handler.ingest({
        events: [buildEvent('stream_start', 1, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const step1Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      )!;
      expect(step1Asst).toBeDefined();
      expect(step1Asst.parentId).toBe('asst-init');

      // ── Simulate "another replica drained step 1's tools_calling + result" ──
      // The other replica would have:
      //   1. Created a tool message
      //   2. Rewritten step1Asst.tools[] with result_msg_id pointing at it
      // Both writes hit DB. THIS replica's in-memory state.toolState stays []
      // (reset by handleStepStart) and has no idea this happened.
      h.messages.set('tool-other-replica', {
        agentId: null,
        content: 'result body',
        id: 'tool-other-replica',
        parentId: step1Asst.id,
        role: 'tool',
        tool_call_id: 'tc-1',
        topicId: 'topic-1',
      });
      h.messages.set(step1Asst.id, {
        ...h.messages.get(step1Asst.id)!,
        model: 'claude-sonnet-4-6',
        provider: 'claude-code',
        tools: [
          {
            apiName: 'Bash',
            arguments: '{}',
            id: 'tc-1',
            identifier: 'bash',
            result_msg_id: 'tool-other-replica',
            type: 'default',
          },
        ],
      });

      // ── Batch 2: step 2 stream_start lands back on THIS replica ──
      // The DB spine query returns step1Asst (the latest non-tool main message),
      // so step 2 chains off it regardless of this replica's empty toolState.
      await h.handler.ingest({
        events: [buildEvent('stream_start', 2, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const step2Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init' && m.id !== step1Asst.id,
      );
      expect(step2Asst).toBeDefined();
      expect(step2Asst!.parentId).toBe(step1Asst.id);
      // And the new assistant should inherit model/provider that the other
      // replica wrote — refresh also restores lastModel/lastProvider so we
      // no longer create assistants with model=null/provider=null on the
      // replica that didn't drain step_complete.
      expect(step2Asst!.model).toBe('claude-sonnet-4-6');
      expect(step2Asst!.provider).toBe('claude-code');
    });

    it('chains off the spine regardless of the prior step tool backfill state', async () => {
      // Phase 2: the chain anchors to the spine (latest non-tool main message),
      // so the prior step's tool-row / result_msg_id backfill timing — which
      // used to matter for the tool anchor — no longer affects the chain. Even
      // with a tool row present but no tools[] backfill, step 2 chains off the
      // prior assistant.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const metaState: FakeTopicMetadata = {
        runningOperation: { assistantMessageId: 'asst-init', operationId: 'op-1' },
      };
      h.topicModel.findById.mockImplementation(async (id: string) => {
        if (id !== 'topic-1') return null;
        return { agentId: null, id, metadata: { ...metaState } };
      });
      h.topicModel.updateMetadata.mockImplementation(async (_id: string, patch: any) => {
        Object.assign(metaState, patch);
      });

      // ── Batch 1: this replica drains step 1's stream_start (no tools yet) ──
      await h.handler.ingest({
        events: [buildEvent('stream_start', 1, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      const step1Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      )!;

      // ── Other replica created the tool ROW but NOT the tools[] backfill ──
      // Note: step1Asst.tools[] is intentionally left WITHOUT result_msg_id,
      // so the ingest refresh cannot recover the anchor.
      h.messages.set('tool-row-only', {
        agentId: null,
        content: 'result body',
        id: 'tool-row-only',
        parentId: step1Asst.id,
        role: 'tool',
        threadId: null,
        tool_call_id: 'tc-1',
        topicId: 'topic-1',
      });

      // ── Batch 2: step 2 stream_start lands on THIS (empty-state) replica ──
      await h.handler.ingest({
        events: [buildEvent('stream_start', 2, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const step2Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init' && m.id !== step1Asst.id,
      );
      expect(step2Asst).toBeDefined();
      // Chains off the prior assistant (spine) → wire stays linear; the tool is inline.
      expect(step2Asst!.parentId).toBe(step1Asst.id);
    });

    it('chains off the spine when parallel tools are only partially backfilled', async () => {
      // Regression for main-chain breaks with parallel/multi tool calls:
      // tool A is visible in assistant.tools[].result_msg_id, while tool B's
      // row exists but Phase 3 has not backfilled assistant.tools[] yet. The
      // step anchor must be tool B, not the earlier resolved tool A.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const metaState: FakeTopicMetadata = {
        runningOperation: { assistantMessageId: 'asst-init', operationId: 'op-1' },
      };
      h.topicModel.findById.mockImplementation(async (id: string) => {
        if (id !== 'topic-1') return null;
        return { agentId: null, id, metadata: { ...metaState } };
      });
      h.topicModel.updateMetadata.mockImplementation(async (_id: string, patch: any) => {
        Object.assign(metaState, patch);
      });

      await h.handler.ingest({
        events: [buildEvent('stream_start', 1, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      const step1Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      )!;

      h.messages.set('tool-a-backfilled', {
        agentId: null,
        content: 'tool A result',
        id: 'tool-a-backfilled',
        parentId: step1Asst.id,
        role: 'tool',
        threadId: null,
        tool_call_id: 'tc-a',
        topicId: 'topic-1',
      });
      h.messages.set('tool-b-row-only', {
        agentId: null,
        content: 'tool B result',
        id: 'tool-b-row-only',
        parentId: step1Asst.id,
        role: 'tool',
        threadId: null,
        tool_call_id: 'tc-b',
        topicId: 'topic-1',
      });
      h.messages.set(step1Asst.id, {
        ...h.messages.get(step1Asst.id)!,
        tools: [
          {
            apiName: 'Read',
            arguments: '{}',
            id: 'tc-a',
            identifier: 'read',
            result_msg_id: 'tool-a-backfilled',
            type: 'default',
          },
          {
            apiName: 'Bash',
            arguments: '{}',
            id: 'tc-b',
            identifier: 'bash',
            type: 'default',
          },
        ],
      });

      await h.handler.ingest({
        events: [buildEvent('stream_start', 2, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const step2Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init' && m.id !== step1Asst.id,
      );
      expect(step2Asst).toBeDefined();
      // Spine-anchored: parallel-tool backfill state is irrelevant to the chain.
      expect(step2Asst!.parentId).toBe(step1Asst.id);
    });

    it('ignores subagent tool rows (threadId set) when resolving the step anchor', async () => {
      // A subagent tool row lives on its own thread and must never anchor the
      // main-agent wire. If the only `role:'tool'` child carries a threadId,
      // the fallback must skip it and chain off the previous assistant.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const metaState: FakeTopicMetadata = {
        runningOperation: { assistantMessageId: 'asst-init', operationId: 'op-1' },
      };
      h.topicModel.findById.mockImplementation(async (id: string) => {
        if (id !== 'topic-1') return null;
        return { agentId: null, id, metadata: { ...metaState } };
      });
      h.topicModel.updateMetadata.mockImplementation(async (_id: string, patch: any) => {
        Object.assign(metaState, patch);
      });

      await h.handler.ingest({
        events: [buildEvent('stream_start', 1, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });
      const step1Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      )!;

      h.messages.set('subagent-tool', {
        agentId: null,
        content: 'sub result',
        id: 'subagent-tool',
        parentId: step1Asst.id,
        role: 'tool',
        threadId: 'thread-sub',
        tool_call_id: 'tc-sub',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [buildEvent('stream_start', 2, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const step2Asst = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init' && m.id !== step1Asst.id,
      );
      expect(step2Asst).toBeDefined();
      expect(step2Asst!.parentId).toBe(step1Asst.id);
    });

    it('handleTurnMetadata persists model/provider to DB so other replicas can recover lastModel/lastProvider', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('step_complete', 0, {
            model: 'claude-sonnet-4-6',
            phase: 'turn_metadata',
            provider: 'claude-code',
            usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Was previously `{ metadata: { usage } }` only — now extended to also
      // carry model/provider so a replica picking up the next step boundary
      // can read them back from DB even if it never drained this event.
      expect(h.messageModel.update).toHaveBeenCalledWith('asst-init', {
        metadata: { usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 } },
        model: 'claude-sonnet-4-6',
        provider: 'claude-code',
      });
    });

    it('retry recovers an unresolved tool that another replica only Phase-1 registered (no false-positive persistedIds)', async () => {
      // Race: another replica wrote `assistant.tools[]` (Phase 1) but its
      // Phase 2 — creating the `role:'tool'` row + backfilling
      // `result_msg_id` — hasn't landed yet (or threw). The BatchIngester
      // then retries the SAME tools_calling event onto THIS replica.
      //
      // If `persistedIds` includes the unresolved id, `persistToolBatch`
      // filters it out of `freshForCreate`, skips the create, and rewrites
      // `tools[]` unchanged → the tool is orphaned (never gets a tool
      // message, never gets `result_msg_id`). Fix: only mark ids whose
      // `result_msg_id` is filled in as persisted.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Pre-populate the initial assistant with a Phase-1-only tool entry
      // (no `result_msg_id`), simulating the other replica's mid-flight write.
      h.messages.set('asst-init', {
        ...h.messages.get('asst-init')!,
        tools: [
          {
            apiName: 'Bash',
            arguments: '{"cmd":"ls"}',
            id: 'tc-unresolved',
            identifier: 'bash',
            type: 'default',
            // NOTE: no result_msg_id — Phase 2 has not run yet.
          },
        ],
      });

      // Retry of the same tools_calling event lands on this replica.
      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'tools_calling',
            toolsCalling: [
              {
                apiName: 'Bash',
                arguments: '{"cmd":"ls"}',
                id: 'tc-unresolved',
                identifier: 'bash',
                type: 'default',
              },
            ],
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // The tool message must have been created (Phase 2 completed via retry)
      // and assistant.tools[0].result_msg_id must point at it.
      const toolMsgs = [...h.messages.values()].filter((m) => m.role === 'tool');
      expect(toolMsgs).toHaveLength(1);
      expect(toolMsgs[0].tool_call_id).toBe('tc-unresolved');

      const asst = h.messages.get('asst-init')!;
      expect(asst.tools).toHaveLength(1);
      expect(asst.tools![0].result_msg_id).toBe(toolMsgs[0].id);
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

      // Second-turn assistant chains off the prior in-thread assistant (spine),
      // with the tool as an inline child (phase 2 rule).
      const secondTurn = threadAssts[1];
      expect(secondTurn.parentId).toBe(threadAssts[0].id);
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

    it('writes subagent usage + model onto the in-thread assistant, and finalize only flips status', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const subagentCtx = {
        parentToolCallId: 'tc-spawn-1',
        spawnMetadata: { prompt: 'p', subagentType: 'Explore' },
        subagentMessageId: 'sub-1',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, {
            chunkType: 'text',
            content: 'working',
            subagent: subagentCtx,
          }),
          buildEvent('stream_chunk', 1, {
            chunkType: 'tools_calling',
            subagent: subagentCtx,
            toolsCalling: [
              {
                apiName: 'Bash',
                arguments: '{}',
                id: 'tc-child',
                identifier: 'bash',
                type: 'default',
              },
            ],
          }),
          // Subagent turn_metadata carries the authoritative per-turn usage + model.
          buildEvent('step_complete', 2, {
            model: 'claude-opus-4-8',
            phase: 'turn_metadata',
            provider: 'claude-code',
            subagent: subagentCtx,
            usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
          }),
          buildEvent('tool_result', 3, { content: 'final', toolCallId: 'tc-spawn-1' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const threadId = [...h.threads.keys()][0];
      const thread = h.threads.get(threadId)!;
      // Metrics are NOT denormalized onto metadata — derived on read instead.
      expect(thread.metadata?.totalTokens).toBeUndefined();
      expect(thread.metadata?.totalToolCalls).toBeUndefined();
      // Create-time peer fields untouched; finalize only flips status.
      expect(thread.metadata?.sourceToolCallId).toBe('tc-spawn-1');
      expect(thread.metadata?.subagentType).toBe('Explore');
      expect(thread.status).toBe(ThreadStatus.Active);

      // The in-thread assistant got usage + model written — the rows the
      // read-time aggregation later sums over.
      const threadAssts = [...h.messages.values()].filter(
        (m) => m.threadId === threadId && m.role === 'assistant',
      );
      const withUsage = threadAssts.find((m) => m.metadata?.usage?.totalTokens === 15);
      expect(withUsage?.model).toBe('claude-opus-4-8');
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

  describe('cold replica state restoration (Vercel serverless)', () => {
    it('restores accumulatedContent from DB so a cold instance does not truncate previous text', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Batch 1 (warm instance): stream two text chunks, flush happens via flushBatchContent
      await h.handler.ingest({
        events: [
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'hello ' }, 1000),
          buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'world' }, 1001),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // DB should have the partial content written by flushBatchContent
      expect(h.messages.get('asst-1')?.content).toBe('hello world');

      // Simulate cold replica: drop the in-memory operation state
      __resetOperationStatesForTesting();

      // Batch 2 (cold instance): receives more text.
      // Without restoration the new instance would start with accumulatedContent='' and
      // write only " more" — truncating "hello world".
      await h.handler.ingest({
        events: [buildEvent('agent_runtime_end', 0, { reason: 'success' }, 2000)],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // The terminal flush should preserve the previously accumulated content.
      expect(h.messages.get('asst-1')?.content).toBe('hello world');
    });

    it('restores toolState.payloads and persistedIds so cold replica does not duplicate tools or overwrite tools[]', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // Batch 1 (warm): persist tool1
      const tool1: any = {
        apiName: 'tool1',
        arguments: '{}',
        id: 'tc-1',
        identifier: 'tool1',
        type: 'default',
      };
      await h.handler.ingest({
        events: [
          buildEvent(
            'stream_chunk',
            0,
            { chunkType: 'tools_calling', toolsCalling: [tool1] },
            1000,
          ),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // assistant.tools[] should have tool1
      const asstAfterBatch1 = h.messages.get('asst-1')!;
      expect(asstAfterBatch1.tools).toHaveLength(1);
      expect(asstAfterBatch1.tools![0].id).toBe('tc-1');
      // tool message created for tool1
      const toolMsgsBatch1 = [...h.messages.values()].filter((m) => m.role === 'tool');
      expect(toolMsgsBatch1).toHaveLength(1);

      // Simulate cold replica: drop in-memory state
      __resetOperationStatesForTesting();

      // Batch 2 (cold): receives tool2 — should ADD to tools[], not overwrite
      const tool2: any = {
        apiName: 'tool2',
        arguments: '{}',
        id: 'tc-2',
        identifier: 'tool2',
        type: 'default',
      };
      await h.handler.ingest({
        events: [
          buildEvent(
            'stream_chunk',
            1,
            { chunkType: 'tools_calling', toolsCalling: [tool2] },
            2000,
          ),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const asstAfterBatch2 = h.messages.get('asst-1')!;
      // Both tools should be present — cold restore kept tool1 in payloads
      expect(asstAfterBatch2.tools).toHaveLength(2);

      // tool1 should NOT be duplicated — persistedIds was restored
      const allToolMsgs = [...h.messages.values()].filter((m) => m.role === 'tool');
      const tool1Msgs = allToolMsgs.filter((m) => m.tool_call_id === 'tc-1');
      expect(tool1Msgs).toHaveLength(1);
    });
  });

  describe('warm replica step resync', () => {
    it('switches to the DB-persisted step assistant when a later-step batch lands on a stale warm replica', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-1',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'step1' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      h.messages.set('asst-2', {
        agentId: null,
        content: '',
        id: 'asst-2',
        parentId: 'asst-1',
        role: 'assistant',
        topicId: 'topic-1',
      });

      h.topicModel.findById.mockResolvedValue({
        agentId: null,
        id: 'topic-1',
        metadata: {
          heteroCurrentMsgId: { msgId: 'asst-2', operationId: 'op-1' },
          runningOperation: {
            assistantMessageId: 'asst-1',
            operationId: 'op-1',
          },
        } satisfies FakeTopicMetadata,
      });

      await h.handler.ingest({
        events: [buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'step2' })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      expect(h.messages.get('asst-1')?.content).toBe('step1');
      expect(h.messages.get('asst-2')?.content).toBe('step2');
    });
  });

  describe('per-message session provenance (heteroSessionId / heteroMessageId)', () => {
    it('stamps the CC session id + turn message id on the assistant, its tools, and its usage', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-init',
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
          // system.init: carries the CC session id but opens no new assistant.
          buildEvent('stream_start', 0, { sessionId: 'sess-A' }),
          // A real turn boundary: opens a new assistant for CC message cc-1.
          buildEvent('stream_start', 1, {
            messageId: 'cc-1',
            newStep: true,
            sessionId: 'sess-A',
          }),
          buildEvent('stream_chunk', 2, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('step_complete', 3, {
            phase: 'turn_metadata',
            usage: { totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 2 },
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const assistant = [...h.messages.values()].find(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      )!;
      expect(assistant.metadata).toMatchObject({
        heteroMessageId: 'cc-1',
        heteroSessionId: 'sess-A',
      });

      const toolRow = [...h.messages.values()].find((m) => m.role === 'tool')!;
      expect(toolRow.metadata).toMatchObject({
        heteroMessageId: 'cc-1',
        heteroSessionId: 'sess-A',
      });

      // recordUsage overwrites the row's metadata wholesale — provenance must survive.
      const usageWrite = h.messageModel.update.mock.calls.find(
        ([, patch]: [string, any]) => patch?.metadata?.usage,
      )!;
      expect(usageWrite[1].metadata).toMatchObject({
        heteroMessageId: 'cc-1',
        heteroSessionId: 'sess-A',
        usage: { totalTokens: 2 },
      });
    });

    it('records a mid-topic session fork per-message so a diff pinpoints the break', async () => {
      // The tpc_PZAmvtpkfHE1 scenario: `--resume` failed, CC opened a fresh
      // session mid-conversation, and the topic-level single heteroSessionId
      // could not show WHERE the history was lost. Per-message stamping does.
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [
          buildEvent('stream_start', 0, { sessionId: 'sess-A' }),
          buildEvent('stream_start', 1, { messageId: 'cc-1', newStep: true, sessionId: 'sess-A' }),
          buildEvent('stream_chunk', 2, { chunkType: 'text', content: 'turn 1' }),
          // Next turn resumes into a DIFFERENT session — the fork.
          buildEvent('stream_start', 3, { messageId: 'cc-2', newStep: true, sessionId: 'sess-B' }),
          buildEvent('stream_chunk', 4, { chunkType: 'text', content: 'turn 2' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const newAssistants = [...h.messages.values()].filter(
        (m) => m.role === 'assistant' && m.id !== 'asst-init',
      );
      const sessById = new Map(
        newAssistants.map((m) => [m.metadata?.heteroMessageId, m.metadata?.heteroSessionId]),
      );
      expect(sessById.get('cc-1')).toBe('sess-A');
      expect(sessById.get('cc-2')).toBe('sess-B');
    });

    it('stamps heteroMessageId on the FIRST (seeded) turn, not just later newStep turns', async () => {
      // The first CC assistant follows system:init with NO newStep — it lands on
      // the pre-seeded assistant. The adapter now carries the turn's message.id on
      // that non-newStep stream_start so the seed assistant + its first-turn tool
      // and usage rows get heteroMessageId — the common first turn of a
      // resumed/forked operation this forensic data exists to diagnose.
      const h = createHarness({
        assistantMessageId: 'asst-init',
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
          // system:init carries the session id but opens no new assistant.
          buildEvent('stream_start', 0, { sessionId: 'sess-A' }),
          // First assistant after init: non-newStep stream_start carrying the
          // seed turn's CC message.id (what the adapter now emits).
          buildEvent('stream_start', 1, { messageId: 'cc-seed', sessionId: 'sess-A' }),
          buildEvent('stream_chunk', 2, { chunkType: 'tools_calling', toolsCalling: [tool] }),
          buildEvent('step_complete', 3, {
            phase: 'turn_metadata',
            usage: { totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 2 },
          }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      // The seeded assistant's usage write re-stamps the provenance.
      const seedUsageWrite = h.messageModel.update.mock.calls.find(
        ([id, patch]: [string, any]) => id === 'asst-init' && patch?.metadata?.usage,
      )!;
      expect(seedUsageWrite[1].metadata).toMatchObject({
        heteroMessageId: 'cc-seed',
        heteroSessionId: 'sess-A',
      });

      const toolRow = [...h.messages.values()].find((m) => m.role === 'tool')!;
      expect(toolRow.metadata).toMatchObject({
        heteroMessageId: 'cc-seed',
        heteroSessionId: 'sess-A',
      });
    });

    it('stamps the subagent turn message id on subagent tool + usage rows', async () => {
      const h = createHarness({
        assistantMessageId: 'asst-init',
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const subagentCtx = {
        parentToolCallId: 'tc-spawn',
        spawnMetadata: { prompt: 'p', subagentType: 'Explore' },
        subagentMessageId: 'sub-1',
      };

      await h.handler.ingest({
        events: [
          buildEvent('stream_start', 0, { sessionId: 'sess-A' }),
          buildEvent('stream_chunk', 1, {
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
          buildEvent('step_complete', 2, {
            phase: 'turn_metadata',
            subagent: subagentCtx,
            usage: { totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 2 },
          }),
          buildEvent('agent_runtime_end', 3, { reason: 'success' }),
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const threadId = [...h.threads.keys()][0];

      // The subagent's inner tool row carries the subagent turn's message id.
      const innerTool = [...h.messages.values()].find(
        (m) => m.threadId === threadId && m.role === 'tool',
      )!;
      expect(innerTool.metadata).toMatchObject({
        heteroMessageId: 'sub-1',
        heteroSessionId: 'sess-A',
      });

      // recordUsage overwrites the subagent assistant's metadata wholesale — the
      // heteroMessageId createMessage stamped must survive it.
      const subUsageWrite = h.messageModel.update.mock.calls.find(
        ([, patch]: [string, any]) => patch?.metadata?.usage,
      )!;
      expect(subUsageWrite[1].metadata).toMatchObject({
        heteroMessageId: 'sub-1',
        heteroSessionId: 'sess-A',
        usage: { totalTokens: 2 },
      });
    });
  });
});
