import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroAgentRun } from './agentRun';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const makeFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  };
  child.stdin = { end: vi.fn(), write: vi.fn() };
  return child;
};

describe('spawnHeteroAgentRun', () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it('spawns `lh hetero exec` in server-ingest mode via the current CLI entry', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    spawnHeteroAgentRun({
      agentType: 'claudeCode',
      cwd: '/work/dir',
      jwt: 'jwt-token',
      operationId: 'op-1',
      prompt: 'hi',
      serverUrl: 'https://app.lobehub.com',
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
      env: expect.objectContaining({
        LOBEHUB_JWT: 'jwt-token',
        LOBEHUB_SERVER: 'https://app.lobehub.com',
      }),
    });

    // Plain prompt is sent to stdin as a JSON string.
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify('hi'));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('appends --resume when resuming a session', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    spawnHeteroAgentRun({
      agentType: 'claudeCode',
      jwt: 'jwt',
      operationId: 'op-2',
      prompt: 'continue',
      resumeSessionId: 'sess-9',
      serverUrl: 'https://app.lobehub.com',
      topicId: 'tpc-2',
    });

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-9');
  });

  it('sends a content-block array to stdin when systemContext is provided', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    spawnHeteroAgentRun({
      agentType: 'claudeCode',
      jwt: 'jwt',
      operationId: 'op-3',
      prompt: 'do it',
      serverUrl: 'https://app.lobehub.com',
      systemContext: 'workspace rules',
      topicId: 'tpc-3',
    });

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: 'workspace rules', type: 'text' },
        { text: 'do it', type: 'text' },
      ]),
    );
  });
});
