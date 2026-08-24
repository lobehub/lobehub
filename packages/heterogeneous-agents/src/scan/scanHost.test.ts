import * as os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeRemotePlatform, resolveRemotePlatformCommand } from './scanHost';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'darwin') };
});

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
      version: '1.2.3',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toEqual({
      available: true,
      path: '/resolved/bin/openclaw',
      resolvedPathEnv: '/resolved/bin:/usr/bin',
      version: '1.2.3',
    });
    expect(detectValidatedCommandMock).toHaveBeenCalledWith('openclaw', {
      validateHelpKeywords: ['Usage: openclaw'],
      validateKeywords: ['openclaw'],
      validatePattern: expect.any(RegExp),
    });
  });

  it('accepts the bare version banner printed by OpenClaw 2026.1.29', async () => {
    detectValidatedCommandMock.mockImplementation(async (_command, options) => ({
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
    detectValidatedCommandMock.mockResolvedValueOnce({ available: false }).mockResolvedValueOnce({
      available: true,
      path: path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
      version: '2026.1.29',
    });

    await expect(resolveRemotePlatformCommand('openclaw')).resolves.toMatchObject({
      available: true,
      version: '2026.1.29',
    });
    expect(detectValidatedCommandMock.mock.calls.map(([command]) => command)).toEqual([
      'openclaw',
      path.join(os.homedir(), '.openclaw', 'bin', 'openclaw'),
    ]);
  });

  it('falls back to the official Hermes user-local install path', async () => {
    detectValidatedCommandMock.mockResolvedValueOnce({ available: false }).mockResolvedValueOnce({
      available: true,
      path: path.join(os.homedir(), '.local', 'bin', 'hermes'),
      version: '0.20.5',
    });

    await expect(resolveRemotePlatformCommand('hermes')).resolves.toMatchObject({
      available: true,
      version: '0.20.5',
    });
    expect(detectValidatedCommandMock.mock.calls.map(([command]) => command)).toEqual([
      'hermes',
      path.join(os.homedir(), '.local', 'bin', 'hermes'),
    ]);
  });

  it('keeps host scan responses free of executable paths', async () => {
    detectValidatedCommandMock.mockResolvedValue({
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
    detectValidatedCommandMock.mockResolvedValue({ available: false });

    await expect(probeRemotePlatform('hermes')).resolves.toEqual({
      available: false,
      reason: 'hermes was not found or failed validation',
    });
  });
});
