// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

const OP = 'op-1';
const TOPIC = 'topic-1';

describe('HeterogeneousPersistenceHandler.publishData', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('names the assistant row each main-agent step opened, so a replay from the newest row stays on each step', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });
    const tool = { apiName: 'Bash', arguments: '{}', id: 'tc-1', identifier: 'bash' };

    const firstStart = buildEvent('stream_start', 0, { model: 'claude-opus' });
    const secondStart = buildEvent('stream_start', 3, { newStep: true });
    const thirdStart = buildEvent('stream_start', 6, { newStep: true });
    await h.handler.ingest({
      events: [
        firstStart,
        buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
        buildEvent('tool_result', 2, { content: 'ok', toolCallId: 'tc-1' }),
        secondStart,
        buildEvent('stream_chunk', 4, { chunkType: 'text', content: 'waiting on CI' }),
        buildEvent('stream_chunk', 5, { chunkType: 'text', content: 'still waiting' }),
        thirdStart,
        buildEvent('stream_chunk', 7, { chunkType: 'text', content: 'final answer' }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    const assistantIds = [...h.messages.values()]
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id);
    expect(assistantIds).toHaveLength(3);

    const stamped = [firstStart, secondStart, thirdStart].map(
      (event) => h.handler.publishData(OP, event).assistantMessage?.id,
    );
    expect(stamped).toEqual(assistantIds);
    // The rest of the producer payload rides along untouched.
    expect(h.handler.publishData(OP, firstStart)).toMatchObject({ model: 'claude-opus' });
    expect(h.handler.publishData(OP, secondStart)).toMatchObject({ newStep: true });
  });

  it('leaves subagent step boundaries and non-boundary events unstamped', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });

    const subagentStart = buildEvent('stream_start', 1, {
      newStep: true,
      subagent: { parentToolCallId: 'tc-spawn-1', subagentMessageId: 'sub-msg-1' },
    });
    const chunk = buildEvent('stream_chunk', 2, { chunkType: 'text', content: 'hi' });
    await h.handler.ingest({ events: [subagentStart, chunk], operationId: OP, topicId: TOPIC });

    expect(h.handler.publishData(OP, subagentStart)).toBe(subagentStart.data);
    expect(h.handler.publishData(OP, chunk)).toBe(chunk.data);
  });

  it('forgets the mapping once the event is published, and passes data through without state', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });
    const start = buildEvent('stream_start', 0, {});
    await h.handler.ingest({ events: [start], operationId: OP, topicId: TOPIC });

    expect(h.handler.publishData(OP, start).assistantMessage?.id).toBe('asst-1');

    h.handler.markEventPublished(OP, start);
    expect(h.handler.publishData(OP, start)).toBe(start.data);
    expect(h.handler.publishData('op-unknown', start)).toBe(start.data);
  });
});
