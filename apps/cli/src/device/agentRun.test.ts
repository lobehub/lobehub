import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import os from 'node:os';

import { HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV } from '@lobechat/heterogeneous-agents/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroAgentRun } from './agentRun';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
const { saveTaskMock, getTaskMock, removeTaskMock } = vi.hoisted(() => ({
  getTaskMock: vi.fn(),
  removeTaskMock: vi.fn(),
  saveTaskMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../daemon/taskRegistry', () => ({
  getTask: getTaskMock,
  removeTask: removeTaskMock,
  saveTask: saveTaskMock,
}));
// `resolveHeteroSpawnCwd` stats the candidate directories; treat every path as
// an existing directory unless a test says otherwise.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, statSync: vi.fn() };
});

const asDirectory = { isDirectory: () => true } as ReturnType<typeof statSync>;
const mockMissingDir = (missing: string) =>
  vi
    .mocked(statSync)
    .mockImplementation((candidate) => (candidate === missing ? undefined : asDirectory) as never);

const makeFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  };
  child.stdin = { end: vi.fn(), write: vi.fn() };
  return child;
};

const baseParams = {
  agentType: 'claudeCode',
  assistantMessageId: 'asst',
  jwt: 'jwt',
  operationId: 'op',
  prompt: 'hi',
  serverUrl: 'https://app.lobehub.com',
  topicId: 'tpc',
};

