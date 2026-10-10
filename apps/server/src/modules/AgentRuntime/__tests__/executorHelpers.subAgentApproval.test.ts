import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * A `callSubAgent` that went through human approval is executed in place on
 * its intervention row. The runner used to create a second placeholder anyway,
 * so the sub-agent reported into that one while the approved row stayed empty:
 * the parent's barrier never cleared and later turns read the slot as empty.
 */
describe('buildServerVirtualSubAgentRunner after tool approval', () => {
  const buildRunner = (
    existingToolMessageId: string | undefined,
    execResult: Record<string, unknown> = { operationId: 'child-op', success: true },
  ) => {
    const messageModel = {
      create: vi.fn().mockResolvedValue({ id: 'new-placeholder' }),
      deleteMessage: vi.fn(),
      updatePluginState: vi.fn().mockResolvedValue(undefined),
    };
    const execVirtualSubAgent = vi.fn().mockResolvedValue(execResult);
    const ctx = {
      execVirtualSubAgent,
      messageModel,
      operationId: 'parent-op',
      topicId: 'topic-1',
    } as unknown as RuntimeExecutorContext;

    const runner = buildServerVirtualSubAgentRunner(
      ctx,
      {
        operationId: 'parent-op',
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
      } as unknown as AgentState,
      { id: 'tool-call-1' } as ChatToolPayload,
      existingToolMessageId ?? 'assistant-1',
      existingToolMessageId,
    );

    return { execVirtualSubAgent, messageModel, runner: runner! };
  };

  it('anchors the sub-agent to the approved row instead of creating a second one', async () => {
    const { execVirtualSubAgent, messageModel, runner } = buildRunner('approved-tool-row');

    const result = await runner.run({ description: 'research', instruction: 'go' });

    expect(messageModel.create).not.toHaveBeenCalled();
    expect(messageModel.updatePluginState).toHaveBeenCalledWith('approved-tool-row', {
      status: 'dispatched',
    });
    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: 'approved-tool-row' }),
    );
    expect(result).toMatchObject({ started: true, toolMessageId: 'approved-tool-row' });
  });

  it('keeps the approved row when the sub-agent fails to start', async () => {
    const { messageModel, runner } = buildRunner('approved-tool-row', {
      error: 'queue unavailable',
      success: false,
    });

    const result = await runner.run({ description: 'research', instruction: 'go' });

    expect(result).toMatchObject({ error: 'queue unavailable', started: false });
    expect(messageModel.deleteMessage).not.toHaveBeenCalled();
  });

  it('still creates its own placeholder when the call was not approved in place', async () => {
    const { messageModel, runner } = buildRunner(undefined);

    const result = await runner.run({ description: 'research', instruction: 'go' });

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'assistant-1', pluginState: { status: 'dispatched' } }),
    );
    expect(result).toMatchObject({ started: true, toolMessageId: 'new-placeholder' });
  });

  it('keeps the legacy pending approved row when the call blocks (wait:true)', async () => {
    const { messageModel, runner } = buildRunner('approved-tool-row');

    await runner.run({ description: 'research', instruction: 'go', wait: true });

    // `wait:true` parks instead of dispatching: the approved row stays `pending`
    // and is backfilled when the parent op resumes with the child's result.
    expect(messageModel.updatePluginState).toHaveBeenCalledWith('approved-tool-row', {
      status: 'pending',
    });
  });
});
