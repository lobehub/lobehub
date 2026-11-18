import { describe, expect, it, vi } from 'vitest';

import { completeDeferredShell } from '../asyncShellResult';

const POLL_PLUGIN = {
  id: 'msg_placeholder',
  state: {
    asyncShell: { commandId: 'sh-1', startedAt: '2026-01-01T00:00:00.000Z', timeoutMs: 1_800_000 },
    status: 'pending',
  },
  toolCallId: 'call_1',
};

const buildDeps = (plugin: unknown = POLL_PLUGIN, backfillSuccess = true) => {
  const updateToolMessage = vi.fn(async (_id: string, _payload: any) => ({
    success: backfillSuccess,
  }));
  const tryResumeParentFromAsyncTool = vi.fn(async () => true);
  // Passthrough by default: no `afterToolCall` policy configured.
  const controlCompletedToolResult = vi.fn(async (input: any) => ({
    blocked: false,
    cancelled: false,
    result: input.result,
  }));

  return {
    deps: {
      controlCompletedToolResult,
      messageModel: { findMessagePlugin: vi.fn(), updateToolMessage } as any,
      serverDB: {
        query: { messagePlugins: { findFirst: vi.fn(async () => plugin) } },
      } as any,
      tryResumeParentFromAsyncTool,
    },
    controlCompletedToolResult,
    tryResumeParentFromAsyncTool,
    updateToolMessage,
  };
};

