import { type AgentState } from '@lobechat/agent-runtime';
import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type RuntimeExecutorContext } from '../context';
import { buildServerVirtualSubAgentRunner } from '../executorHelpers';

/**
 * `callSubAgent({ runInBackground })`: the placeholder must say it belongs to a
 * background run before the child starts — the completion bridge reads that to
 * choose delivery over resuming a parent that never parked — and the running
 * thread is linked onto it without touching the status the bridge owns.
 */
describe('buildServerVirtualSubAgentRunner in background mode', () => {
  const buildRunner = (
    execResult: Record<string, unknown> = {
      operationId: 'child-op',
      success: true,
      threadId: 'thread-1',
    },
  ) => {
    const calls: string[] = [];
    const messageModel = {
      create: vi.fn(async () => {
        calls.push('create');
        return { id: 'placeholder-1' };
      }),
      deleteMessage: vi.fn(),
      updatePluginState: vi.fn().mockResolvedValue(undefined),
    };
    const execVirtualSubAgent = vi.fn(async () => {
      calls.push('exec');
      return execResult;
    });
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
      'assistant-1',
    );

    return { calls, execVirtualSubAgent, messageModel, runner: runner! };
  };

  it('marks the placeholder as background before starting the child', async () => {
    const { calls, execVirtualSubAgent, messageModel, runner } = buildRunner();

    const result = await runner.run({
      background: true,
      description: 'research',
      instruction: 'go',
    });

    expect(calls).toEqual(['create', 'exec']);
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginState: {
          background: true,
          sender: { agentId: 'agent-1', name: 'research' },
          status: 'pending',
        },
      }),
    );
    expect(execVirtualSubAgent).toHaveBeenCalledWith(
      expect.objectContaining({ background: true, parentMessageId: 'placeholder-1' }),
    );
    expect(result).toMatchObject({ started: true, toolMessageId: 'placeholder-1' });
  });

  it('links the running thread without writing the status', async () => {
    const { messageModel, runner } = buildRunner();

    await runner.run({ background: true, description: 'research', instruction: 'go' });

    expect(messageModel.updatePluginState).toHaveBeenCalledWith('placeholder-1', {
      threadId: 'thread-1',
    });
  });

  it('still starts when linking the thread fails', async () => {
    const { messageModel, runner } = buildRunner();
    messageModel.updatePluginState.mockRejectedValue(new Error('db down'));

    const result = await runner.run({
      background: true,
      description: 'research',
      instruction: 'go',
    });

    expect(result).toMatchObject({ started: true, threadId: 'thread-1' });
  });

  it('leaves a foreground placeholder as before', async () => {
    const { messageModel, runner } = buildRunner();

    await runner.run({ description: 'research', instruction: 'go' });

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ pluginState: { status: 'pending' } }),
    );
    expect(messageModel.updatePluginState).not.toHaveBeenCalled();
  });

  // The right panel and the thread portal tell a sub-agent from an ordinary
  // thread by the tool call that spawned it — a named callAgent target included.
  it('records the spawning tool call on the sub-agent thread', async () => {
    const { execVirtualSubAgent, runner } = buildRunner();

    await runner.run({ description: 'research', instruction: 'go' });
    await runner.run({ agentId: 'named-agent', description: 'Poet', instruction: 'go' });

    expect(execVirtualSubAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceToolCallId: 'tool-call-1' }),
    );
    expect(execVirtualSubAgent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceToolCallId: 'tool-call-1' }),
    );
  });

  // The answer is delivered as a message from whoever answered.
  it('records a named callAgent target as the sender', async () => {
    const { messageModel, runner } = buildRunner();

    await runner.run({
      agentId: 'named-agent',
      background: true,
      description: 'Poet',
      instruction: 'go',
    });

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginState: expect.objectContaining({ sender: { agentId: 'named-agent', name: 'Poet' } }),
      }),
    );
  });
});
