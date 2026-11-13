// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

const consume = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/aiAgent/steerQueue/hetero', () => ({
  consumeHeteroSteer: consume,
}));

const OP = 'op-1';
const TOPIC = 'topic-1';

/** Writes the delivered message the way `consumeHeteroSteer` does. */
const consumeDelivery = (deliveries: Record<string, string>) =>
  consume.mockImplementation(async (messageModel, params) => {
    const content = deliveries[params.messageId];
    if (!content) return;
    await messageModel.create(
      {
        content,
        metadata: { operationId: params.operationId, steer: true },
        parentId: params.parentId,
        role: 'user',
        topicId: params.topicId,
      },
      params.messageId,
    );
    return { content, id: params.messageId, metadata: { steer: true }, parentId: params.parentId };
  });

const steerReplay = (stepIndex: number, uuid: string) =>
  buildEvent('step_complete', stepIndex, { phase: 'user_message', uuid });

describe('HeterogeneousPersistenceHandler — steer messages', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    consume.mockReset();
  });
  afterEach(() => __resetOperationStatesForTesting());

  it('opens the reply to a picked-up message under it, and names it on the stream_start', async () => {
    consumeDelivery({ 'msg-steer': 'look at Codex too' });
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });
    const tool = { apiName: 'Bash', arguments: '{}', id: 'tc-1', identifier: 'bash' };
    const reply = buildEvent('stream_start', 4, { messageId: 'cc-2', newStep: true });

    await h.handler.ingest({
      events: [
        buildEvent('stream_start', 0, { model: 'claude-opus' }),
        buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
        buildEvent('tool_result', 2, { content: 'ok', toolCallId: 'tc-1' }),
        steerReplay(3, 'msg-steer'),
        reply,
        buildEvent('stream_chunk', 5, { chunkType: 'text', content: 'checking Codex' }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    expect(consume).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageId: 'msg-steer', operationId: OP, parentId: 'asst-1' }),
    );
    const steer = h.messages.get('msg-steer');
    expect(steer).toMatchObject({ parentId: 'asst-1', role: 'user' });

    const replyId = h.handler.publishData(OP, reply).assistantMessage?.id;
    expect(h.messages.get(replyId!)).toMatchObject({ parentId: 'msg-steer', role: 'assistant' });
    expect(h.handler.publishData(OP, reply).parentMessage).toMatchObject({
      content: 'look at Codex too',
      id: 'msg-steer',
      role: 'user',
    });
  });

  it('ignores the replay of the run prompt', async () => {
    consumeDelivery({});
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });
    const next = buildEvent('stream_start', 2, { messageId: 'cc-2', newStep: true });

    await h.handler.ingest({
      events: [buildEvent('stream_start', 0, {}), steerReplay(1, 'uuid-prompt'), next],
      operationId: OP,
      topicId: TOPIC,
    });

    const nextId = h.handler.publishData(OP, next).assistantMessage?.id;
    expect(h.messages.get(nextId!)).toMatchObject({ parentId: 'asst-1' });
    expect(h.handler.publishData(OP, next).parentMessage).toBeUndefined();
  });

  it('leaves a sub-agent replay to the sub-agent', async () => {
    consumeDelivery({ 'msg-steer': 'x' });
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });

    await h.handler.ingest({
      events: [
        buildEvent('stream_start', 0, {}),
        buildEvent('step_complete', 1, {
          phase: 'user_message',
          subagent: { parentToolCallId: 'tc-spawn-1' },
          uuid: 'msg-steer',
        }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    expect(consume).not.toHaveBeenCalled();
  });
});