describe('spawnHeteroAgentRun', () => {
  beforeEach(() => {
    vi.mocked(statSync).mockReturnValue(asDirectory);
    saveTaskMock.mockReset();
    getTaskMock.mockReset();
    removeTaskMock.mockReset();
  });

  afterEach(() => {
    spawnMock.mockReset();
  });

  it('spawns `lh hetero exec` in server-ingest mode via the current CLI entry', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      cwd: '/work/dir',
      jwt: 'jwt-token',
      operationId: 'op-1',
      topicId: 'tpc-1',
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawnMock.mock.calls[0];

    expect(bin).toBe(process.execPath);
    expect(args).toEqual([
      ...process.execArgv,
      process.argv[1],
      'hetero',
      'exec',
      '--type',
      'claudeCode',
      '--operation-id',
      'op-1',
      '--topic',
      'tpc-1',
      '--render',
      'none',
      '--input-json',
      '-',
      '--cwd',
      '/work/dir',
    ]);
    expect(opts).toMatchObject({
      cwd: '/work/dir',
      detached: true,
      env: expect.objectContaining({
        [HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV]: '1',
        LOBEHUB_ASSISTANT_MESSAGE_ID: 'asst',
        LOBEHUB_JWT: 'jwt-token',
        LOBEHUB_SERVER: 'https://app.lobehub.com',
      }),
      windowsHide: true,
    });
    expect(opts.env).not.toHaveProperty('LOBEHUB_WORKSPACE_ID');

    // stdin is only written after the child actually spawns.
    expect(child.stdin.write).not.toHaveBeenCalled();
    child.emit('spawn');

    await expect(ackPromise).resolves.toEqual({ status: 'accepted' });
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify('hi'));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('starts the wrapper from home so its inner preflight can report a missing cwd', async () => {
    const missingCwd = '/missing';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    mockMissingDir(missingCwd);

    const ackPromise = spawnHeteroAgentRun({ ...baseParams, cwd: missingCwd });

    const [, args, options] = spawnMock.mock.calls[0];
    const cwdArgIndex = args.indexOf('--cwd');
    expect(options.cwd).toBe(os.homedir());
    expect(args[cwdArgIndex + 1]).toBe(missingCwd);
    child.emit('spawn');

    await expect(ackPromise).resolves.toEqual({ status: 'accepted' });
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify('hi'));
  });

  it('rejects when the wrapper process still fails to spawn from the fallback cwd', async () => {
    const missingCwd = '/missing';
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    mockMissingDir(missingCwd);

    const ackPromise = spawnHeteroAgentRun({ ...baseParams, cwd: missingCwd });
    child.emit('error', new Error('spawn EACCES'));

    await expect(ackPromise).resolves.toEqual({ reason: 'spawn EACCES', status: 'rejected' });
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it('forwards the topic workspace as LOBEHUB_WORKSPACE_ID for ingest', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      workspaceId: 'ws-lobehub',
    });
    child.emit('spawn');
    await ackPromise;

    const [, , opts] = spawnMock.mock.calls[0];
    expect(opts.env).toEqual(
      expect.objectContaining({
        LOBEHUB_WORKSPACE_ID: 'ws-lobehub',
      }),
    );
  });

  it('appends --resume when resuming a session', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    void spawnHeteroAgentRun({ ...baseParams, resumeSessionId: 'sess-9' });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-9');
  });

  it('forwards resolved args to lh hetero exec', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    void spawnHeteroAgentRun({
      ...baseParams,
      args: ['--model', 'opus', '--effort', 'high'],
    });

    const [, args] = spawnMock.mock.calls[0];
    expect(args.slice(-4)).toEqual(['--model', 'opus', '--effort', 'high']);
  });

  it('sends a content-block array to stdin when systemContext is provided', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      prompt: 'do it',
      systemContext: 'workspace rules',
    });
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: 'workspace rules', type: 'text' },
        { text: 'do it', type: 'text' },
      ]),
    );
  });

  it('sends recovery history only in the resume fallback prompt', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      prompt: 'continue',
      resumeFallbackSystemContext: 'workspace rules\n\nprevious conversation',
      resumeSessionId: 'session-1',
      systemContext: 'workspace rules',
    });
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({
        content: [
          { text: 'workspace rules', type: 'text' },
          { text: 'continue', type: 'text' },
        ],
        resumeFallback: [
          { text: 'workspace rules\n\nprevious conversation', type: 'text' },
          { text: 'continue', type: 'text' },
        ],
      }),
    );
  });

  it('appends image blocks to stdin when imageList is provided', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      imageList: [{ id: 'file-1', url: 'https://signed/a.png' }],
      prompt: 'look at this',
    });
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: 'look at this', type: 'text' },
        { source: { id: 'file-1', type: 'url', url: 'https://signed/a.png' }, type: 'image' },
      ]),
    );
  });

  // ─── Cancel regression: process registration ───
  // The connect daemon must register the spawned CLI child into the task
  // registry so `cancelHeteroTask` dispatched from the server can resolve it
  // by operationId and signal the whole process group.

  it('registers the spawned child PID into the task registry on spawn', async () => {
    const child = makeFakeChild();
    Object.defineProperty(child, 'pid', { value: 12345 });
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      agentType: 'devin',
      operationId: 'op-cancel-reg',
      topicId: 'tpc-cancel-reg',
      workspaceId: 'ws-reg',
    });
    child.emit('spawn');
    await ackPromise;

    expect(saveTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'devin',
        operationId: 'op-cancel-reg',
        pid: 12345,
        taskId: 'op-cancel-reg',
        topicId: 'tpc-cancel-reg',
        workspaceId: 'ws-reg',
      }),
    );
  });

  it('removes the task registry entry on child exit when the PID still matches', async () => {
    const child = makeFakeChild();
    Object.defineProperty(child, 'pid', { value: 9988 });
    spawnMock.mockReturnValue(child);
    // The exit handler checks getTask to guard against stale exits clearing a
    // newer entry — simulate the registry still owning this PID.
    getTaskMock.mockReturnValue({ pid: 9988 });

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      operationId: 'op-exit-cleanup',
    });
    child.emit('spawn');
    await ackPromise;

    child.emit('exit', 0, null);

    expect(getTaskMock).toHaveBeenCalledWith('op-exit-cleanup');
    expect(removeTaskMock).toHaveBeenCalledWith('op-exit-cleanup');
  });

  it('does not remove the registry entry on exit when a newer PID replaced it', async () => {
    const child = makeFakeChild();
    Object.defineProperty(child, 'pid', { value: 7777 });
    spawnMock.mockReturnValue(child);
    // A newer run reused the same operationId with a different PID.
    getTaskMock.mockReturnValue({ pid: 8888 });

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      operationId: 'op-stale-exit',
    });
    child.emit('spawn');
    await ackPromise;

    child.emit('exit', 0, null);

    expect(removeTaskMock).not.toHaveBeenCalled();
  });
});
