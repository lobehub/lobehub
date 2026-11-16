import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { describe, expect, it, vi } from 'vitest';

import { parkAsyncShell } from '../asyncShellPark';

const buildCtx = () => {
  const create = vi.fn(async () => ({ id: 'msg_placeholder' }));
  const updatePluginState = vi.fn(async () => {});
  const markOperationParked = vi.fn(async () => true);
  const scheduleShellExpiry = vi.fn(async () => {});

  return {
    ctx: {
      messageModel: { create, updatePluginState },
      operationId: 'op_1',
      scheduleShellExpiry,
      stepIndex: 4,
      streamManager: { markOperationParked },
      topicId: 'topic_1',
    } as any,
    create,
    markOperationParked,
    scheduleShellExpiry,
    updatePluginState,
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
  it('parks a command started in the background', async () => {
    const { ctx, create, markOperationParked, scheduleShellExpiry } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      {
        parentMessageId: 'msg_parent',
        resultLimit: { canReadArchive: true, maxLength: 4000 },
        state,
        toolCall,
      },
      runningResult({
        commandId: 'sh-1',
        completionWatch: true,
        isBackground: true,
        success: true,
      }),
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
          asyncShell: expect.objectContaining({
            // The late result has no step context: the limit travels with the row.
            archive: expect.objectContaining({
              agentId: 'agent_1',
              canReadArchive: true,
              maxLength: 4000,
              topicId: 'topic_1',
            }),
            commandId: 'sh-1',
          }),
          status: 'pending',
        }),
        role: 'tool',
        tool_call_id: 'call_1',
      }),
    );
    // Scoped to the parking step, whose own closing events follow the park.
    expect(markOperationParked).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ reason: 'async_shell', stepIndex: 4 }),
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
      runningResult({ commandId: 'sh-2', completionWatch: true, running: true, success: true }),
    );

    expect(execution?.result.deferred).toBe(true);
  });

  it.each([
    ['the command already exited', { commandId: 'sh-3', completionWatch: true, exitCode: 0 }],
    ['the command failed to spawn', { commandId: 'sh-3', completionWatch: true, error: 'ENOENT' }],
    ['it is not a shell result', { completionWatch: true, exitCode: 1 }],
    // An older device (or a gateway that did not relay the registration) never
    // reports back: parking would leave the run waiting for its timeout.
    ['the device is not watching the command', { commandId: 'sh-3', running: true }],
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

  it('reuses the tool row a resumed (approved) call already owns', async () => {
    const { ctx, create, scheduleShellExpiry, updatePluginState } = buildCtx();

    const execution = await parkAsyncShell(
      ctx,
      { existingToolMessageId: 'msg_existing', parentMessageId: 'msg_parent', state, toolCall },
      runningResult({ commandId: 'sh-6', completionWatch: true, running: true }),
    );

    // A second row with the same tool_call_id would leave the approved one
    // empty forever and make the completion lookup ambiguous.
    expect(create).not.toHaveBeenCalled();
    expect(updatePluginState).toHaveBeenCalledWith(
      'msg_existing',
      expect.objectContaining({ asyncShell: expect.objectContaining({ commandId: 'sh-6' }) }),
    );
    expect(execution?.result.state).toMatchObject({ toolMessageId: 'msg_existing' });
    expect(scheduleShellExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ toolMessageId: 'msg_existing' }),
    );
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
      runningResult({ commandId: 'sh-4', completionWatch: true, isBackground: true }),
    );

    expect(execution).toBeNull();
  });
});
