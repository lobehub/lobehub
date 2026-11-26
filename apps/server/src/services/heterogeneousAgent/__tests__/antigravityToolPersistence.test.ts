import { createAdapter, type HeterogeneousAgentEvent } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '../HeterogeneousPersistenceHandler';
import { createHarness } from '../HeterogeneousPersistenceHandler/testUtils';

const operationId = 'op-antigravity-test';
const topicId = 'topic-antigravity-test';
const assistantMessageId = 'assistant-antigravity-test';

/** `agy acp` session updates, shaped as recorded from agy 1.5.15. */
const toolCall = (toolCallId: string, CommandLine: string) => ({
  args: { CommandLine },
  kind: 'execute',
  name: 'run_command',
  rawInput: { CommandLine },
  sessionUpdate: 'tool_call',
  status: 'in_progress',
  title: CommandLine,
  toolCallId,
});

const toolDone = (toolCallId: string, output: string, status = 'completed') => ({
  content: [{ content: { text: output, type: 'text' }, type: 'content' }],
  name: 'run_command',
  sessionUpdate: 'tool_call_update',
  status,
  toolCallId,
});

const createReplay = async () => {
  const adapter = createAdapter('antigravity');
  const harness = createHarness({ assistantMessageId, operationId, topicId });
  const ingestEvents = async (events: HeterogeneousAgentEvent[]) => {
    await harness.handler.ingest({
      // Snapshot each update at the transport boundary, before adapting the next one.
      events: structuredClone(events).map((event) => ({ ...event, operationId })),
      operationId,
      topicId,
    });
  };
  const ingestRaw = async (raw: unknown) => ingestEvents(adapter.adapt(raw));
  await ingestRaw({ sessionId: 'agy-session', type: 'antigravity_session' });
  return {
    ...harness,
    adapter,
    ingestEvents,
    ingestRaw,
    tools: () => [...harness.messages.values()].filter((message) => message.role === 'tool'),
  };
};

describe('Antigravity ACP adapter → coordinator → tool persistence', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('persists a command with its arguments and output under the assistant', async () => {
    const replay = await createReplay();
    await replay.ingestRaw(toolCall('call-1', 'echo hello'));
    await replay.ingestRaw(toolDone('call-1', 'hello'));

    expect(replay.tools()).toHaveLength(1);
    const tool = await replay.messageModel.findById(replay.tools()[0].id);
    expect(tool).toMatchObject({
      content: 'hello',
      parentId: assistantMessageId,
      plugin: { apiName: 'run_command', arguments: '{"CommandLine":"echo hello"}' },
    });
    expect(replay.messages.get(assistantMessageId)?.tools).toMatchObject([
      { arguments: '{"CommandLine":"echo hello"}', result_msg_id: tool!.id },
    ]);
  });

  it('keeps parallel commands apart when they finish out of order', async () => {
    const replay = await createReplay();
    await replay.ingestRaw(toolCall('call-1', 'echo first'));
    await replay.ingestRaw(toolCall('call-2', 'echo second'));
    await replay.ingestRaw(toolDone('call-2', 'second'));
    await replay.ingestRaw(toolDone('call-1', 'first'));

    expect(
      Object.fromEntries(
        replay.tools().map((message) => [message.plugin.arguments, message.content]),
      ),
    ).toEqual({
      '{"CommandLine":"echo first"}': 'first',
      '{"CommandLine":"echo second"}': 'second',
    });
  });

  it('marks a failed command as an error result', async () => {
    const replay = await createReplay();
    await replay.ingestRaw(toolCall('call-1', 'false'));
    await replay.ingestRaw(toolDone('call-1', 'exit 1', 'failed'));

    expect(replay.tools()).toHaveLength(1);
    expect(replay.tools()[0]).toMatchObject({ content: 'exit 1', parentId: assistantMessageId });
  });

  it('settles a command that was still running when the run was stopped', async () => {
    const replay = await createReplay();
    await replay.ingestRaw(toolCall('call-1', 'sleep 20'));
    await replay.ingestRaw({ stopReason: 'cancelled', type: 'antigravity_prompt_completed' });
    await replay.ingestEvents(replay.adapter.flush());

    expect(replay.tools()).toHaveLength(1);
    expect(replay.tools()[0]).toMatchObject({
      parentId: assistantMessageId,
      plugin: { arguments: '{"CommandLine":"sleep 20"}' },
    });
    expect(replay.messages.get(assistantMessageId)?.tools).toMatchObject([
      { result_msg_id: replay.tools()[0].id },
    ]);
  });
});
