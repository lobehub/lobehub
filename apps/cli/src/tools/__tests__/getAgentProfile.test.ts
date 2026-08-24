import { resolveRemotePlatformRuntime } from '@lobechat/heterogeneous-agents/scanHost';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentProfile } from '../getAgentProfile';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '# Soul\nA careful systems engineer.'),
  },
}));

vi.mock('@lobechat/heterogeneous-agents/scanHost', () => ({
  resolveRemotePlatformRuntime: vi.fn(),
}));

const executeMock = vi.fn();
const resolveRemotePlatformRuntimeMock = vi.mocked(resolveRemotePlatformRuntime);

const queueExecResult = (stdout: string) => {
  executeMock.mockResolvedValueOnce({ stderr: '', stdout });
};

describe('getAgentProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRemotePlatformRuntimeMock.mockResolvedValue({
      available: true,
      execute: executeMock,
      prepareSpawn: vi.fn(),
    });
  });

  it('uses the shared OpenClaw execution runtime', async () => {
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
    expect(resolveRemotePlatformRuntimeMock).toHaveBeenCalledWith('openclaw');
    expect(executeMock).toHaveBeenCalledWith(['agents', 'list', '--json'], { timeout: 5000 });
  });

  it('uses one shared Hermes runtime for both profile probes', async () => {
    queueExecResult('  ◆default\n');
    queueExecResult('Path: ~/.hermes/profiles/default\n');

    await expect(getAgentProfile({ platform: 'hermes' })).resolves.toEqual({
      avatar: '⚡',
      description: 'A careful systems engineer.',
      title: 'default',
    });
    expect(resolveRemotePlatformRuntimeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenNthCalledWith(1, ['profile', 'list'], { timeout: 5000 });
    expect(executeMock).toHaveBeenNthCalledWith(2, ['profile', 'show', 'default'], {
      timeout: 5000,
    });
  });

  it('does not run a bare command when resolution fails', async () => {
    resolveRemotePlatformRuntimeMock.mockResolvedValue({
      available: false,
      error: 'openclaw was not found or failed validation',
    });

    await expect(getAgentProfile({ platform: 'openclaw' })).resolves.toEqual({});
    expect(executeMock).not.toHaveBeenCalled();
  });
});
