// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import { completeDeferredShell } from './asyncShellResult';
import { type RuntimeFactoryDeps, setupLocalExecutionCallback } from './runtimeFactory';

vi.mock('./asyncShellResult', () => ({
  completeDeferredShell: vi.fn().mockResolvedValue({ handled: true }),
}));

const mockedCompleteDeferredShell = vi.mocked(completeDeferredShell);

const captureCallback = (deps: Record<string, unknown>) => {
  const impl = new LocalQueueServiceImpl();
  const setCallback = vi.spyOn(impl, 'setExecutionCallback');
  setupLocalExecutionCallback({
    queueService: { getImpl: () => impl },
    ...deps,
  } as unknown as RuntimeFactoryDeps);
  return setCallback.mock.calls[0][0];
};

const baseDeps = () => ({
  controlCompletedToolResult: vi.fn(),
  coordinator: { loadAgentState: vi.fn().mockResolvedValue({ status: 'waiting_for_async_tool' }) },
  executeStep: vi.fn(),
  messageModel: { findMessagePlugin: vi.fn(), updateToolMessage: vi.fn() },
  serverDB: {},
  tryResumeParentFromAsyncTool: vi.fn(),
});

describe('local delivery of a parked shell expiry', () => {
  it('closes the placeholder as a timeout instead of re-running the completed step 0', async () => {
    const deps = baseDeps();
    const callback = captureCallback(deps);

    await callback('op-1', 0, undefined, {
      expireShell: true,
      toolCallId: 'call-1',
      toolMessageId: 'msg-1',
    });

    expect(deps.executeStep).not.toHaveBeenCalled();
    expect(deps.coordinator.loadAgentState).toHaveBeenCalledWith('op-1');
    expect(mockedCompleteDeferredShell).toHaveBeenCalledTimes(1);
    expect(mockedCompleteDeferredShell.mock.calls[0][1]).toEqual({
      operationId: 'op-1',
      reason: 'timeout',
      result: { content: null, success: false, toolCallId: 'call-1' },
    });
  });

  it('leaves an operation that is no longer parked alone', async () => {
    const deps = baseDeps();
    deps.coordinator.loadAgentState.mockResolvedValue({ status: 'running' });
    const callback = captureCallback(deps);

    await callback('op-2', 0, undefined, { expireShell: true, toolCallId: 'call-2' });

    expect(mockedCompleteDeferredShell).not.toHaveBeenCalled();
    expect(deps.executeStep).not.toHaveBeenCalled();
  });
});
