import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeTask, saveTask } from '../../daemon/taskRegistry';
import { runHeteroTask } from '../heteroTask';

// ─── Mocks ───

const spawnMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
}));

// task registry — use real implementation backed by a temporary in-memory map
const taskStore: Record<string, any> = {};
vi.mock('../../daemon/taskRegistry', () => ({
  getTask: vi.fn((id: string) => taskStore[id]),
  listTasks: vi.fn(() => Object.values(taskStore)),
  removeTask: vi.fn((id: string) => {
    delete taskStore[id];
  }),
  saveTask: vi.fn((entry: any) => {
    taskStore[entry.taskId] = entry;
  }),
}));

vi.mock('../../api/client', () => ({
  getTrpcClient: vi.fn().mockResolvedValue({
    agentNotify: {
      notify: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  }),
}));

vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ─── Helpers ───

function makeMockChild(pid = 9999) {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  return {
    on: vi.fn((event: string, cb: (...a: any[]) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    pid,
    unref: vi.fn(),
    _emit: (event: string, ...args: any[]) => listeners[event]?.forEach((cb) => cb(...args)),
  };
}

// ─── Tests ───

describe('runHeteroTask (openclaw)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear task store
    for (const key of Object.keys(taskStore)) delete taskStore[key];
    execFileSyncMock.mockReturnValue('/usr/local/bin/lh\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('always injects buildNotifyProtocol into the prompt regardless of session history', async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'what time is it',
      taskId: 'task-1',
      topicId: 'topic-1',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const msgIdx = spawnArgs.indexOf('--message');
    const messageArg = spawnArgs[msgIdx + 1];

    expect(messageArg).toContain('what time is it');
    expect(messageArg).toContain('lh notify');
    expect(messageArg).toContain('MSG_ID');
  });

  it('always injects protocol even on the second turn of the same session', async () => {
    const child1 = makeMockChild(1111);
    const child2 = makeMockChild(2222);
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    // First turn
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'hello',
      taskId: 'task-1',
      topicId: 'topic-1',
    });
    // Simulate process exit so task is removed
    child1._emit('close', 0, null);

    // Second turn (same topicId)
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-2',
      prompt: 'follow up',
      taskId: 'task-2',
      topicId: 'topic-1',
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const call of spawnMock.mock.calls) {
      const args = call[1] as string[];
      const msg = args[args.indexOf('--message') + 1];
      expect(msg).toContain('lh notify');
    }
  });

  it('kills an existing concurrent process for the same topicId before spawning', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const child1 = makeMockChild(1111);
    spawnMock.mockReturnValueOnce(child1);
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'msg1',
      taskId: 'task-1',
      topicId: 'topic-same',
    });
    // task-1 is still "running" (close not fired)

    const child2 = makeMockChild(2222);
    spawnMock.mockReturnValueOnce(child2);
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-2',
      prompt: 'msg2',
      taskId: 'task-2',
      topicId: 'topic-same',
    });

    expect(killSpy).toHaveBeenCalledWith(1111, 'SIGTERM');
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('does not kill processes for a different topicId', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const child1 = makeMockChild(3333);
    spawnMock.mockReturnValueOnce(child1);
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'a',
      taskId: 'task-a',
      topicId: 'topic-A',
    });

    const child2 = makeMockChild(4444);
    spawnMock.mockReturnValueOnce(child2);
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-2',
      prompt: 'b',
      taskId: 'task-b',
      topicId: 'topic-B',
    });

    expect(killSpy).not.toHaveBeenCalled();
  });

  it('saves task entry with correct fields after spawn', async () => {
    const child = makeMockChild(5555);
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentId: 'agent-1',
      agentType: 'openclaw',
      operationId: 'op-x',
      prompt: 'test',
      taskId: 'task-x',
      topicId: 'topic-x',
    });

    expect(saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'openclaw',
        pid: 5555,
        taskId: 'task-x',
        topicId: 'topic-x',
      }),
    );
  });

  it('passes --session-id and --agent args to openclaw', async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'hello',
      taskId: 'task-1',
      topicId: 'my-topic-id',
    });

    const [, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
    expect(spawnArgs).toContain('--session-id');
    expect(spawnArgs[spawnArgs.indexOf('--session-id') + 1]).toBe('my-topic-id');
    expect(spawnArgs).toContain('--agent');
    expect(spawnArgs).toContain('--local');
  });

  it('removes task and ignores already-exited process when killing concurrent task', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('No such process');
    });

    const child1 = makeMockChild(7777);
    spawnMock.mockReturnValueOnce(child1);
    await runHeteroTask({
      agentType: 'openclaw',
      operationId: 'op-1',
      prompt: 'msg1',
      taskId: 'task-1',
      topicId: 'topic-gone',
    });

    const child2 = makeMockChild(8888);
    spawnMock.mockReturnValueOnce(child2);
    // Should not throw even though kill fails
    await expect(
      runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-2',
        prompt: 'msg2',
        taskId: 'task-2',
        topicId: 'topic-gone',
      }),
    ).resolves.not.toThrow();

    expect(removeTask).toHaveBeenCalledWith('task-1');
    killSpy.mockRestore();
  });
});
