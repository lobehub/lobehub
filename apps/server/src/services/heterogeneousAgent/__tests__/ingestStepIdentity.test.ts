// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeterogeneousAgentService } from '..';
import { __resetOperationStatesForTesting } from '../HeterogeneousPersistenceHandler';
import { buildEvent, createHarness } from '../HeterogeneousPersistenceHandler/testUtils';

/**
 * A reconnecting viewer replays the whole stream starting from
 * `runningOperation.assistantMessageId` (the newest row). Without each step's
 * row on its `stream_start`, that replay wrote every earlier step onto the
 * newest row, so a run left alive by a background task flashed stale steps over
 * its final answer on every reconnect.
 */
describe('HeterogeneousAgentService.heteroIngest — step boundary identity', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('publishes each main-agent stream_start with the assistant row it opened', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'tpc-1',
    });
    const publishStreamEvent = vi.fn(async (_operationId: string, _event: any) => 'ok');
    const service = new HeterogeneousAgentService({} as any, 'user-1', {
      agentOperationModel: { touchRunning: vi.fn(async () => true) } as any,
      persistenceHandler: h.handler,
      snapshotStore: null,
      streamEventManager: { publishStreamEvent } as any,
      topicModel: h.topicModel as any,
    });
    const tool = { apiName: 'Bash', arguments: '{}', id: 'tc-1', identifier: 'bash' };

    await service.heteroIngest({
      agentType: 'claude-code',
      events: [
        buildEvent('stream_start', 0, {}),
        buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
        buildEvent('tool_result', 2, { content: 'ok', toolCallId: 'tc-1' }),
        buildEvent('stream_start', 3, { newStep: true }),
        buildEvent('stream_chunk', 4, { chunkType: 'text', content: 'final answer' }),
      ],
      operationId: 'op-1',
      topicId: 'tpc-1',
    });

    const published = publishStreamEvent.mock.calls.map(([, event]) => event);
    const startIds = published
      .filter((event) => event.type === 'stream_start')
      .map((event) => event.data.assistantMessage?.id);
    const assistantIds = [...h.messages.values()]
      .filter((message) => message.role === 'assistant')
      .map((message) => message.id);

    expect(assistantIds).toHaveLength(2);
    expect(startIds).toEqual(assistantIds);
    expect(published.find((event) => event.type === 'stream_chunk')?.data).not.toHaveProperty(
      'assistantMessage',
    );
  });
});
