// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness, ingest } from './eventBranchesTestUtils';

vi.mock('@/business/server/agent-run/agentInterventionReview', () => ({
  acknowledgeAgentInterventionProducerResolution: vi.fn(),
  notifyAgentInterventionRequired: vi.fn(),
}));

const bashCall = buildEvent('stream_chunk', 0, {
  chunkType: 'tools_calling',
  toolsCalling: [
    {
      apiName: 'Bash',
      arguments: '{}',
      id: 'toolu_bash',
      identifier: 'claude-code',
      type: 'default',
    },
  ],
});

const task = (status: string) => ({
  description: 'ping',
  startedAt: 1,
  status,
  taskId: 'bys1w0wxo',
  toolName: 'Bash',
});

describe('HeterogeneousPersistenceHandler — background_task', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('merges the snapshot into the starting tool message under backgroundTask', async () => {
    const h = createHarness();
    await ingest(h, [
      bashCall,
      buildEvent('tool_result', 1, {
        content: 'Command running in background',
        toolCallId: 'toolu_bash',
      }),
      buildEvent('background_task', 2, { task: task('running'), toolCallId: 'toolu_bash' }),
      buildEvent('agent_runtime_end', 3, {}),
      buildEvent('background_task', 4, { task: task('completed'), toolCallId: 'toolu_bash' }),
    ]);

    const writes = h.messageModel.updateToolMessage.mock.calls.filter(
      ([, patch]) => patch.pluginState?.backgroundTask,
    );
    expect(writes.map(([, patch]) => patch)).toEqual([
      { pluginState: { backgroundTask: { ...task('running'), operationId: h.operationId } } },
      { pluginState: { backgroundTask: { ...task('completed'), operationId: h.operationId } } },
    ]);
    const toolMessage = [...h.messages.values()].find((m) => m.tool_call_id === 'toolu_bash');
    expect(writes.every(([id]) => id === toolMessage?.id)).toBe(true);
  });

  it('skips a snapshot for a tool this run never persisted', async () => {
    const h = createHarness();
    await ingest(h, [
      buildEvent('background_task', 0, { task: task('running'), toolCallId: 'toolu_unknown' }),
    ]);
    expect(h.messageModel.updateToolMessage).not.toHaveBeenCalled();
  });
});
