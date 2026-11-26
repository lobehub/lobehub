// @vitest-environment node
import { ThreadType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

/**
 * An external agent (Claude Code) running as a sub-agent sits in an isolation
 * thread. It appears in the topic marker only while its parent's turn runs; a
 * background one outlives that, and its batches then arrive with no marker.
 */
const subAgentHarness = (marker: 'none' | 'present') => {
  const h = createHarness({
    assistantMessageId: 'thread-asst-1',
    isOperationLiveOnTopic: async () => true,
    operationId: 'op-child',
    threadId: 'thread-1',
    topicId: 'topic-1',
  });
  h.threads.set('thread-1', {
    id: 'thread-1',
    metadata: { sourceToolCallId: 'call-1' },
    status: 'processing',
    title: 'Fix',
    topicId: 'topic-1',
    type: ThreadType.Isolation,
  });
  if (marker === 'none') {
    h.topicModel.findById.mockResolvedValue({ agentId: null, id: 'topic-1', metadata: {} });
  }
  return h;
};

describe('HeterogeneousPersistenceHandler — external sub-agent in an isolation thread', () => {
  beforeEach(__resetOperationStatesForTesting);
  afterEach(__resetOperationStatesForTesting);

  it.each(['none', 'present'] as const)(
    'binds the session to the thread, never the topic (marker: %s)',
    async (marker) => {
      const h = subAgentHarness(marker);

      await h.handler.ingest({
        events: [buildEvent('stream_start', 0, { sessionId: 'cc-sess-1' })],
        assistantMessageId: 'thread-asst-1',
        operationId: 'op-child',
        topicId: 'topic-1',
      });

      expect(h.threads.get('thread-1')?.metadata).toEqual({
        heteroSessionId: 'cc-sess-1',
        sourceToolCallId: 'call-1',
      });
      expect(h.topicModel.updateMetadata).not.toHaveBeenCalledWith(
        'topic-1',
        expect.objectContaining({ heteroSessionId: expect.anything() }),
      );
    },
  );

  // Without the marker the run used to lose its thread, so every later step
  // landed in the parent conversation.
  it('keeps later steps in the thread when the marker no longer names the run', async () => {
    const h = subAgentHarness('none');

    await h.handler.ingest({
      events: [
        buildEvent('stream_chunk', 0, { chunkType: 'text', content: 'step one' }),
        buildEvent('stream_start', 1, { newStep: true }),
      ],
      assistantMessageId: 'thread-asst-1',
      operationId: 'op-child',
      topicId: 'topic-1',
    });

    const later = [...h.messages.values()].filter(
      (message) => message.role === 'assistant' && message.id !== 'thread-asst-1',
    );
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((message) => message.threadId === 'thread-1')).toBe(true);
  });

  it('keeps binding the conversation agent itself to the topic', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-main',
      topicId: 'topic-1',
    });

    await h.handler.ingest({
      events: [buildEvent('stream_start', 0, { sessionId: 'cc-main' })],
      operationId: 'op-main',
      topicId: 'topic-1',
    });

    expect(h.topicModel.updateMetadata).toHaveBeenCalledWith('topic-1', {
      heteroSessionId: 'cc-main',
    });
  });
});
