// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import type { FakeTopicMetadata } from './testUtils';
import { buildEvent, createHarness } from './testUtils';

describe('HeterogeneousPersistenceHandler', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
  });

  afterEach(() => {
    __resetOperationStatesForTesting();
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
    it('reports a late advanced batch as stale after its operation was removed', async () => {
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
      h.topicModel.findById.mockResolvedValue({ agentId: null, id: 'topic-1', metadata: {} });

      await expect(
        h.handler.ingest({
          events: [buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'late' })],
          operationId: 'op-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('Stale hetero operation op-1');
    });

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
