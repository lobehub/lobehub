import * as os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeRemotePlatform, resolveRemotePlatformCommand } from './scanHost';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'darwin') };
});

const { detectHeterogeneousCliCommandMock, detectValidatedCommandCandidatesMock } = vi.hoisted(
  () => ({
    detectHeterogeneousCliCommandMock: vi.fn(),
    detectValidatedCommandCandidatesMock: vi.fn(),
  }),
);

vi.mock('../spawn/resolveCliCommand', () => ({
  detectHeterogeneousCliCommand: detectHeterogeneousCliCommandMock,
  detectValidatedCommandCandidates: detectValidatedCommandCandidatesMock,
}));

describe('platform command scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the shared PATH and Windows-shim-aware command resolver', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toEqual({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });
    expect(detectValidatedCommandCandidatesMock).toHaveBeenCalledWith(
      [
        'openclaw',
        path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
        path.join(os.homedir(), '.local', 'bin', 'openclaw'),
      ],
      {
        validateHelpKeywords: ['Usage: openclaw'],
        validateKeywords: ['openclaw'],
        validatePattern: expect.any(RegExp),
      },
    );
  });

  it('accepts the bare version banner printed by OpenClaw 2026.1.29', async () => {
    detectValidatedCommandCandidatesMock.mockImplementation(async (_commands, options) => ({
      available: options.validatePattern.test('2026.1.29'),
      path: '/resolved/bin/openclaw',
      version: '2026.1.29',
    }));

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toMatchObject({
      available: true,
      version: '2026.1.29',
    });
  });

  it('falls back to the official OpenClaw managed install path', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
      version: '2026.1.29',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toMatchObject({
      available: true,
      version: '2026.1.29',
    });
    expect(detectValidatedCommandCandidatesMock.mock.calls[0]![0]).toContain(
      path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
    );
  });

  it('falls back to the official Hermes user-local install path', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: path.join(os.homedir(), '.local', 'bin', 'hermes'),
      version: '0.20.5',
    });

    await expect(resolveRemotePlatformCommand('hermes')).resolves.toMatchObject({
      available: true,
      version: '0.20.5',
    });
    expect(detectValidatedCommandCandidatesMock.mock.calls[0]![0]).toEqual([
      'hermes',
      path.join(os.homedir(), '.local', 'bin', 'hermes'),
    ]);
  });

  it('keeps host scan responses free of executable paths', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({
      available: true,
      path: '/private/bin/hermes',
      resolvedPathEnv: '/private/bin:/usr/bin',
      version: '0.9.0',
    });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: true,
      version: '0.9.0',
    });
  });

  it('surfaces the platform validation failure reason', async () => {
    detectValidatedCommandCandidatesMock.mockResolvedValue({ available: false });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: false,
      reason: 'hermes was not found or failed validation',
    });
  });
});
