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

  return {
    deps: {
      messageModel: { findMessagePlugin: vi.fn(), updateToolMessage } as any,
      serverDB: {
        query: { messagePlugins: { findFirst: vi.fn(async () => plugin) } },
      } as any,
      tryResumeParentFromAsyncTool,
    },
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
