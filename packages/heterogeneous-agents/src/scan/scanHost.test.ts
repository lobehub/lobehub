import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeRemotePlatform, resolveRemotePlatformCommand } from './scanHost';

const { detectHeterogeneousCliCommandMock, detectValidatedCommandMock } = vi.hoisted(() => ({
  detectHeterogeneousCliCommandMock: vi.fn(),
  detectValidatedCommandMock: vi.fn(),
}));

vi.mock('../spawn/resolveCliCommand', () => ({
  detectHeterogeneousCliCommand: detectHeterogeneousCliCommandMock,
  detectValidatedCommand: detectValidatedCommandMock,
}));

describe('platform command scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the shared PATH and Windows-shim-aware command resolver', async () => {
    detectValidatedCommandMock.mockResolvedValue({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: 'openclaw 1.2.3',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toEqual({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });
    expect(detectValidatedCommandMock).toHaveBeenCalledWith('openclaw', {
      validateKeywords: ['openclaw'],
    });
  });

  it('keeps host scan responses free of executable paths', async () => {
    detectValidatedCommandMock.mockResolvedValue({
      available: true,
      path: '/private/bin/hermes',
      resolvedPathEnv: '/private/bin:/usr/bin',
      version: 'Hermes Agent v0.9.0 (build 1)',
    });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: true,
      version: '0.9.0',
    });
  });
});
