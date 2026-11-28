// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness, ingest } from './eventBranchesTestUtils';

vi.mock('@/business/server/agent-run/agentInterventionReview', () => ({
  acknowledgeAgentInterventionProducerResolution: vi.fn(),
  notifyAgentInterventionRequired: vi.fn(),
}));

type Harness = ReturnType<typeof createHarness>;

/** Fake `messages.updated_at` for rows this test writes "behind the handler's back". */
const updatedAt = new Map<string, number>();

const toIndexRow = (m: any) => ({
  ...m.plugin,
  id: m.id,
  metadata: m.metadata ?? {},
  state: m.pluginState,
  toolCallId: m.tool_call_id,
});

/** Back both index reads with the fake DB, like the real projection would. */
const backIndexWithMessages = (h: Harness) => {
  const toolRows = () => [...h.messages.values()].filter((m) => m.role === 'tool');
  h.messageModel.listToolCallIndexByTopic.mockImplementation(
    async () => toolRows().map(toIndexRow) as never[],
  );
  h.messageModel.listToolCallIndexByTopicSince.mockImplementation(
    async (_topicId: string, opts: any) =>
      toolRows()
        .filter(
          (m) =>
            (opts.ids ?? []).includes(m.id) || (updatedAt.get(m.id) ?? 0) >= opts.since.getTime(),
        )
        .map(toIndexRow) as never[],
  );
};

const QUESTION_ARGS = JSON.stringify({
  questions: [{ header: 'Scope', options: [{ label: 'Yes' }], question: 'Proceed?' }],
});

const questionRequest = (toolCallId: string) =>
  buildEvent('agent_intervention_request', 0, {
    apiName: 'askUserQuestion',
    arguments: QUESTION_ARGS,
    deadline: 1_900_000_000_000,
    identifier: 'claude-code',
    interactionKind: 'question',
    provider: 'claude-code',
    toolCallId,
  });

const toolsCalling = (id: string, stepIndex = 0) =>
  buildEvent('stream_chunk', stepIndex, {
    chunkType: 'tools_calling',
    toolsCalling: [{ apiName: 'Bash', arguments: '{}', id, identifier: 'claude-code' }],
  });

