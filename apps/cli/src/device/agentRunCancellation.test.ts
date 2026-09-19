import type * as ChildProcessModule from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeToolCall } from '../tools';
import { spawnHeteroAgentRun } from './agentRun';

const { getTaskMock, removeTaskMock, saveTaskMock, spawnMock } = vi.hoisted(() => ({
  getTaskMock: vi.fn(),
  removeTaskMock: vi.fn(),
  saveTaskMock: vi.fn(),
  spawnMock: vi.fn(),
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn: spawnMock,
}));
vi.mock('../daemon/taskRegistry', () => ({
  getTask: getTaskMock,
  removeTask: removeTaskMock,
  saveTask: saveTaskMock,
}));

const children: EventEmitter[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.emit('close', 0, null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  getTaskMock.mockReset();
  removeTaskMock.mockReset();
  saveTaskMock.mockReset();
  spawnMock.mockReset();
});

async function dispatch(operationId: string) {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn().mockReturnValue(true),
    pid: 12345,
    stdin: { end: vi.fn(), write: vi.fn() },
  });
  children.push(child);
  spawnMock.mockReturnValue(child as unknown as ChildProcess);
  const ack = spawnHeteroAgentRun({
    agentType: 'kimi-code',
    jwt: 'fixture',
    operationId,
    prompt: 'fixture',
    serverUrl: 'http://localhost',
    topicId: 'fixture-topic',
  });
  child.emit('spawn');
  await ack;
  return child;
}

describe('gateway-dispatched CLI agent cancellation', () => {
  it('prioritizes persisted process-group cancellation for a live dispatched wrapper', async () => {
    const child = await dispatch('cancel-live-group');
    getTaskMock.mockReturnValue({
      agentType: 'kimi-code',
      operationId: 'cancel-live-group',
      pid: 12345,
      startedAt: new Date().toISOString(),
      taskId: 'cancel-live-group',
      topicId: 'fixture-topic',
    });
    let groupAlive = true;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== -12345) return true;
      if (signal === 'SIGINT') {
        groupAlive = false;
        return true;
      }
      if (signal === 0 && !groupAlive) {
        throw Object.assign(new Error('process group exited'), { code: 'ESRCH' });
      }
      return true;
    });

    await expect(
      executeToolCall('cancelHeteroTask', JSON.stringify({ taskId: 'cancel-live-group' })),
    ).resolves.toMatchObject({
      success: true,
      state: { exited: true, pid: 12345 },
    });
    expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGINT');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('waits for the dispatched wrapper to close and returns structured exit confirmation', async () => {
    const child = await dispatch('cancel-live');
    let settled = false;
    const result = executeToolCall(
      'cancelHeteroTask',
      JSON.stringify({ taskId: 'cancel-live' }),
    ).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGINT'));
    expect(settled).toBe(false);
    child.emit('close', 0, 'SIGINT');
    await expect(result).resolves.toMatchObject({
      success: true,
      state: { exited: true, pid: 12345 },
    });
    await expect(
      executeToolCall('cancelHeteroTask', JSON.stringify({ taskId: 'cancel-live' })),
    ).resolves.toMatchObject({ success: true, state: { exited: true } });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('does not report a live unresponsive writer as successfully canceled', async () => {
    vi.useFakeTimers();
    const child = await dispatch('cancel-timeout');
    const result = executeToolCall(
      'cancelHeteroTask',
      JSON.stringify({ taskId: 'cancel-timeout' }),
    );
    await vi.advanceTimersByTimeAsync(4100);
    await expect(result).resolves.toMatchObject({ success: false, state: { exited: false } });
    expect(child.kill.mock.calls).toEqual([['SIGINT'], ['SIGINT']]);
  });

  it('does not wrap a missing operation in a successful gateway response', async () => {
    await expect(
      executeToolCall('cancelHeteroTask', JSON.stringify({ taskId: 'not-dispatched' })),
    ).resolves.toMatchObject({ success: false, state: { success: false } });
  });
});
