import { createAdapter, type HeterogeneousAgentEvent } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '../HeterogeneousPersistenceHandler';
import { createHarness } from '../HeterogeneousPersistenceHandler/testUtils';

const operationId = 'op-antigravity-test';
const topicId = 'topic-antigravity-test';
const assistantMessageId = 'assistant-antigravity-test';

const toolUpdate = (index: number, state: 'ACTIVE' | 'DONE', info: Record<string, unknown>) => ({
  event: 'step_update',
  step_update: {
    conversation_id: 'conversation-test',
    state,
    step_index: index,
    step_type: 'tool',
    tool_info: { name: 'run_command', ...info },
  },
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
  await ingestRaw({ conversation_id: 'conversation-test', event: 'init' });
  return {
    ...harness,
    adapter,
    ingestEvents,
    ingestRaw,
    tools: () => [...harness.messages.values()].filter((message) => message.role === 'tool'),
  };
};

describe('Antigravity adapter → coordinator → tool persistence', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it.each(['ACTIVE', 'DONE'] as const)(
    'persists parameters first supplied in a later %s update',
    async (state) => {
      const replay = await createReplay();
      await replay.ingestRaw(toolUpdate(1, 'ACTIVE', {}));
      await replay.ingestRaw(
        toolUpdate(1, state, { output: 'hello', parameters: { CommandLine: 'echo hello' } }),
      );
      if (state === 'ACTIVE') {
        await replay.ingestRaw(toolUpdate(1, 'DONE', { output: 'hello' }));
      }

      expect(replay.tools()).toHaveLength(1);
      const tool = await replay.messageModel.findById(replay.tools()[0].id);
      expect(tool).toMatchObject({
        content: 'hello',
        parentId: assistantMessageId,
        plugin: { arguments: '{"CommandLine":"echo hello"}' },
      });
      expect(replay.messages.get(assistantMessageId)?.tools).toMatchObject([
        { arguments: '{"CommandLine":"echo hello"}', result_msg_id: tool!.id },
      ]);
    },
  );

  it('does not publish a parameterless pending tool in another tool batch', async () => {
    const replay = await createReplay();
    await replay.ingestRaw(toolUpdate(1, 'ACTIVE', {}));
    await replay.ingestRaw(
      toolUpdate(2, 'DONE', { output: 'second', parameters: { CommandLine: 'echo second' } }),
    );
    expect(replay.tools().map((message) => message.plugin.arguments)).toEqual([
      '{"CommandLine":"echo second"}',
    ]);

    await replay.ingestRaw(
      toolUpdate(1, 'DONE', { output: 'first', parameters: { CommandLine: 'echo first' } }),
    );
    expect(replay.tools()).toHaveLength(2);
    expect(replay.tools().find((message) => message.content === 'first')?.plugin.arguments).toBe(
      '{"CommandLine":"echo first"}',
    );
  });

  it.each([undefined, {}])(
    'persists completed tools with empty parameters (%j)',
    async (parameters) => {
      const replay = await createReplay();
      await replay.ingestRaw(toolUpdate(1, 'DONE', { output: 'done', parameters }));
      expect(replay.tools()).toHaveLength(1);
      expect(replay.tools()[0]).toMatchObject({
        content: 'done',
        parentId: assistantMessageId,
        plugin: { arguments: '{}' },
      });
    },
  );

  it.each(['flush', 'ERROR', 'SUCCESS'] as const)(
    'materializes an unfinished tool before settling it on %s',
    async (terminal) => {
      const replay = await createReplay();
      await replay.ingestRaw(toolUpdate(1, 'ACTIVE', {}));
      if (terminal === 'flush') {
        await replay.ingestEvents(replay.adapter.flush());
      } else {
        await replay.ingestRaw({
          event: 'result',
          result: {
            conversation_id: 'conversation-test',
            response: 'Finished.',
            status: terminal,
          },
        });
      }
      await replay.ingestEvents(replay.adapter.flush());

      expect(replay.tools()).toHaveLength(1);
      const tool = replay.tools()[0];
      expect(tool).toMatchObject({
        content: 'Antigravity ended before this tool returned a result.',
        parentId: assistantMessageId,
        plugin: { arguments: '{}' },
        pluginError: { message: 'Antigravity ended before this tool returned a result.' },
      });
      expect(replay.messages.get(assistantMessageId)?.tools).toMatchObject([
        { result_msg_id: tool.id },
      ]);
    },
  );
});