describe('completeDeferredShell', () => {
  it('backfills the placeholder and resumes the parked operation', async () => {
    const { deps, tryResumeParentFromAsyncTool, updateToolMessage } = buildDeps();

    const outcome = await completeDeferredShell(deps, {
      operationId: 'op_1',
      result: {
        content: 'Command completed successfully.\nstdout: 42 tests passed',
        state: { exitCode: 0 },
        success: true,
        toolCallId: 'call_1',
      },
    });

    expect(outcome).toEqual({ handled: true, resumed: true });
    expect(updateToolMessage).toHaveBeenCalledWith(
      'msg_placeholder',
      expect.objectContaining({
        content: 'Command completed successfully.\nstdout: 42 tests passed',
        // Idempotent: a duplicate late result (or the expiry message racing it)
        // must not overwrite the answer that landed first.
        onlyIfEmpty: true,
        pluginState: expect.objectContaining({ exitCode: 0, status: 'completed' }),
      }),
    );
    // The barrier trusts this write instead of re-reading a lagging replica.
    expect(tryResumeParentFromAsyncTool).toHaveBeenCalledWith(
      { parentOperationId: 'op_1' },
      expect.objectContaining({
        knownFulfilledMessageId: 'msg_placeholder',
        scheduleVerifyOnHold: true,
      }),
    );
  });

  it('keeps the device command state the tool card renders', async () => {
    const { deps, updateToolMessage } = buildDeps();

    // A device reports the late result in `getCommandOutput`'s shape: output
    // and liveness, but no command id of its own.
    await completeDeferredShell(deps, {
      operationId: 'op_1',
      result: {
        content: 'Exit code: 0\n42 tests passed',
        state: { exitCode: 0, running: false, status: 'done', stdout: '42 tests passed' },
        success: true,
        toolCallId: 'call_1',
      },
    });

    expect(updateToolMessage).toHaveBeenCalledWith(
      'msg_placeholder',
      expect.objectContaining({
        pluginState: expect.objectContaining({
          asyncShell: expect.objectContaining({ commandId: 'sh-1' }),
          commandId: 'sh-1',
          exitCode: 0,
          running: false,
          // The park's outcome wins over a same-named device field.
          status: 'completed',
          stdout: '42 tests passed',
        }),
      }),
    );
  });

  it('size-limits the answer the way the synchronous path does', async () => {
    const archive = {
      agentId: 'agent_1',
      canReadArchive: true,
      maxLength: 100,
      topicId: 'topic_1',
    };
    const { deps, updateToolMessage } = buildDeps({
      ...POLL_PLUGIN,
      state: { ...POLL_PLUGIN.state, asyncShell: { ...POLL_PLUGIN.state.asyncShell, archive } },
    });
    const archiveResult = vi.fn(async () => 'first 100 chars… [archived]');
    const noisy = 'x'.repeat(10_000);

    await completeDeferredShell(
      { ...deps, archiveResult },
      {
        operationId: 'op_1',
        result: { content: noisy, state: { exitCode: 0 }, success: true, toolCallId: 'call_1' },
      },
    );

    // The parked step recorded its limit; a noisy background command must not
    // bypass it just because its answer arrived late.
    expect(archiveResult).toHaveBeenCalledWith(
      expect.objectContaining({ ...archive, content: noisy, toolCallId: 'call_1' }),
    );
    expect(updateToolMessage).toHaveBeenCalledWith(
      'msg_placeholder',
      expect.objectContaining({ content: 'first 100 chars… [archived]' }),
    );
  });

  it('does not archive a result the policy withheld', async () => {
    const { deps, controlCompletedToolResult } = buildDeps({
      ...POLL_PLUGIN,
      state: {
        ...POLL_PLUGIN.state,
        asyncShell: { ...POLL_PLUGIN.state.asyncShell, archive: { canReadArchive: true } },
      },
    });
    controlCompletedToolResult.mockResolvedValueOnce({
      blocked: true,
      cancelled: false,
      result: { content: 'Denied by policy.', success: false },
    });
    const archiveResult = vi.fn(async (input: { content: string }) => input.content);

    await completeDeferredShell(
      { ...deps, archiveResult },
      {
        operationId: 'op_1',
        result: { content: 'secret output', success: true, toolCallId: 'call_1' },
      },
    );

    expect(archiveResult).not.toHaveBeenCalled();
  });

  it('runs the result policy before the answer reaches history', async () => {
    const { deps, controlCompletedToolResult, updateToolMessage } = buildDeps();
    // A configured `afterToolCall` policy denies the command's output. This
    // completion never travelled through `ServerToolTransport`, so the gate has
    // to run here as well — otherwise the raw device text is what history and
    // the model get.
    controlCompletedToolResult.mockResolvedValueOnce({
      blocked: true,
      cancelled: false,
      result: {
        content: 'Denied by policy.',
        error: 'hook_denied',
        state: { phase: 'afterToolCall', type: 'blocked' },
        success: false,
      },
    } as any);

    await completeDeferredShell(deps, {
      operationId: 'op_1',
      result: { content: 'secret', state: { exitCode: 0 }, success: true, toolCallId: 'call_1' },
    });

    expect(controlCompletedToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op_1', toolMessageId: 'msg_placeholder' }),
    );
    expect(updateToolMessage).toHaveBeenCalledWith(
      'msg_placeholder',
      expect.objectContaining({
        content: 'Denied by policy.',
        pluginError: 'hook_denied',
        // A withheld result replaces the whole state, including the shell ids.
        replacePluginState: true,
      }),
    );
  });

  it('marks a failed command and still resumes', async () => {
    const { deps, tryResumeParentFromAsyncTool, updateToolMessage } = buildDeps();

    await completeDeferredShell(deps, {
      operationId: 'op_1',
      result: { content: null, state: { exitCode: 2 }, success: true, toolCallId: 'call_1' },
    });

    expect(updateToolMessage).toHaveBeenCalledWith(
      'msg_placeholder',
      expect.objectContaining({
        content: 'Command failed with exit code 2.',
        pluginState: expect.objectContaining({ status: 'error' }),
      }),
    );
    expect(tryResumeParentFromAsyncTool).toHaveBeenCalled();
  });

  it('reports a timeout without claiming the command failed', async () => {
    const { deps, updateToolMessage } = buildDeps();

    await completeDeferredShell(deps, {
      operationId: 'op_1',
      reason: 'timeout',
      result: { content: null, success: false, toolCallId: 'call_1' },
    });

    const [, payload] = updateToolMessage.mock.calls[0] as unknown as [string, any];
    // The command may still be running on the device: say so and name the shell
    // so the model can check on it instead of re-running the work.
    expect(payload.content).toContain('may still be running');
    expect(payload.content).toContain('sh-1');
    expect(payload.pluginError).toMatchObject({ type: 'timeout' });
    expect(payload.pluginState).toMatchObject({ status: 'error' });
  });

  it('keeps looking for a placeholder the park has not written yet', async () => {
    const { deps, tryResumeParentFromAsyncTool, updateToolMessage } = buildDeps();
    // A command that ends immediately can report before `parkAsyncShell` has
    // inserted the row: miss once, then find it.
    (deps.serverDB as any).query.messagePlugins.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(POLL_PLUGIN);

    const outcome = await completeDeferredShell(
      { ...deps, placeholderWait: { attempts: 3, intervalMs: 0 } },
      {
        operationId: 'op_1',
        result: { content: 'fast', success: true, toolCallId: 'call_1' },
      },
    );

    expect(outcome).toEqual({ handled: true, resumed: true });
    expect(updateToolMessage).toHaveBeenCalled();
    expect(tryResumeParentFromAsyncTool).toHaveBeenCalled();
  });

  it('reports a missing placeholder instead of swallowing the completion', async () => {
    const { deps, updateToolMessage } = buildDeps();
    (deps.serverDB as any).query.messagePlugins.findFirst = vi.fn(async () => null);

    const outcome = await completeDeferredShell(
      { ...deps, placeholderWait: { attempts: 0, intervalMs: 0 } },
      {
        operationId: 'op_1',
        result: { content: 'fast', success: true, toolCallId: 'call_1' },
      },
    );

    // Distinct from `not_deferred_shell`: the caller has to keep this result,
    // because the device will not send it again.
    expect(outcome).toEqual({ handled: false, reason: 'placeholder_missing' });
    expect(updateToolMessage).not.toHaveBeenCalled();
  });

  it('ignores a result for a tool that was never parked', async () => {
    const { deps, updateToolMessage } = buildDeps({
      id: 'msg_other',
      state: null,
      toolCallId: 'x',
    });

    const outcome = await completeDeferredShell(deps, {
      operationId: 'op_1',
      result: { content: 'ok', success: true, toolCallId: 'x' },
    });

    expect(outcome).toEqual({ handled: false, reason: 'not_deferred_shell' });
    expect(updateToolMessage).not.toHaveBeenCalled();
  });

  it('throws when the placeholder cannot be written', async () => {
    // Never resume on a failed backfill: the barrier would read the row as
    // unfulfilled and the run would strand instead of being retried.
    const { deps, tryResumeParentFromAsyncTool } = buildDeps(POLL_PLUGIN, false);

    await expect(
      completeDeferredShell(deps, {
        operationId: 'op_1',
        result: { content: 'ok', success: true, toolCallId: 'call_1' },
      }),
    ).rejects.toThrow(/failed to backfill/);
    expect(tryResumeParentFromAsyncTool).not.toHaveBeenCalled();
  });
});
