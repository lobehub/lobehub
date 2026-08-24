import { execFile } from 'node:child_process';

import { resolveRemotePlatformCommand } from '@lobechat/heterogeneous-agents/scanHost';
import { resolveCliSpawnPlan } from '@lobechat/heterogeneous-agents/spawn';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentProfile } from '../getAgentProfile';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '# Soul\nA careful systems engineer.'),
  },
}));

vi.mock('@lobechat/heterogeneous-agents/scanHost', () => ({
  resolveRemotePlatformCommand: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', () => ({
  resolveCliSpawnPlan: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);
const resolveCliSpawnPlanMock = vi.mocked(resolveCliSpawnPlan);
const resolveRemotePlatformCommandMock = vi.mocked(resolveRemotePlatformCommand);

const queueExecResult = (stdout: string) => {
  execFileMock.mockImplementationOnce(((
    _command: string,
    _args: string[],
    _options: object,
    callback: (error: null, result: { stderr: string; stdout: string }) => void,
  ) => {
    callback(null, { stderr: '', stdout });
    return {};
  }) as never);
};

describe('getAgentProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCliSpawnPlanMock.mockImplementation(async (command, args) => ({ args, command }));
  });

  it('uses the resolved OpenClaw executable and recovered PATH', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({
      available: true,
      path: '/Users/x/.openclaw/bin/openclaw',
      resolvedPathEnv: '/opt/homebrew/bin:/usr/bin:/bin',
    });
    queueExecResult(
      JSON.stringify([
        {
          id: 'main',
          identityEmoji: '🦞',
          identityName: 'Claw',
          isDefault: true,
        },
      ]),
    );

    await expect(getAgentProfile({ platform: 'openclaw' })).resolves.toEqual({
      avatar: '🦞',
      description: undefined,
      title: 'Claw',
    });
    expect(resolveCliSpawnPlanMock).toHaveBeenCalledWith(
      '/Users/x/.openclaw/bin/openclaw',
      ['agents', 'list', '--json'],
      expect.objectContaining({ PATH: '/opt/homebrew/bin:/usr/bin:/bin' }),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      '/Users/x/.openclaw/bin/openclaw',
      ['agents', 'list', '--json'],
      expect.objectContaining({
        env: expect.objectContaining({ PATH: '/opt/homebrew/bin:/usr/bin:/bin' }),
      }),
      expect.any(Function),
    );
  });

  it('uses one resolved Hermes executable and PATH for both profile probes', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({
      available: true,
      path: '/Users/x/.local/bin/hermes',
      resolvedPathEnv: '/Users/x/.local/bin:/opt/homebrew/bin:/usr/bin',
    });
    queueExecResult('  ◆default\n');
    queueExecResult('Path: ~/.hermes/profiles/default\n');

    await expect(getAgentProfile({ platform: 'hermes' })).resolves.toEqual({
      avatar: '⚡',
      description: 'A careful systems engineer.',
      title: 'default',
    });
    expect(resolveRemotePlatformCommandMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    for (const call of execFileMock.mock.calls) {
      expect((call[2] as { env: NodeJS.ProcessEnv }).env.PATH).toBe(
        '/Users/x/.local/bin:/opt/homebrew/bin:/usr/bin',
      );
    }
  });

  it('does not run a bare command when resolution fails', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({ available: false });

    await expect(getAgentProfile({ platform: 'openclaw' })).resolves.toEqual({});
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