describe('HeterogeneousPersistenceHandler — incremental tool index sync', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    updatedAt.clear();
  });
  afterEach(() => __resetOperationStatesForTesting());

  it('skips the full topic index on a warm second batch from the same replica', async () => {
    const h = createHarness();
    backIndexWithMessages(h);

    await ingest(h, [toolsCalling('call-1')]);
    expect(h.messageModel.listToolCallIndexByTopic).toHaveBeenCalledTimes(1);
    expect(h.messages.get(h.assistantMessageId)?.metadata?.heteroIngestStamp).toEqual(
      expect.any(String),
    );

    h.messageModel.listToolCallIndexByTopic.mockClear();
    h.messageModel.listToolCallIndexByTopicSince.mockClear();
    h.messageModel.findById.mockClear();
    h.messageModel.findAssistantSnapshotById.mockClear();

    await ingest(h, [
      buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'running' }),
      buildEvent('tool_result', 0, { content: 'ok', toolCallId: 'call-1' }),
    ]);

    expect(h.messageModel.listToolCallIndexByTopic).not.toHaveBeenCalled();
    expect(h.messageModel.listToolCallIndexByTopicSince).toHaveBeenCalledTimes(1);
    // The current assistant is rehydrated through the narrow read, not findById.
    expect(h.messageModel.findAssistantSnapshotById).toHaveBeenCalledWith(h.assistantMessageId);
    expect(h.messageModel.findById).not.toHaveBeenCalled();
    const toolRow = [...h.messages.values()].find((m) => m.tool_call_id === 'call-1')!;
    expect(h.messageModel.updateToolMessage).toHaveBeenCalledWith(
      toolRow.id,
      expect.objectContaining({ content: 'ok' }),
    );
  });

  it('rebuilds the full index after another replica ingested in between', async () => {
    const h = createHarness();
    backIndexWithMessages(h);
    await ingest(h, [toolsCalling('call-1')]);

    // Replica B: persisted a tool and stamped the assistant with its own batch.
    h.messages.set('tool-from-b', {
      agentId: null,
      content: '',
      id: 'tool-from-b',
      parentId: h.assistantMessageId,
      plugin: { apiName: 'Bash', identifier: 'claude-code' },
      role: 'tool',
      tool_call_id: 'call-b',
      topicId: h.topicId,
    });
    const assistant = h.messages.get(h.assistantMessageId)!;
    assistant.metadata = { ...assistant.metadata, heteroIngestStamp: 'replica-b' };
    h.messageModel.listToolCallIndexByTopic.mockClear();
    h.messageModel.listToolCallIndexByTopicSince.mockClear();

    await ingest(h, [buildEvent('tool_result', 0, { content: 'from b', toolCallId: 'call-b' })]);

    expect(h.messageModel.listToolCallIndexByTopic).toHaveBeenCalledTimes(1);
    expect(h.messageModel.listToolCallIndexByTopicSince).not.toHaveBeenCalled();
    expect(h.messageModel.updateToolMessage).toHaveBeenCalledWith(
      'tool-from-b',
      expect.objectContaining({ content: 'from b' }),
    );
  });

  it('rebuilds the full index on a cold replica', async () => {
    const h = createHarness();
    backIndexWithMessages(h);
    await ingest(h, [toolsCalling('call-1')]);
    h.messageModel.listToolCallIndexByTopic.mockClear();

    __resetOperationStatesForTesting();
    await ingest(h, [buildEvent('tool_result', 0, { content: 'ok', toolCallId: 'call-1' })]);

    expect(h.messageModel.listToolCallIndexByTopic).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the full index when the topic turn pointer moved under this replica', async () => {
    const h = createHarness();
    backIndexWithMessages(h);
    await ingest(h, [toolsCalling('call-1')]);
    h.messageModel.listToolCallIndexByTopic.mockClear();

    h.topicModel.findById.mockResolvedValue({
      agentId: null,
      id: h.topicId,
      metadata: {
        heteroCurrentMsgId: { msgId: 'asst-elsewhere', operationId: h.operationId },
        runningOperation: { assistantMessageId: h.assistantMessageId, operationId: h.operationId },
      },
    } as any);
    await ingest(h, [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'x' })]);

    expect(h.messageModel.listToolCallIndexByTopic).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the full index on the retry of a failed batch', async () => {
    const h = createHarness();
    backIndexWithMessages(h);
    await ingest(h, [toolsCalling('call-1')]);
    h.messageModel.listToolCallIndexByTopic.mockClear();

    h.messageModel.updateToolMessage.mockRejectedValueOnce(new Error('transient'));
    const batch = [buildEvent('tool_result', 0, { content: 'ok', toolCallId: 'call-1' })];
    await expect(ingest(h, batch)).rejects.toThrow('transient');
    expect(h.messageModel.listToolCallIndexByTopic).not.toHaveBeenCalled();

    await ingest(h, batch);
    expect(h.messageModel.listToolCallIndexByTopic).toHaveBeenCalledTimes(1);
  });

  it('merges a tool row created since the last read without a full rebuild', async () => {
    const h = createHarness();
    backIndexWithMessages(h);
    await ingest(h, [toolsCalling('call-1')]);
    h.messageModel.listToolCallIndexByTopic.mockClear();

    // Written by a racing writer after this replica's last index read.
    h.messages.set('tool-racing', {
      agentId: null,
      content: '',
      id: 'tool-racing',
      parentId: h.assistantMessageId,
      plugin: { apiName: 'Bash', identifier: 'claude-code' },
      role: 'tool',
      tool_call_id: 'call-racing',
      topicId: h.topicId,
    });
    updatedAt.set('tool-racing', Date.now());

    await ingest(h, [
      buildEvent('tool_result', 0, { content: 'raced', toolCallId: 'call-racing' }),
    ]);

    expect(h.messageModel.listToolCallIndexByTopic).not.toHaveBeenCalled();
    expect(h.messageModel.updateToolMessage).toHaveBeenCalledWith(
      'tool-racing',
      expect.objectContaining({ content: 'raced' }),
    );
  });

  it('re-reads intervention rows by id so a plugin-only resolution is not overwritten', async () => {
    const h = createHarness({ userId: null });
    backIndexWithMessages(h);
    await ingest(h, [questionRequest('call-question')]);
    const question = [...h.messages.values()].find((m) => m.tool_call_id === 'call-question')!;
    expect(question.plugin?.intervention).toEqual({ status: 'pending' });

    // Resolved by another writer: plugin-only, so `messages.updated_at` stays put.
    question.plugin = { ...question.plugin, intervention: { status: 'approved' } };
    question.pluginState = {
      ...question.pluginState,
      heterogeneousIntervention: {
        ...question.pluginState.heterogeneousIntervention,
        transition: 'resolved',
      },
    };
    h.messageModel.listToolCallIndexByTopic.mockClear();
    h.messageModel.updateMessagePlugin.mockClear();

    await ingest(h, [buildEvent('agent_runtime_end', 1, { reason: 'success' })]);

    expect(h.messageModel.listToolCallIndexByTopic).not.toHaveBeenCalled();
    expect(h.messageModel.listToolCallIndexByTopicSince).toHaveBeenLastCalledWith(
      h.topicId,
      expect.objectContaining({ ids: [question.id] }),
    );
    // A stale pending copy would have closed the question as `session_ended`.
    expect(h.messageModel.updateMessagePlugin).not.toHaveBeenCalled();
    expect(h.messages.get(question.id)?.plugin?.intervention).toEqual({ status: 'approved' });
  });

  it('keeps the ingest stamp out of the turn metadata it restores', async () => {
    const h = createHarness();
    const assistant = h.messages.get(h.assistantMessageId)!;
    assistant.content = 'Hello ';
    assistant.metadata = { heteroIngestStamp: 'replica-b', mainMessageId: 'cc-1' };
    // Only the narrow columns, as `findAssistantSnapshotById` returns them.
    h.messageModel.findAssistantSnapshotById.mockImplementation(async (id: string) => {
      const m = h.messages.get(id);
      return (
        m &&
        ({
          content: m.content,
          metadata: m.metadata,
          model: m.model,
          provider: m.provider,
          reasoning: m.reasoning,
          tools: m.tools,
        } as any)
      );
    });

    await ingest(h, [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'world' })]);

    const update = h.messageModel.update.mock.calls.at(-1)!;
    expect(update[0]).toBe(h.assistantMessageId);
    expect(update[1]).toMatchObject({ content: 'Hello world' });
    expect(update[1].metadata.mainMessageId).toBe('cc-1');
    expect(update[1].metadata.heteroIngestStamp).not.toBe('replica-b');
  });
});
