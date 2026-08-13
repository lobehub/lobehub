import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../api/client';
import { removeTask, saveTask } from '../../daemon/taskRegistry';
import { runHeteroTask } from '../heteroTask';

// ─── Mocks ───

const spawnMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());
const fsState = vi.hoisted(() => ({ content: undefined as string | undefined }));
const notifyMutateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => {
      if (fsState.content === undefined) throw new Error('File not found');
      return fsState.content;
    }),
    writeFileSync: vi.fn((_path: string, content: string) => {
      fsState.content = content;
    }),
  },
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
      notify: { mutate: notifyMutateMock },
    },
  }),
}));

const getTrpcClientMock = vi.mocked(getTrpcClient);

vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ─── Helpers ───

function resetTrpcClientMock() {
  notifyMutateMock.mockResolvedValue(undefined);
  getTrpcClientMock.mockImplementation(
    () =>
      Promise.resolve({
        agentNotify: { notify: { mutate: notifyMutateMock } },
      }) as ReturnType<typeof getTrpcClient>,
  );
}

function makeMockStream() {
  const listeners: Array<(chunk: Buffer) => void> = [];

  return {
    on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => listeners.push(cb)),
    _emit: (content: string) => listeners.forEach((cb) => cb(Buffer.from(content))),
  };
}

function makeMockChild(pid = 9999) {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  return {
    on: vi.fn((event: string, cb: (...a: any[]) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    pid,
    stderr: makeMockStream(),
    stdout: makeMockStream(),
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
    resetTrpcClientMock();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it.each([
    {
      environmentAgentId: 'ops-default',
      expectedAgentId: 'researcher',
      platformAgentId: ' researcher ',
    },
    {
      environmentAgentId: 'ops-default',
      expectedAgentId: 'ops-default',
      platformAgentId: undefined,
    },
    {
      environmentAgentId: 'ops-default',
      expectedAgentId: 'ops-default',
      platformAgentId: '   ',
    },
    { environmentAgentId: '', expectedAgentId: 'main', platformAgentId: undefined },
  ])(
    'selects OpenClaw agent $expectedAgentId from platform config before environment fallback',
    async ({ environmentAgentId, expectedAgentId, platformAgentId }) => {
      vi.stubEnv('OPENCLAW_AGENT_ID', environmentAgentId);
      spawnMock.mockReturnValue(makeMockChild());

      await runHeteroTask({
        agentType: 'openclaw',
        operationId: 'op-agent-selection',
        platformAgentId,
        prompt: 'hello',
        taskId: 'task-agent-selection',
        topicId: 'topic-agent-selection',
      });

      const [, spawnArgs] = spawnMock.mock.calls[0] as [string, string[]];
      expect(spawnArgs[spawnArgs.indexOf('--agent') + 1]).toBe(expectedAgentId);
    },
  );

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

  it('threads workspaceId into the saved task entry and the spawned child env', async () => {
    const child = makeMockChild(6666);
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentId: 'agent-ws',
      agentType: 'openclaw',
      operationId: 'op-ws',
      prompt: 'workspace dispatch',
      taskId: 'task-ws',
      topicId: 'topic-ws',
      workspaceId: 'ws-42',
    });

    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-42' }));

    const [, , spawnOpts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(spawnOpts.env.LOBEHUB_WORKSPACE_ID).toBe('ws-42');
  });

  it('passes workspaceId to getTrpcClient when the close handler auto-notifies', async () => {
    const child = makeMockChild(7777);
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentId: 'agent-ws',
      agentType: 'openclaw',
      operationId: 'op-ws-2',
      prompt: 'ws prompt',
      taskId: 'task-ws-2',
      topicId: 'topic-ws-2',
      workspaceId: 'ws-99',
    });

    getTrpcClientMock.mockClear();
    // Abnormal exit triggers sendAutoNotify + sendDoneSignal — both must scope
    // to the dispatching workspace or agentNotify resolves the topic in
    // personal mode and 404s.
    child._emit('close', 1, null);
    // Await microtask drain so the close-handler promise chain settles.
    await new Promise((r) => setImmediate(r));

    expect(getTrpcClientMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of getTrpcClientMock.mock.calls) {
      expect(call[0]).toBe('ws-99');
    }
  });
});

describe('runHeteroTask (hermes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsState.content = undefined;
    for (const key of Object.keys(taskStore)) delete taskStore[key];
    execFileSyncMock.mockReturnValue('/usr/local/bin/lh\n');
    resetTrpcClientMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('relays stdout intact and saves the final session id from stderr', async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentType: 'hermes',
      operationId: 'op-hermes-1',
      prompt: 'hello',
      taskId: 'task-hermes-1',
      topicId: 'topic-hermes',
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { stdio: string[] }];
    expect(spawnOptions.stdio).toEqual(['ignore', 'pipe', 'pipe']);

    child.stdout._emit('session_id: part of the final answer\nHello from Hermes\n');
    child.stderr._emit(
      'Resuming session metadata...\r\nsession_id: session-before-compaction\r\n' +
        'Context compacted\r\nsession_id: session-continuation\r\n',
    );
    child._emit('close', 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'session_id: part of the final answer\nHello from Hermes',
        topicId: 'topic-hermes',
      }),
    );
    expect(JSON.parse(fsState.content!)).toEqual({
      'topic-hermes': 'session-continuation',
    });
  });

  it('resumes the saved session and replaces it with a continuation id', async () => {
    const firstChild = makeMockChild(1001);
    const secondChild = makeMockChild(1002);
    const thirdChild = makeMockChild(1003);
    spawnMock
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild)
      .mockReturnValueOnce(thirdChild);

    await runHeteroTask({
      agentType: 'hermes',
      operationId: 'op-1',
      prompt: 'remember this',
      taskId: 'task-1',
      topicId: 'topic-multi-turn',
    });
    firstChild.stderr._emit('session_id: session-a\n');
    firstChild._emit('close', 0, null);

    await runHeteroTask({
      agentType: 'hermes',
      operationId: 'op-2',
      prompt: 'what did I say?',
      taskId: 'task-2',
      topicId: 'topic-multi-turn',
    });
    expect(spawnMock.mock.calls[1][1]).toEqual([
      'chat',
      '--query',
      'what did I say?',
      '--quiet',
      '--accept-hooks',
      '--resume',
      'session-a',
    ]);

    secondChild.stderr._emit('session_id: session-continuation\n');
    secondChild._emit('close', 0, null);

    await runHeteroTask({
      agentType: 'hermes',
      operationId: 'op-3',
      prompt: 'continue',
      taskId: 'task-3',
      topicId: 'topic-multi-turn',
    });
    expect(spawnMock.mock.calls[2][1]).toContain('session-continuation');
  });

  it('still relays a successful response when stderr has no session id', async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);

    await runHeteroTask({
      agentType: 'hermes',
      operationId: 'op-no-session',
      prompt: 'hello',
      taskId: 'task-no-session',
      topicId: 'topic-no-session',
    });
    child.stdout._emit('Successful response\n');
    child.stderr._emit('Provider diagnostic only\n');
    child._emit('close', 0, null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Successful response' }),
    );
    expect(fsState.content).toBeUndefined();
  });
});
