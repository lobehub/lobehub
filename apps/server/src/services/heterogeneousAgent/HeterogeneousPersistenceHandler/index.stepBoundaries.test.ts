// @vitest-environment node
import { ThreadStatus } from '@lobechat/types';
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

  describe('step boundaries (stream_start newStep)', () => {
    it('recovers an isolation run from the thread spine instead of the projected topic reply', async () => {
      const h = createHarness({
        assistantMessageId: 'thread-asst-1',
        operationId: 'op-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      });
      h.messages.set('projected-topic-reply', {
        agentId: 'target-agent',
        content: 'projected answer',
        id: 'projected-topic-reply',
        role: 'assistant',
        threadId: null,
        topicId: 'topic-1',
      });

      await h.handler.ingest({
        events: [buildEvent('stream_start', 1, { newStep: true })],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const nextThreadAssistant = [...h.messages.values()].find(
        (message) =>
          message.role === 'assistant' &&
          message.threadId === 'thread-1' &&
          message.id !== 'thread-asst-1',
      );
      expect(nextThreadAssistant?.parentId).toBe('thread-asst-1');
    });

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
      // scoped message, recovered from the DB (`getLatestSpineMessageId`)
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
        metadata: {
          operationId: 'op-1',
          usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
        },
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
});
