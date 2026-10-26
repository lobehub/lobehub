// @vitest-environment node
import { parse } from '@lobechat/conversation-flow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

describe('heterogeneous operation isolation after steering', () => {
  beforeEach(__resetOperationStatesForTesting);
  afterEach(() => {
    __resetOperationStatesForTesting();
    vi.restoreAllMocks();
  });

  it.each([0, 1])('rejects a cached superseded run at step %i without writing', async (step) => {
    const h = createHarness({
      assistantMessageId: 'old-assistant',
      isOperationLiveOnTopic: async () => true,
      operationId: 'old-operation',
      topicId: 'topic',
    });
    await h.handler.ingest({
      events: [buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'before steer' })],
      operationId: 'old-operation',
      topicId: 'topic',
    });
    h.topicModel.findById.mockResolvedValue({
      agentId: null,
      id: 'topic',
      metadata: {
        runningOperation: { assistantMessageId: 'new-assistant', operationId: 'new-operation' },
      },
    });
    h.messageModel.update.mockClear();
    h.messageModel.create.mockClear();

    await expect(
      h.handler.ingest({
        events: [buildEvent('stream_chunk', step, { chunkType: 'text', content: 'late output' })],
        operationId: 'old-operation',
        topicId: 'topic',
      }),
    ).rejects.toThrow(/Stale hetero operation/);
    expect(h.messages.get('old-assistant')?.content).toBe('before steer');
    expect(h.messageModel.update).not.toHaveBeenCalled();
    expect(h.messageModel.create).not.toHaveBeenCalled();
  });

  it.each([true, false])('rechecks cached marker-less operation liveness: %s', async (live) => {
    const h = createHarness({
      assistantMessageId: 'assistant',
      isOperationLiveOnTopic: async () => live,
      operationId: 'operation',
      topicId: 'topic',
    });
    await h.handler.ingest({
      events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'first' })],
      operationId: 'operation',
      topicId: 'topic',
    });
    h.topicModel.findById.mockResolvedValue({ agentId: null, id: 'topic', metadata: {} });

    const ingest = h.handler.ingest({
      events: [buildEvent('stream_chunk', 0, { chunkType: 'text', content: ' continued' }, 2)],
      operationId: 'operation',
      topicId: 'topic',
    });
    if (live) await ingest;
    else await expect(ingest).rejects.toThrow(/Stale hetero operation/);
    expect(h.messages.get('assistant')?.content).toBe(live ? 'first continued' : 'first');
  });

  it('keeps a resumed reply reachable when another run wrote a newer assistant', async () => {
    const h = createHarness({
      assistantMessageId: 'new-seed',
      operationId: 'new-operation',
      topicId: 'topic',
    });
    h.messages.clear();
    const common = { agentId: null, topicId: 'topic' };
    h.messages.set('initial-user', {
      ...common,
      content: 'start',
      id: 'initial-user',
      role: 'user',
    });
    h.messages.set('old-seed', {
      ...common,
      content: 'working',
      id: 'old-seed',
      parentId: 'initial-user',
      role: 'assistant',
    });
    h.messages.set('steer', {
      ...common,
      content: 'also check the update',
      id: 'steer',
      metadata: { steer: true },
      parentId: 'old-seed',
      role: 'user',
    });
    h.messages.set('new-seed', {
      ...common,
      content: 'checking the update',
      id: 'new-seed',
      parentId: 'steer',
      role: 'assistant',
    });
    // A late old-run write can be newer than this run's seed. It must never
    // become the next step's parent, even on a cold replica.
    h.messages.set('late-old', {
      ...common,
      content: 'old continuation',
      id: 'late-old',
      metadata: { operationId: 'old-operation' },
      parentId: 'old-seed',
      role: 'assistant',
    });

    await h.handler.ingest({
      events: [
        buildEvent('stream_start', 1, { messageId: 'native-1', newStep: true }),
        buildEvent('stream_chunk', 1, { chunkType: 'text', content: 'new step' }),
      ],
      operationId: 'new-operation',
      topicId: 'topic',
    });
    const first = [...h.messages.values()].find((m) => m.content === 'new step')!;
    expect(first.parentId).toBe('new-seed');
    expect(first.metadata?.operationId).toBe('new-operation');

    h.messages.set('later-old', {
      ...common,
      content: 'another late old continuation',
      id: 'later-old',
      metadata: { operationId: 'old-operation' },
      parentId: 'late-old',
      role: 'assistant',
    });
    __resetOperationStatesForTesting();
    await h.handler.ingest({
      events: [
        buildEvent('stream_start', 2, { messageId: 'native-2', newStep: true }),
        buildEvent('stream_chunk', 2, { chunkType: 'text', content: 'final answer after steer' }),
      ],
      operationId: 'new-operation',
      topicId: 'topic',
    });
    const final = [...h.messages.values()].find((m) => m.content === 'final answer after steer')!;
    expect(final.parentId).toBe(first.id);
    const rendered = parse(
      [...h.messages.values()].map((m, index) => ({
        ...m,
        createdAt: index,
        updatedAt: index,
      })),
    );
    expect(JSON.stringify(rendered.flatList)).toContain('final answer after steer');
  });
});
