import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import os from 'node:os';

import {
  HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV,
  lobeHubCliGuide,
} from '@lobechat/heterogeneous-agents/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroAgentRun } from './agentRun';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
const { saveTaskMock, getTaskMock, removeTaskMock } = vi.hoisted(() => ({
  getTaskMock: vi.fn(),
  removeTaskMock: vi.fn(),
  saveTaskMock: vi.fn(),
}));
const { identityMock, hasLoginMock } = vi.hoisted(() => ({
  hasLoginMock: vi.fn(),
  identityMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
// The device's own Claude Code login, read for account routing.
vi.mock('@lobechat/heterogeneous-agents/quota-sampler', () => ({
  hasClaudeCodeLogin: hasLoginMock,
  readClaudeCodeIdentity: identityMock,
}));
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not hand the dispatched run an ancestor agent run identity or JWT file', () => {
    // `lh connect` running inside a Codex shell: the CLI prefers LOBEHUB_JWT_FILE over
    // LOBEHUB_JWT, so an inherited file would replace this dispatch's fresh token.
    vi.stubEnv('LOBEHUB_JWT_FILE', '/tmp/ancestor/jwt');
    vi.stubEnv('LOBEHUB_TASK_ID', 'ancestor-task');
    spawnMock.mockReturnValue(makeFakeChild());

    void spawnHeteroAgentRun({ ...baseParams, jwt: 'fresh-token' });

    const { env } = spawnMock.mock.calls[0][2];
    expect(env.LOBEHUB_JWT).toBe('fresh-token');
    expect(env).not.toHaveProperty('LOBEHUB_JWT_FILE');
    expect(env).not.toHaveProperty('LOBEHUB_TASK_ID');
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
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: lobeHubCliGuide, type: 'text' },
        { text: 'hi', type: 'text' },
      ]),
    );
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'agt_dispatched'])(
    'replaces the launcher conversation context with dispatched agent %s',
    async (agentId) => {
      for (const key of ['AGENT', 'TASK', 'OPERATION', 'TOPIC', 'WORKSPACE', 'ASSISTANT_MESSAGE']) {
        vi.stubEnv(`LOBEHUB_${key}_ID`, `launcher-${key}`);
      }
      const child = makeFakeChild();
      spawnMock.mockReturnValue(child);

      const ack = spawnHeteroAgentRun({ ...baseParams, agentId, assistantMessageId: undefined });
      const env = spawnMock.mock.calls[0][2].env;
      expect(env.LOBEHUB_OPERATION_ID).toBe('op');
      expect(env.LOBEHUB_TOPIC_ID).toBe('tpc');
      expect(env.LOBEHUB_AGENT_ID).toBe(agentId);
      for (const key of ['TASK', 'WORKSPACE', 'ASSISTANT_MESSAGE']) {
        expect(env).not.toHaveProperty(`LOBEHUB_${key}_ID`);
      }
      child.emit('spawn');
      await expect(ack).resolves.toEqual({ status: 'accepted' });
    },
  );

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
    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: lobeHubCliGuide, type: 'text' },
        { text: 'hi', type: 'text' },
      ]),
    );
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
        { text: lobeHubCliGuide, type: 'text' },
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
          // Resuming, so the primary prompt above skips the CLI introduction the
          // first turn already delivered — but the fallback starts a fresh
          // session, which has to be told again.
          { text: lobeHubCliGuide, type: 'text' },
          { text: 'continue', type: 'text' },
        ],
      }),
    );
  });

  it('skips the CLI introduction when it resumes an existing session', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({ ...baseParams, resumeSessionId: 'session-1' });
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify('hi'));
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
        { text: lobeHubCliGuide, type: 'text' },
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
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('process group exited'), { code: 'ESRCH' });
    });
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

  it('retains cancellation identity when descendants outlive the wrapper', async () => {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = Object.assign(makeFakeChild(), { pid: 9988 });
    spawnMock.mockReturnValue(child);
    getTaskMock.mockReturnValue({ pid: 9988 });
    const ack = spawnHeteroAgentRun({ ...baseParams, operationId: 'op-live-descendant' });
    child.emit('spawn');
    await ack;
    child.emit('exit', 0, null);
    expect(removeTaskMock).not.toHaveBeenCalled();
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

describe('spawnHeteroAgentRun Claude Code account routing', () => {
  beforeEach(() => {
    vi.mocked(statSync).mockReturnValue(asDirectory);
    identityMock.mockResolvedValue({ externalAccountId: 'acc-default' });
    hasLoginMock.mockResolvedValue(true);
  });

  afterEach(() => {
    spawnMock.mockReset();
  });

  it('rejects a run pinned to an account this device is not signed in to', async () => {
    const result = await spawnHeteroAgentRun({
      ...baseParams,
      claudeAccountRouting: {
        candidates: [{ externalAccountId: 'acc-other', name: 'other@example.com' }],
        mode: 'pinned',
      },
    });

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('other@example.com');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runs a run pinned to the account this device is signed in to', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const pending = spawnHeteroAgentRun({
      ...baseParams,
      claudeAccountRouting: { candidates: [{ externalAccountId: 'acc-default' }], mode: 'pinned' },
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('spawn');

    expect(await pending).toEqual({ status: 'accepted' });
  });
});
