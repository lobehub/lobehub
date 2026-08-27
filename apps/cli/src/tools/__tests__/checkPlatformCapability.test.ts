import { resolveRemotePlatformCommand } from '@lobechat/heterogeneous-agents/scanHost';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPlatformCapability } from '../checkPlatformCapability';

vi.mock('@lobechat/heterogeneous-agents/scanHost', () => ({
  resolveRemotePlatformCommand: vi.fn(),
}));

const resolveRemotePlatformCommandMock = vi.mocked(resolveRemotePlatformCommand);

describe('checkPlatformCapability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the shared resolver result instead of probing a bare command', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({
      available: true,
      path: '/Users/x/.openclaw/bin/openclaw',
      resolvedPathEnv: '/opt/homebrew/bin:/usr/bin:/bin',
      version: '2026.1.29',
    });

    await expect(checkPlatformCapability({ platform: 'openclaw' })).resolves.toEqual({
      available: true,
      version: '2026.1.29',
    });
    expect(resolveRemotePlatformCommandMock).toHaveBeenCalledWith('openclaw');
  });

  it('preserves the shared validation failure reason', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({
      available: false,
      error: 'hermes was not found or failed validation',
    });

    await expect(checkPlatformCapability({ platform: 'hermes' })).resolves.toEqual({
      available: false,
      reason: 'hermes was not found or failed validation',
    });
  });

  it('rejects an unsupported runtime platform', async () => {
    resolveRemotePlatformCommandMock.mockResolvedValue({
      available: false,
      error: 'Unknown platform: future-platform',
    });

    await expect(checkPlatformCapability({ platform: 'future-platform' })).resolves.toEqual({
      available: false,
      reason: 'Unknown platform: future-platform',
    });
    expect(resolveRemotePlatformCommandMock).toHaveBeenCalledWith('future-platform');
  });
});
