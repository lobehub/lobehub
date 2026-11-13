import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parkAsyncShell } from '../asyncShellPark';

// The park switch is a deployment flag; read it through a mutable object so a
// test can flip it without reloading the env module (which validates on import).
const envMock = vi.hoisted(() => ({
  AGENT_ASYNC_SHELL: 'true' as string | undefined,
  AGENT_ASYNC_SHELL_PARK_WINDOW_MS: undefined as number | undefined,
  AGENT_ASYNC_SHELL_TIMEOUT_MS: undefined as number | undefined,
}));

vi.mock('@lobechat/env/agent', () => ({ agentEnv: envMock }));

const buildCtx = () => {
  const create = vi.fn(async () => ({ id: 'msg_placeholder' }));
  const markOperationParked = vi.fn(async () => true);
  const scheduleShellExpiry = vi.fn(async () => {});

  return {
    ctx: {
      messageModel: { create },
      operationId: 'op_1',
      scheduleShellExpiry,
      streamManager: { markOperationParked },
      topicId: 'topic_1',
    } as any,
    create,
    markOperationParked,
    scheduleShellExpiry,
  };
};

const state = { origin: { agentId: 'agent_1', threadId: 'thread_1', topicId: 'topic_1' } } as any;
const toolCall = {
  apiName: 'runCommand',
  arguments: '{}',
  id: 'call_1',
  identifier: LocalSystemIdentifier,
} as any;

const runningResult = (state: Record<string, unknown>) =>
  ({ content: '', executionTime: 10, state, success: true }) as any;

describe('parkAsyncShell', () => {
  afterEach(() => {
    envMock.AGENT_ASYNC_SHELL = 'true';
  });

  it('parks a command started in the background', async () => {
    const { ctx, create, markOperationParked, scheduleShellExpiry } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      { parentMessageId: 'msg_parent', state, toolCall },
      runningResult({ commandId: 'sh-1', isBackground: true, success: true }),
    );

    expect(execution?.result).toMatchObject({
      deferred: true,
      state: { commandId: 'sh-1', toolMessageId: 'msg_placeholder' },
      success: true,
    });
    // The placeholder exists BEFORE the pause chunk advertises it: without the
    // row the client can never load it and the barrier can never clear.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'msg_parent',
        pluginState: expect.objectContaining({
          asyncShell: expect.objectContaining({ commandId: 'sh-1' }),
          status: 'pending',
        }),
        role: 'tool',
        tool_call_id: 'call_1',
      }),
    );
    expect(markOperationParked).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ reason: 'async_shell' }),
    );
    // One deadline message, not a poll loop.
    expect(scheduleShellExpiry).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op_1',
        toolCallId: 'call_1',
        toolMessageId: 'msg_placeholder',
      }),
    );
  });

  it('parks a foreground command that outlived its wait window', async () => {
    const { ctx } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      { parentMessageId: 'msg_parent', state, toolCall },
      runningResult({ commandId: 'sh-2', running: true, success: true }),
    );

    expect(execution?.result.deferred).toBe(true);
  });

  it.each([
    ['the command already exited', { commandId: 'sh-3', exitCode: 0 }],
    ['the command failed to spawn', { commandId: 'sh-3', error: 'ENOENT' }],
    ['it is not a shell result', { exitCode: 1 }],
  ])('does not park when %s', async (_label, resultState) => {
    const { ctx, create } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      { parentMessageId: 'msg_parent', state, toolCall },
      runningResult(resultState),
    );

    expect(execution).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not park a non-shell tool', async () => {
    const { ctx } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      {
        parentMessageId: 'msg_parent',
        state,
        toolCall: { ...toolCall, apiName: 'getCommandOutput' },
      },
      runningResult({ commandId: 'sh-4', isBackground: true }),
    );

    expect(execution).toBeNull();
  });

  it('falls back to the normal result when the flag is off', async () => {
    envMock.AGENT_ASYNC_SHELL = 'false';
    const { ctx, create } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      { parentMessageId: 'msg_parent', state, toolCall },
      runningResult({ commandId: 'sh-5', isBackground: true }),
    );

    expect(execution).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
