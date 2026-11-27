import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import { SandboxMiddlewareService } from '../service';
import type { SandboxProvider, SandboxServiceOptions } from '../types';

const redis = vi.hoisted(() => ({
  recordAgentActivity: vi.fn(),
  recordAlive: vi.fn(),
  recordRecycled: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({ redisService: { ephemeralSandbox: redis } }));

const serviceWith = (
  result: SandboxCallToolResult,
  options: Partial<SandboxServiceOptions> = {},
) => {
  const callTool = vi.fn(async () => result);
  const provider = {
    callTool,
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    exportFileToUploadUrl: vi.fn(),
    kind: 'market',
  } satisfies SandboxProvider;

  return {
    callTool,
    service: new SandboxMiddlewareService(provider, {
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
      ...options,
    }),
  };
};

const ok: SandboxCallToolResult = { result: { stdout: '' }, success: true };

describe('SandboxMiddlewareService — temporary sandbox activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the agent's use of its temporary sandbox", async () => {
    const { service } = serviceWith(ok);

    await service.callTool('writeLocalFile', { content: 'x', path: 'a.txt' });

    expect(redis.recordAgentActivity).toHaveBeenCalledWith('user-1', 'topic-1', {
      keepAliveUntil: undefined,
    });
    expect(redis.recordRecycled).not.toHaveBeenCalled();
  });

  it('records the keep-alive the execution plane grants a long-running agent launch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const { service } = serviceWith(ok);

    await service.callTool('runCommand', {
      background: true,
      command: 'cd /workspace && lh hetero exec --type claude-code',
    });

    expect(redis.recordAgentActivity).toHaveBeenCalledWith('user-1', 'topic-1', {
      keepAliveUntil: 1_800_000_000_000 + 4 * 60 * 60 * 1000,
    });
    vi.useRealTimers();
  });

  it('counts an agent call that landed in a new sandbox as the agent working there', async () => {
    const { service } = serviceWith({ ...ok, sessionExpiredAndRecreated: true });

    await service.callTool('runCommand', { command: 'ls' });

    expect(redis.recordAgentActivity).toHaveBeenCalledWith('user-1', 'topic-1', {
      keepAliveUntil: undefined,
    });
    expect(redis.recordRecycled).not.toHaveBeenCalled();
  });

  it("marks the agent's files gone when a viewer finds the session recreated", async () => {
    const { service } = serviceWith(
      { ...ok, sessionExpiredAndRecreated: true },
      { activity: 'viewer' },
    );

    await service.callTool('readLocalFile', { path: 'notes.md' });

    expect(redis.recordRecycled).toHaveBeenCalledWith('user-1', 'topic-1');
    expect(redis.recordAgentActivity).not.toHaveBeenCalled();
  });

  it('marks the files gone when a viewer read failed in a recreated session', async () => {
    // The agent's file is not in the new, empty sandbox, so the read fails.
    const { service } = serviceWith(
      {
        error: { message: 'ENOENT' },
        result: null,
        sessionExpiredAndRecreated: true,
        success: false,
      },
      { activity: 'viewer' },
    );

    await service.callTool('readLocalFile', { path: 'notes.md' });

    expect(redis.recordRecycled).toHaveBeenCalledWith('user-1', 'topic-1');
  });

  it('only marks the sandbox alive for a viewer that reached it', async () => {
    const { service } = serviceWith(ok, { activity: 'viewer' });

    await service.callTool('readLocalFile', { path: 'notes.md' });

    expect(redis.recordAlive).toHaveBeenCalledWith('user-1', 'topic-1');
    expect(redis.recordAgentActivity).not.toHaveBeenCalled();
  });

  it('records nothing for a folder on the drive, or a call that failed', async () => {
    await serviceWith(ok, { sandboxMode: 'drive' }).service.callTool('runCommand', {
      command: 'ls',
    });
    await serviceWith({ error: { message: 'x' }, result: null, success: false }).service.callTool(
      'runCommand',
      { command: 'ls' },
    );

    expect(redis.recordAgentActivity).not.toHaveBeenCalled();
    expect(redis.recordAlive).not.toHaveBeenCalled();
  });

  it('never fails the call when recording does', async () => {
    redis.recordAgentActivity.mockRejectedValueOnce(new Error('redis down'));
    const { service } = serviceWith(ok);

    await expect(service.callTool('runCommand', { command: 'ls' })).resolves.toMatchObject({
      success: true,
    });
  });

  it('does not prepare the sandbox for work on a viewer read', async () => {
    const { callTool, service } = serviceWith(ok, {
      activity: 'viewer',
      sandboxInitialization: {
        environmentId: 'env-1',
        name: 'Hello',
        sources: [{ url: 'https://github.com/octocat/Hello-World' }],
      },
    });

    await service.callTool('runCommand', { command: 'ls' });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('runCommand', { command: 'ls' });
  });

  it('still prepares a folder on the drive on a viewer read, as before', async () => {
    const { callTool, service } = serviceWith(ok, {
      activity: 'viewer',
      sandboxInitialization: {
        environmentId: 'env-1',
        name: 'Hello',
        sources: [{ url: 'https://github.com/octocat/Hello-World' }],
      },
      sandboxMode: 'drive',
    });

    await service.callTool('runCommand', { command: 'ls' });

    expect(callTool).toHaveBeenCalledTimes(2);
    const [, firstParams] = callTool.mock.calls[0] as unknown as [string, { command: string }];
    expect(firstParams.command).toContain('git clone');
  });
});
